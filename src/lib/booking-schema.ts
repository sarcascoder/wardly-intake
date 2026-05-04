import { z } from 'zod';

/**
 * Booking — pre-intake appointment request.
 *
 * Same slot-filling architecture as the clinical intake: the conversational
 * agent receives typed tools, calls them in parallel with its reply, and the
 * server's BookingState becomes the deterministic source of truth that the
 * UI form renders.
 *
 * Notes:
 *  - DOB is captured as a string ('YYYY-MM-DD' preferred; we accept whatever
 *    the patient says and try to normalise). Age can be derived later.
 *  - Preferred date/time are kept as strings since "Tuesday afternoon" is a
 *    perfectly reasonable patient input — clinic ops will turn that into a
 *    concrete slot.
 */

export const VisitTypeSchema = z.enum(['new-patient', 'follow-up', 'urgent', 'unsure']);
export type VisitType = z.infer<typeof VisitTypeSchema>;

export const BookingFieldsSchema = z.object({
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  dateOfBirth: z.string().nullable().describe('Best-effort, ideally YYYY-MM-DD'),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  preferredDate: z.string().nullable().describe('Patient-stated, e.g. "this Thursday" or "2026-05-09"'),
  preferredTime: z.string().nullable().describe('Patient-stated, e.g. "morning" or "10am"'),
  reasonForVisit: z.string().nullable().describe('Short patient-language reason — will become CC if intake follows'),
  visitType: VisitTypeSchema.nullable(),
  insuranceProvider: z.string().nullable(),
  notes: z.string().nullable().describe('Free-form anything-else the patient mentions'),
});
export type BookingFields = z.infer<typeof BookingFieldsSchema>;

export interface BookingState {
  sessionId: string;
  startedAt: number;
  confirmedAt: number | null;
  fields: BookingFields;
  /** Set by the agent when it believes all required fields are filled and confirmed. */
  confirmed: boolean;
}

export function newBookingState(sessionId: string): BookingState {
  return {
    sessionId,
    startedAt: Date.now(),
    confirmedAt: null,
    fields: {
      firstName: null,
      lastName: null,
      dateOfBirth: null,
      phone: null,
      email: null,
      preferredDate: null,
      preferredTime: null,
      reasonForVisit: null,
      visitType: null,
      insuranceProvider: null,
      notes: null,
    },
    confirmed: false,
  };
}

/** Required fields before a booking can be confirmed. */
export const REQUIRED_BOOKING_FIELDS: (keyof BookingFields)[] = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'phone',
  'preferredDate',
  'preferredTime',
  'reasonForVisit',
];

export function bookingMissingFields(state: BookingState): (keyof BookingFields)[] {
  return REQUIRED_BOOKING_FIELDS.filter((k) => !state.fields[k]);
}
