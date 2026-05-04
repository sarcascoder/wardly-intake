import { type IntakeState, newIntakeState } from './clinical-schema';

/**
 * Process-local in-memory session store.
 *
 * For a real deployment this would be Redis or a database — but for a
 * single-region take-home demo, an in-process Map keeps the moving parts
 * minimal and avoids network round-trips on every tool call.
 *
 * The store is `globalThis`-anchored so that hot reloads in `next dev` don't
 * blow away running sessions.
 */

const STORE_KEY = '__wardly_session_store__';

type Store = Map<string, IntakeState>;

function getStore(): Store {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!(STORE_KEY in g)) g[STORE_KEY] = new Map<string, IntakeState>();
  return g[STORE_KEY] as Store;
}

export function getOrCreateSession(sessionId: string): IntakeState {
  const store = getStore();
  const existing = store.get(sessionId);
  if (existing) return existing;
  const fresh = newIntakeState(sessionId);
  store.set(sessionId, fresh);
  return fresh;
}

export function getSession(sessionId: string): IntakeState | null {
  return getStore().get(sessionId) ?? null;
}

export function updateSession(
  sessionId: string,
  mutator: (s: IntakeState) => void,
): IntakeState {
  const s = getOrCreateSession(sessionId);
  mutator(s);
  return s;
}

export function resetSession(sessionId: string): void {
  getStore().delete(sessionId);
}

/**
 * Compact summary of what slots are filled. Provided to the LLM each turn so
 * it can decide what to ask next without re-deriving from raw transcript.
 */
export function intakeStatus(s: IntakeState): {
  filled: string[];
  missing: string[];
  rosProbed: string[];
} {
  const filled: string[] = [];
  const missing: string[] = [];

  const o = s.hpi.oldcarts;
  const slot = (key: string, present: boolean) => (present ? filled : missing).push(key);

  slot('cc', s.cc !== null);
  slot('onset', o.onset !== null);
  slot('location', o.location !== null);
  slot('duration', o.duration !== null);
  slot('character', o.character !== null);
  slot('aggravating', o.aggravating !== null);
  slot('relieving', o.relieving !== null);
  slot('timing', o.timing !== null);
  slot('severity', o.severity !== null);
  slot('associatedSymptoms', o.associatedSymptoms.length > 0);
  slot('priorEpisodes', s.hpi.priorEpisodes !== null);
  slot('allergies_asked', s.allergies.length > 0 || s.hpi.context?.toLowerCase().includes('allerg') === true);
  slot('meds_asked', s.currentMedications.length > 0);

  return {
    filled,
    missing,
    rosProbed: Object.keys(s.ros),
  };
}
