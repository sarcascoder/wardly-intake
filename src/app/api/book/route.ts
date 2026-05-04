import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from 'ai';
import { BOOKING_SYSTEM_PROMPT } from '@/lib/booking-prompt';
import { buildBookingTools } from '@/lib/booking-tools';
import { resetBooking, updateBooking } from '@/lib/booking-store';
import { deriveBookingStateFromMessages } from '@/lib/derive-state';
import {
  bookingMissingFields,
  REQUIRED_BOOKING_FIELDS,
  type BookingFields,
} from '@/lib/booking-schema';
import { chatModel } from '@/lib/model';

export const maxDuration = 60;

type ChatRequestBody = {
  sessionId: string;
  messages: UIMessage[];
  // Optional: client-side manual edits to the form (typed-in field values)
  // that aren't represented in any tool call yet. Merged on top of the
  // message-derived state so the agent sees the user's manual corrections.
  formOverrides?: Partial<BookingFields>;
};

export async function POST(req: Request) {
  const { sessionId, messages, formOverrides }: ChatRequestBody = await req.json();

  if (!sessionId || typeof sessionId !== 'string') {
    return new Response(JSON.stringify({ error: 'sessionId required' }), { status: 400 });
  }

  // Stateless server: derive booking state from the conversation, then
  // overlay any client-side form edits (where the user typed directly into
  // form fields without going through the agent).
  const derived = deriveBookingStateFromMessages(messages, sessionId);
  if (formOverrides) {
    for (const [k, v] of Object.entries(formOverrides)) {
      if (v === undefined || v === null) continue;
      // @ts-expect-error — keys come from BookingFields
      derived.fields[k] = v;
    }
  }
  resetBooking(sessionId);
  updateBooking(sessionId, (s) => {
    Object.assign(s, derived);
  });

  const missing = bookingMissingFields(derived);
  const filled = REQUIRED_BOOKING_FIELDS.filter((k) => !missing.includes(k));
  const f = derived.fields;

  const stateBlock = `
Current booking-form state (auto-injected each turn):
- firstName: ${f.firstName ?? '(empty)'}
- lastName: ${f.lastName ?? '(empty)'}
- dateOfBirth: ${f.dateOfBirth ?? '(empty)'}
- phone: ${f.phone ?? '(empty)'}
- email: ${f.email ?? '(empty)'}
- preferredDate: ${f.preferredDate ?? '(empty)'}
- preferredTime: ${f.preferredTime ?? '(empty)'}
- reasonForVisit: ${f.reasonForVisit ?? '(empty)'}
- visitType: ${f.visitType ?? '(empty)'}
- insuranceProvider: ${f.insuranceProvider ?? '(empty)'}
- notes: ${f.notes ?? '(empty)'}

Required fields filled: ${filled.join(', ') || '(none)'}
Required fields missing: ${missing.join(', ') || '(all filled — ask the patient to confirm, then call confirm_booking)'}
Confirmed: ${derived.confirmed ? 'yes' : 'no'}

If a field is already filled, don't re-ask unless it's clearly wrong. If all required fields are filled and not yet confirmed, briefly summarise and ask the patient to confirm.`;

  const result = streamText({
    model: chatModel(),
    system: `${BOOKING_SYSTEM_PROMPT}\n\n${stateBlock}`,
    messages: await convertToModelMessages(messages),
    tools: buildBookingTools(sessionId),
    stopWhen: stepCountIs(3),
    temperature: 0.3,
  });

  return result.toUIMessageStreamResponse({
    onError: (e) =>
      e instanceof Error
        ? `⚠️ ${e.message.split('\n')[0]}`
        : 'Something went wrong calling the model.',
  });
}
