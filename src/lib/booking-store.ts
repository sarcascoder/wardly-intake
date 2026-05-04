import {
  type BookingState,
  type BookingFields,
  newBookingState,
} from './booking-schema';

const STORE_KEY = '__wardly_booking_store__';

type Store = Map<string, BookingState>;

function getStore(): Store {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!(STORE_KEY in g)) g[STORE_KEY] = new Map<string, BookingState>();
  return g[STORE_KEY] as Store;
}

export function getOrCreateBooking(sessionId: string): BookingState {
  const store = getStore();
  const existing = store.get(sessionId);
  if (existing) return existing;
  const fresh = newBookingState(sessionId);
  store.set(sessionId, fresh);
  return fresh;
}

export function getBooking(sessionId: string): BookingState | null {
  return getStore().get(sessionId) ?? null;
}

export function updateBooking(
  sessionId: string,
  mutator: (s: BookingState) => void,
): BookingState {
  const s = getOrCreateBooking(sessionId);
  mutator(s);
  return s;
}

/**
 * Replace fields in the booking state. Used both by the agent's tools and by
 * the user typing into the form on the right pane (POST /api/booking).
 */
export function patchBookingFields(
  sessionId: string,
  patch: Partial<BookingFields>,
): BookingState {
  return updateBooking(sessionId, (s) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      // @ts-expect-error — keys come from BookingFields
      s.fields[k] = v;
    }
  });
}

export function resetBooking(sessionId: string): void {
  getStore().delete(sessionId);
}
