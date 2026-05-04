import { tool } from 'ai';
import { z } from 'zod';
import { updateSession } from './session-store';
import { RosSystem } from './clinical-schema';

/**
 * Build a fresh set of intake tools bound to a specific sessionId.
 *
 * Each tool's `execute` mutates the in-process IntakeState for that session.
 * The shape returned to the model is intentionally small so it doesn't
 * encourage chattier tool replies.
 *
 * Schema design note — provider-tolerant inputs:
 *   Different LLMs serialise arrays differently. Llama models (Groq) often
 *   emit comma-separated strings where Gemini/GPT emit JSON arrays. To keep
 *   tool calls robust across providers we accept BOTH (`stringOrArray`) and
 *   coerce in `execute()` via `toStringArray`. This avoids tool-call
 *   validation failures that would otherwise stall the conversation.
 */

// Accept either a JSON array of strings or a single comma/semicolon-separated
// string. Both are common LLM outputs.
const stringOrArray = z.union([z.array(z.string()), z.string()]);
function toStringArray(v: string | string[] | null | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((s) => s.trim()).filter(Boolean);
  return v
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Lenient OLDCARTS input — array OR comma-separated string for associatedSymptoms.
const OldcartsInputSchema = z.object({
  onset: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
  character: z.string().nullable().optional(),
  aggravating: z.string().nullable().optional(),
  relieving: z.string().nullable().optional(),
  timing: z.string().nullable().optional(),
  severity: z.number().nullable().optional(),
  associatedSymptoms: stringOrArray.optional(),
});

const RosFindingInputSchema = z.object({
  system: RosSystem,
  positives: stringOrArray.optional(),
  negatives: stringOrArray.optional(),
});
export function buildIntakeTools(sessionId: string) {
  return {
    record_patient_demographics: tool({
      description:
        'Record patient demographics. Call as soon as the patient shares any of these. All fields optional.',
      inputSchema: z.object({
        name: z.string().nullable().optional(),
        age: z.number().int().nullable().optional(),
        sex: z.enum(['male', 'female', 'other', 'prefer-not-to-say']).nullable().optional(),
        pregnancyStatus: z.enum(['pregnant', 'not-pregnant', 'unknown', 'na']).nullable().optional(),
      }),
      execute: async (input) => {
        updateSession(sessionId, (s) => {
          if (input.name !== undefined && input.name !== null) s.patient.name = input.name;
          if (input.age !== undefined && input.age !== null) s.patient.age = input.age;
          if (input.sex !== undefined && input.sex !== null) s.patient.sex = input.sex;
          if (input.pregnancyStatus !== undefined && input.pregnancyStatus !== null) s.patient.pregnancyStatus = input.pregnancyStatus;
        });
        return { ok: true };
      },
    }),

    record_cc: tool({
      description:
        'Record the chief complaint. Use the patient\'s own words verbatim. Call this once you understand the primary reason for the visit.',
      inputSchema: z.object({
        verbatim: z.string().describe('The chief complaint in the patient\'s own words, ≤1 sentence'),
      }),
      execute: async ({ verbatim }) => {
        updateSession(sessionId, (s) => {
          s.cc = { verbatim, recordedAt: Date.now() };
        });
        return { ok: true };
      },
    }),

    record_hpi_oldcarts: tool({
      description:
        'Record one or more OLDCARTS fields for the HPI. Pass only the fields you have new info on; omit the rest. Can be called multiple times across the conversation as you learn more.',
      inputSchema: OldcartsInputSchema,
      execute: async (input) => {
        updateSession(sessionId, (s) => {
          const o = s.hpi.oldcarts;
          if (input.onset !== undefined) o.onset = input.onset;
          if (input.location !== undefined) o.location = input.location;
          if (input.duration !== undefined) o.duration = input.duration;
          if (input.character !== undefined) o.character = input.character;
          if (input.aggravating !== undefined) o.aggravating = input.aggravating;
          if (input.relieving !== undefined) o.relieving = input.relieving;
          if (input.timing !== undefined) o.timing = input.timing;
          if (input.severity !== undefined && input.severity !== null) o.severity = input.severity;
          const newSymptoms = toStringArray(input.associatedSymptoms);
          if (newSymptoms.length > 0) {
            o.associatedSymptoms = [...new Set([...o.associatedSymptoms, ...newSymptoms])];
          }
        });
        return { ok: true };
      },
    }),

    record_hpi_context: tool({
      description:
        'Record HPI context that does not fit OLDCARTS — recent travel, sick contacts, prior episodes, meds tried this episode.',
      inputSchema: z.object({
        context: z.string().nullable().optional(),
        priorEpisodes: z.string().nullable().optional(),
        medsTriedThisEpisode: stringOrArray.optional(),
      }),
      execute: async (input) => {
        updateSession(sessionId, (s) => {
          if (input.context !== undefined) s.hpi.context = input.context;
          if (input.priorEpisodes !== undefined) s.hpi.priorEpisodes = input.priorEpisodes;
          const meds = toStringArray(input.medsTriedThisEpisode);
          if (meds.length > 0) {
            s.hpi.medsTriedThisEpisode = [...new Set([...s.hpi.medsTriedThisEpisode, ...meds])];
          }
        });
        return { ok: true };
      },
    }),

    record_ros: tool({
      description:
        'Record findings for one Review-of-Systems system. Positives are symptoms patient affirms; negatives are explicit denials (clinically valuable). Call once per system probed.',
      inputSchema: RosFindingInputSchema,
      execute: async (input) => {
        const positives = toStringArray(input.positives);
        const negatives = toStringArray(input.negatives);
        updateSession(sessionId, (s) => {
          const existing = s.ros[input.system];
          if (!existing) {
            s.ros[input.system] = {
              system: input.system,
              positives,
              negatives,
            };
          } else {
            existing.positives = [...new Set([...existing.positives, ...positives])];
            existing.negatives = [...new Set([...existing.negatives, ...negatives])];
          }
        });
        return { ok: true };
      },
    }),

    flag_red_flag: tool({
      description:
        'Flag a red-flag finding (e.g., exertional chest pain with diaphoresis, thunderclap headache, focal neuro deficit). The clinician will see these prominently. Severity: low = mention to clinician; moderate = clinician should address same-visit; high = recommend emergency care to patient now.',
      inputSchema: z.object({
        description: z.string(),
        severity: z.enum(['low', 'moderate', 'high']),
      }),
      execute: async (input) => {
        updateSession(sessionId, (s) => {
          s.redFlags.push({ ...input, recordedAt: Date.now() });
        });
        return { ok: true, severity: input.severity };
      },
    }),

    record_pertinent_negative: tool({
      description:
        'Record an important pertinent negative — something the patient explicitly denied that is clinically meaningful for the chief complaint.',
      inputSchema: z.object({
        finding: z.string(),
      }),
      execute: async ({ finding }) => {
        updateSession(sessionId, (s) => {
          if (!s.pertinentNegatives.includes(finding)) s.pertinentNegatives.push(finding);
        });
        return { ok: true };
      },
    }),

    record_clinical_history: tool({
      description:
        'Record allergies, current medications, or past medical history items. Pass an array OR a comma-separated string. Empty/no list means "patient confirmed none".',
      inputSchema: z.object({
        allergies: stringOrArray.optional(),
        currentMedications: stringOrArray.optional(),
        pastMedicalHistory: stringOrArray.optional(),
      }),
      execute: async (input) => {
        const allergies = toStringArray(input.allergies);
        const meds = toStringArray(input.currentMedications);
        const pmh = toStringArray(input.pastMedicalHistory);
        updateSession(sessionId, (s) => {
          if (allergies.length > 0)
            s.allergies = [...new Set([...s.allergies, ...allergies])];
          if (meds.length > 0)
            s.currentMedications = [...new Set([...s.currentMedications, ...meds])];
          if (pmh.length > 0)
            s.pastMedicalHistory = [...new Set([...s.pastMedicalHistory, ...pmh])];
        });
        return { ok: true };
      },
    }),

    // get_intake_status removed — state is auto-injected into the system
    // prompt every turn (see /api/chat/route.ts), so the agent never needs
    // to call a tool to learn it. Removing also avoids gpt-oss-style models
    // emitting phantom fields on empty-schema tool calls.

    end_intake: tool({
      description:
        'End the intake. Only call when CC is captured, most OLDCARTS slots have info, ≥2 ROS systems are probed, red flags screened, and meds/allergies confirmed. Provide a 1-sentence completion reason.',
      inputSchema: z.object({
        reason: z.string().describe('1-sentence summary of why intake is complete, e.g. "Sufficient HPI and ROS gathered for chest-pain triage."'),
      }),
      execute: async ({ reason }) => {
        updateSession(sessionId, (s) => {
          s.intakeComplete = true;
          s.completionReason = reason;
          s.endedAt = Date.now();
        });
        return { ok: true, intakeComplete: true };
      },
    }),
  };
}

export type IntakeToolName = keyof ReturnType<typeof buildIntakeTools>;

// Reference list used by the system prompt and the typed Zod-set on the API
export const ROS_SYSTEM_VALUES = RosSystem.options;
