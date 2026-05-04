import { tool } from 'ai';
import { z } from 'zod';
import { BookingFieldsSchema, bookingMissingFields } from './booking-schema';
import { patchBookingFields, updateBooking } from './booking-store';

export function buildBookingTools(sessionId: string) {
  return {
    set_booking_fields: tool({
      description:
        'Record one or more booking fields. Pass only the fields you have new info on. You can call this many times across the conversation.',
      inputSchema: BookingFieldsSchema.partial(),
      execute: async (patch) => {
        patchBookingFields(sessionId, patch);
        return { ok: true };
      },
    }),

    // get_booking_status removed — state is auto-injected into the system
    // prompt every turn. Empty-schema tools cause issues with some models
    // (gpt-oss emits phantom fields that fail strict validation).

    confirm_booking: tool({
      description:
        'Mark the booking request as confirmed. ONLY call after every required field is filled AND the patient has explicitly confirmed the request looks correct.',
      inputSchema: z.object({
        summary: z
          .string()
          .describe('1-sentence summary of the request, e.g. "Janet Liu, Thursday afternoon, follow-up for ear pain."'),
      }),
      execute: async ({ summary }) => {
        const s = updateBooking(sessionId, (st) => {
          st.confirmed = true;
          st.confirmedAt = Date.now();
          if (st.fields.notes) st.fields.notes = `${st.fields.notes}\n— ${summary}`;
        });
        const missing = bookingMissingFields(s);
        return {
          ok: missing.length === 0,
          confirmed: s.confirmed,
          missing,
        };
      },
    }),
  };
}
