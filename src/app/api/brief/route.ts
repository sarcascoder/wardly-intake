import { generateObject, type UIMessage } from 'ai';
import { ClinicalBriefSchema } from '@/lib/clinical-schema';
import { deriveIntakeStateFromMessages } from '@/lib/derive-state';
import { synthesisModel } from '@/lib/model';

export const maxDuration = 60;

/**
 * Synthesise the final clinical brief from the slot-filled IntakeState.
 *
 * Stateless: derives the IntakeState from the conversation's message stream
 * passed in the request body, then feeds that *structured* state (not the
 * raw transcript) to the synthesis model. The brief is grounded in what the
 * agent actually captured via tools — no hallucinated symptoms.
 */
export async function POST(req: Request) {
  const { sessionId, messages }: { sessionId: string; messages: UIMessage[] } =
    await req.json();

  if (!messages || !Array.isArray(messages)) {
    return new Response(
      JSON.stringify({ error: 'messages array required' }),
      { status: 400 },
    );
  }

  const session = deriveIntakeStateFromMessages(messages, sessionId ?? 'brief');

  if (!session.cc) {
    return new Response(
      JSON.stringify({ error: 'Cannot generate brief — chief complaint was never captured.' }),
      { status: 400 },
    );
  }

  const intakeDurationSeconds = Math.round(
    ((session.endedAt ?? Date.now()) - session.startedAt) / 1000,
  );

  // We hand the model a compact JSON snapshot of the IntakeState. The Zod
  // schema enforces the output shape — generateObject will retry/repair if
  // the first draft doesn't validate.
  const stateJson = JSON.stringify(
    {
      patient: session.patient,
      cc: session.cc,
      hpi: session.hpi,
      ros: Object.values(session.ros),
      redFlags: session.redFlags.map((r) => ({ description: r.description, severity: r.severity })),
      pertinentNegatives: session.pertinentNegatives,
      allergies: session.allergies,
      currentMedications: session.currentMedications,
      pastMedicalHistory: session.pastMedicalHistory,
      intakeDurationSeconds,
      completionReason: session.completionReason,
    },
    null,
    2,
  );

  const allRosSystems = [
    'constitutional',
    'eyes',
    'ent',
    'cardiovascular',
    'respiratory',
    'gastrointestinal',
    'genitourinary',
    'musculoskeletal',
    'integumentary',
    'neurological',
    'psychiatric',
    'endocrine',
    'hematologic',
    'allergic',
  ];
  const probedSystems = Object.keys(session.ros);
  const notAssessed = allRosSystems.filter((s) => !probedSystems.includes(s));

  try {
    const result = await generateObject({
      model: synthesisModel(),
      schema: ClinicalBriefSchema,
      system: `You write structured clinical pre-visit briefs for primary care clinicians. Your tone is neutral, clinical, third-person. You DO NOT diagnose, hypothesise causes, or recommend treatment. You synthesise — you do not invent.

Rules:
- Every detail in the brief MUST be derivable from the provided IntakeState JSON. Do not add symptoms, history, or findings the patient did not state.
- The HPI narrative is 3–6 sentences, paragraph form, third person. Include relevant pertinent negatives.
- ROS section: include ONLY systems present in the input. Echo positives/negatives verbatim. Set 'notAssessed' to the list of standard ROS systems that were not probed.
- Triage recommendation rules:
  - If any red flag has severity 'high' → 'emergency'
  - If any red flag has severity 'moderate' → 'urgent'
  - Otherwise → 'routine' (or 'self-care' only if symptoms are clearly minor and patient is otherwise well)
- completenessScore reflects how much of a typical intake was captured: CC + most OLDCARTS + 2+ ROS + meds/allergies = ~0.85+. Empty intake = ~0.1.
- intakeDurationSeconds: copy from the input.

Return ONLY the structured object — no commentary.`,
      prompt: `IntakeState (slot-filled by the conversational agent):
\`\`\`json
${stateJson}
\`\`\`

Standard ROS systems for the 'notAssessed' field: ${JSON.stringify(allRosSystems)}.
Systems already probed: ${JSON.stringify(probedSystems)}.
Therefore notAssessed should be: ${JSON.stringify(notAssessed)}.

Synthesise the ClinicalBrief now.`,
      temperature: 0.2,
    });

    return Response.json(result.object);
  } catch (e) {
    // Surface the actual error to the client so the UI can show a useful
    // message instead of an empty 500.
    const message =
      e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.error('[brief] generateObject failed:', e);
    return new Response(
      JSON.stringify({
        error: /quota|rate|429|tokens per day|TPD/i.test(message)
          ? 'Free-tier rate limit hit on the model provider during synthesis. Wait ~60 s and retry.'
          : `Synthesis failed: ${message.slice(0, 200)}`,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
