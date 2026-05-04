import { z } from 'zod';

/**
 * Wardly intake — clinical schemas.
 *
 * The agent runs a slot-filling conversation. As it learns information from
 * the patient, it calls `record_*` tools whose inputs conform to the
 * sub-schemas below. The `IntakeState` below is the running ground-truth that
 * tools mutate on the server. The final `ClinicalBrief` is then synthesised
 * from this state by a separate model call (`generateObject`).
 *
 * Why this split: the conversational LLM is good at natural dialog but not
 * reliable as a single source of truth for structured output. By decoupling
 * (a) capture-as-you-go via tools and (b) final synthesis, we get a
 * deterministic record that a clinician can trust.
 */

// ---------------------------------------------------------------------------
// HPI — OLDCARTS framework
// ---------------------------------------------------------------------------

export const OldcartsSchema = z.object({
  onset: z.string().nullable().describe('When/how the symptom started — sudden vs gradual, exact timing if known'),
  location: z.string().nullable().describe('Anatomical location, including side and radiation'),
  duration: z.string().nullable().describe('How long it has been going on; constant vs intermittent'),
  character: z.string().nullable().describe('Quality — sharp/dull/burning/cramping/throbbing in patient words'),
  aggravating: z.string().nullable().describe('What makes it worse'),
  relieving: z.string().nullable().describe('What makes it better, including meds tried'),
  timing: z.string().nullable().describe('Pattern over time, time of day, frequency'),
  severity: z.number().min(0).max(10).nullable().describe('Patient-reported pain/severity on 0–10 scale'),
  associatedSymptoms: z.array(z.string()).default([]).describe('Other symptoms patient links to the chief complaint'),
});

export type Oldcarts = z.infer<typeof OldcartsSchema>;

export const HpiSchema = z.object({
  oldcarts: OldcartsSchema,
  context: z.string().nullable().describe('Free-text additional context that does not fit OLDCARTS — recent travel, sick contacts, similar past episodes, etc.'),
  priorEpisodes: z.string().nullable().describe('Has this happened before? Frequency, last occurrence, prior workup'),
  medsTriedThisEpisode: z.array(z.string()).default([]),
});

export type Hpi = z.infer<typeof HpiSchema>;

// ---------------------------------------------------------------------------
// ROS — review of systems. We only fill systems probed in conversation;
// unprobed systems stay undefined so the brief can show "not assessed".
// ---------------------------------------------------------------------------

export const RosSystem = z.enum([
  'constitutional', // fever, fatigue, weight loss
  'eyes',
  'ent', // ears, nose, throat
  'cardiovascular', // chest pain, palpitations
  'respiratory', // cough, sob
  'gastrointestinal', // n/v/d, abdominal pain
  'genitourinary',
  'musculoskeletal',
  'integumentary', // skin
  'neurological',
  'psychiatric',
  'endocrine',
  'hematologic',
  'allergic',
]);
export type RosSystemName = z.infer<typeof RosSystem>;

export const RosFindingSchema = z.object({
  system: RosSystem,
  positives: z.array(z.string()).default([]).describe('Symptoms patient explicitly affirms'),
  negatives: z.array(z.string()).default([]).describe('Symptoms patient explicitly denies — pertinent negatives matter clinically'),
});
export type RosFinding = z.infer<typeof RosFindingSchema>;

// ---------------------------------------------------------------------------
// Patient demographics (best-effort; not required for triage brief)
// ---------------------------------------------------------------------------

export const PatientSchema = z.object({
  name: z.string().nullable(),
  age: z.number().int().nullable(),
  sex: z.enum(['male', 'female', 'other', 'prefer-not-to-say']).nullable(),
  pregnancyStatus: z.enum(['pregnant', 'not-pregnant', 'unknown', 'na']).nullable(),
});
export type Patient = z.infer<typeof PatientSchema>;

// ---------------------------------------------------------------------------
// IntakeState — the running ground-truth on the server
// ---------------------------------------------------------------------------

export interface IntakeState {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  patient: Patient;
  cc: { verbatim: string; recordedAt: number } | null;
  hpi: Hpi;
  ros: Partial<Record<RosSystemName, RosFinding>>;
  redFlags: { description: string; severity: 'low' | 'moderate' | 'high'; recordedAt: number }[];
  pertinentNegatives: string[];
  // Additional free-text intake notes (allergies, current meds, PMH if surfaced)
  allergies: string[];
  currentMedications: string[];
  pastMedicalHistory: string[];
  // Agent-controlled completion signal
  intakeComplete: boolean;
  completionReason: string | null;
}

export function newIntakeState(sessionId: string): IntakeState {
  return {
    sessionId,
    startedAt: Date.now(),
    endedAt: null,
    patient: { name: null, age: null, sex: null, pregnancyStatus: null },
    cc: null,
    hpi: {
      oldcarts: {
        onset: null,
        location: null,
        duration: null,
        character: null,
        aggravating: null,
        relieving: null,
        timing: null,
        severity: null,
        associatedSymptoms: [],
      },
      context: null,
      priorEpisodes: null,
      medsTriedThisEpisode: [],
    },
    ros: {},
    redFlags: [],
    pertinentNegatives: [],
    allergies: [],
    currentMedications: [],
    pastMedicalHistory: [],
    intakeComplete: false,
    completionReason: null,
  };
}

// ---------------------------------------------------------------------------
// ClinicalBrief — final synthesised output the clinician reads
// ---------------------------------------------------------------------------

// IMPORTANT: this schema is the *output* contract for `generateObject`.
// Every property is REQUIRED (no `.default()`, no `.optional()`) because
// Groq's response_format validator rejects schemas where the JSON Schema
// `required` array isn't a complete list of properties. Optional content
// is expressed with `.nullable()` and empty arrays instead.
const StrictOldcarts = z.object({
  onset: z.string().nullable(),
  location: z.string().nullable(),
  duration: z.string().nullable(),
  character: z.string().nullable(),
  aggravating: z.string().nullable(),
  relieving: z.string().nullable(),
  timing: z.string().nullable(),
  severity: z.number().min(0).max(10).nullable(),
  associatedSymptoms: z.array(z.string()),
});

const StrictRosFinding = z.object({
  system: RosSystem,
  positives: z.array(z.string()),
  negatives: z.array(z.string()),
});

export const ClinicalBriefSchema = z.object({
  patient: z.object({
    name: z.string().nullable(),
    age: z.number().int().nullable(),
    sex: z.string().nullable(),
  }),
  cc: z.string().describe('Chief complaint in 1 short sentence — quote the patient where possible'),
  hpi: z.object({
    narrative: z.string().describe('3–6 sentence clinical paragraph in third person, neutral tone, no diagnoses'),
    oldcarts: StrictOldcarts,
  }),
  ros: z.object({
    systems: z.array(StrictRosFinding).describe('Only systems that were probed; do not invent'),
    notAssessed: z.array(RosSystem).describe('Systems the agent did not probe — useful for clinician triage'),
  }),
  redFlags: z.array(
    z.object({
      description: z.string(),
      severity: z.enum(['low', 'moderate', 'high']),
    }),
  ),
  pertinentNegatives: z.array(z.string()).describe('Important things the patient explicitly denied'),
  allergies: z.array(z.string()),
  currentMedications: z.array(z.string()),
  pastMedicalHistory: z.array(z.string()),
  recommendedTriage: z.enum(['emergency', 'urgent', 'routine', 'self-care']).describe('Conservative triage recommendation; emergency for any high red flag'),
  completenessScore: z.number().min(0).max(1).describe('Self-assessment: 0 = barely any info, 1 = full intake'),
  intakeDurationSeconds: z.number().int(),
});

export type ClinicalBrief = z.infer<typeof ClinicalBriefSchema>;
