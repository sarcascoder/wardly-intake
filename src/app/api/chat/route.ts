import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from 'ai';
import { INTAKE_SYSTEM_PROMPT } from '@/lib/system-prompt';
import { buildIntakeTools } from '@/lib/intake-tools';
import { intakeStatus, getOrCreateSession } from '@/lib/session-store';
import { chatModel } from '@/lib/model';

export const maxDuration = 60;

type ChatRequestBody = {
  sessionId: string;
  messages: UIMessage[];
};

export async function POST(req: Request) {
  const { sessionId, messages }: ChatRequestBody = await req.json();

  if (!sessionId || typeof sessionId !== 'string') {
    return new Response(JSON.stringify({ error: 'sessionId required' }), { status: 400 });
  }

  const session = getOrCreateSession(sessionId);
  const status = intakeStatus(session);

  // Compact, deterministic context block — appended to the system prompt so
  // the model always knows the current slot state without being told via tool
  // call. This reduces unnecessary `get_intake_status` calls while keeping
  // the agent grounded.
  const stateBlock = `
Current intake state (auto-injected each turn):
- Chief complaint captured: ${session.cc ? `yes — "${session.cc.verbatim}"` : 'no'}
- HPI slots filled: ${status.filled.join(', ') || '(none yet)'}
- HPI slots missing: ${status.missing.join(', ') || '(all filled)'}
- ROS systems probed: ${status.rosProbed.join(', ') || '(none yet)'}
- Red flags raised: ${session.redFlags.length}
- Allergies confirmed: ${session.allergies.length > 0 ? session.allergies.join(', ') : '(not yet asked)'}
- Current medications confirmed: ${session.currentMedications.length > 0 ? session.currentMedications.join(', ') : '(not yet asked)'}
- Intake complete: ${session.intakeComplete ? `YES — ${session.completionReason}` : 'no'}

If intake is complete, simply acknowledge politely and stop calling tools.`;

  const result = streamText({
    // Provider auto-selected via env: GROQ_API_KEY → llama-3.3-70b on Groq
    // (30 RPM, sub-second TTFT), else gemini-2.0-flash-lite on Google.
    model: chatModel(),
    system: `${INTAKE_SYSTEM_PROMPT}\n\n${stateBlock}`,
    messages: await convertToModelMessages(messages),
    tools: buildIntakeTools(sessionId),
    // Cap at 4 steps per turn — typical turn is text + ≤3 tool calls. Lower
    // cap keeps free-tier rate-limit pressure bounded.
    stopWhen: stepCountIs(4),
    // Lower temperature for more reliable adherence to "always include text".
    temperature: 0.3,
  });

  return result.toUIMessageStreamResponse({
    // Surface provider errors (rate limits, auth) to the client as text so
    // the user sees something instead of a silent stall.
    onError: (e) =>
      e instanceof Error
        ? `⚠️ ${e.message.split('\n')[0]}`
        : 'Something went wrong calling the model.',
  });
}
