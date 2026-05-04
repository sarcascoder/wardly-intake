import type { UIMessage } from 'ai';
import {
  newIntakeState,
  type IntakeState,
  type RosSystemName,
} from './clinical-schema';
import {
  newBookingState,
  type BookingState,
  type BookingFields,
} from './booking-schema';

/**
 * Pure-function state derivation from the conversation's message stream.
 *
 * Why this exists: Vercel deploys functions as stateless serverless instances.
 * A `Map<sessionId, State>` in module scope persists *within* a single Node
 * process but NOT across requests — so the chat route and the brief route
 * (different invocations) can land on different instances and see different
 * state. The fix is to keep the state derivable from the public message
 * stream so the server is fully stateless.
 *
 * The agent's tool-call inputs ARE the state mutations. We replay them in
 * order. The shape of the result matches the IntakeState the tool execute
 * functions would have produced if they all ran in the same process.
 */

type ToolPart = {
  type: string;
  input?: Record<string, unknown>;
};

function isToolPart(part: unknown): part is ToolPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    typeof (part as ToolPart).type === 'string' &&
    (part as ToolPart).type.startsWith('tool-')
  );
}

function toStringArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') {
    return v
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

const ALL_ROS_SYSTEMS: RosSystemName[] = [
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

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

export function deriveIntakeStateFromMessages(
  messages: UIMessage[],
  sessionId: string,
): IntakeState {
  const state = newIntakeState(sessionId);

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const part of message.parts) {
      if (!isToolPart(part)) continue;
      const toolName = part.type.slice('tool-'.length);
      const input = part.input;
      if (!input) continue;

      switch (toolName) {
        case 'record_patient_demographics': {
          if (typeof input.name === 'string') state.patient.name = input.name;
          if (typeof input.age === 'number') state.patient.age = input.age;
          if (typeof input.sex === 'string')
            state.patient.sex = input.sex as IntakeState['patient']['sex'];
          if (typeof input.pregnancyStatus === 'string')
            state.patient.pregnancyStatus =
              input.pregnancyStatus as IntakeState['patient']['pregnancyStatus'];
          break;
        }
        case 'record_cc': {
          if (typeof input.verbatim === 'string') {
            state.cc = { verbatim: input.verbatim, recordedAt: Date.now() };
          }
          break;
        }
        case 'record_hpi_oldcarts': {
          const o = state.hpi.oldcarts;
          if (typeof input.onset === 'string') o.onset = input.onset;
          if (typeof input.location === 'string') o.location = input.location;
          if (typeof input.duration === 'string') o.duration = input.duration;
          if (typeof input.character === 'string') o.character = input.character;
          if (typeof input.aggravating === 'string') o.aggravating = input.aggravating;
          if (typeof input.relieving === 'string') o.relieving = input.relieving;
          if (typeof input.timing === 'string') o.timing = input.timing;
          if (typeof input.severity === 'number') o.severity = input.severity;
          const symptoms = toStringArray(input.associatedSymptoms);
          if (symptoms.length > 0) {
            o.associatedSymptoms = [...new Set([...o.associatedSymptoms, ...symptoms])];
          }
          break;
        }
        case 'record_hpi_context': {
          if (typeof input.context === 'string') state.hpi.context = input.context;
          if (typeof input.priorEpisodes === 'string')
            state.hpi.priorEpisodes = input.priorEpisodes;
          const meds = toStringArray(input.medsTriedThisEpisode);
          if (meds.length > 0) {
            state.hpi.medsTriedThisEpisode = [
              ...new Set([...state.hpi.medsTriedThisEpisode, ...meds]),
            ];
          }
          break;
        }
        case 'record_ros': {
          const system = input.system as RosSystemName;
          if (!ALL_ROS_SYSTEMS.includes(system)) break;
          const positives = toStringArray(input.positives);
          const negatives = toStringArray(input.negatives);
          const existing = state.ros[system];
          if (!existing) {
            state.ros[system] = { system, positives, negatives };
          } else {
            existing.positives = [...new Set([...existing.positives, ...positives])];
            existing.negatives = [...new Set([...existing.negatives, ...negatives])];
          }
          break;
        }
        case 'flag_red_flag': {
          const description = typeof input.description === 'string' ? input.description : null;
          const severity =
            input.severity === 'high' ||
            input.severity === 'moderate' ||
            input.severity === 'low'
              ? input.severity
              : null;
          if (description && severity) {
            state.redFlags.push({ description, severity, recordedAt: Date.now() });
          }
          break;
        }
        case 'record_pertinent_negative': {
          if (typeof input.finding === 'string' && !state.pertinentNegatives.includes(input.finding)) {
            state.pertinentNegatives.push(input.finding);
          }
          break;
        }
        case 'record_clinical_history': {
          const allergies = toStringArray(input.allergies);
          const meds = toStringArray(input.currentMedications);
          const pmh = toStringArray(input.pastMedicalHistory);
          if (allergies.length > 0)
            state.allergies = [...new Set([...state.allergies, ...allergies])];
          if (meds.length > 0)
            state.currentMedications = [...new Set([...state.currentMedications, ...meds])];
          if (pmh.length > 0)
            state.pastMedicalHistory = [...new Set([...state.pastMedicalHistory, ...pmh])];
          break;
        }
        case 'end_intake': {
          state.intakeComplete = true;
          if (typeof input.reason === 'string') state.completionReason = input.reason;
          state.endedAt = Date.now();
          break;
        }
      }
    }
  }

  return state;
}

export function intakeStatusFromState(state: IntakeState): {
  filled: string[];
  missing: string[];
  rosProbed: string[];
} {
  const filled: string[] = [];
  const missing: string[] = [];
  const o = state.hpi.oldcarts;
  const slot = (key: string, present: boolean) => (present ? filled : missing).push(key);

  slot('cc', state.cc !== null);
  slot('onset', o.onset !== null);
  slot('location', o.location !== null);
  slot('duration', o.duration !== null);
  slot('character', o.character !== null);
  slot('aggravating', o.aggravating !== null);
  slot('relieving', o.relieving !== null);
  slot('timing', o.timing !== null);
  slot('severity', o.severity !== null);
  slot('associatedSymptoms', o.associatedSymptoms.length > 0);
  slot('priorEpisodes', state.hpi.priorEpisodes !== null);
  slot('allergies_asked', state.allergies.length > 0);
  slot('meds_asked', state.currentMedications.length > 0);

  return {
    filled,
    missing,
    rosProbed: Object.keys(state.ros),
  };
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

const BOOKING_FIELD_KEYS: (keyof BookingFields)[] = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'phone',
  'email',
  'preferredDate',
  'preferredTime',
  'reasonForVisit',
  'visitType',
  'insuranceProvider',
  'notes',
];

export function deriveBookingStateFromMessages(
  messages: UIMessage[],
  sessionId: string,
): BookingState {
  const state = newBookingState(sessionId);

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const part of message.parts) {
      if (!isToolPart(part)) continue;
      const toolName = part.type.slice('tool-'.length);
      const input = part.input;
      if (!input) continue;

      if (toolName === 'set_booking_fields') {
        for (const k of BOOKING_FIELD_KEYS) {
          const v = (input as Record<string, unknown>)[k];
          if (v !== undefined && v !== null) {
            // Type laundering — we trust the input shape from the tool schema
            // here; runtime validation already happened in the AI SDK's tool
            // input validator.
            (state.fields as Record<string, unknown>)[k] = v;
          }
        }
      } else if (toolName === 'confirm_booking') {
        state.confirmed = true;
        state.confirmedAt = Date.now();
        if (typeof (input as { summary?: unknown }).summary === 'string') {
          const summary = (input as { summary: string }).summary;
          state.fields.notes = state.fields.notes
            ? `${state.fields.notes}\n— ${summary}`
            : summary;
        }
      }
    }
  }

  return state;
}
