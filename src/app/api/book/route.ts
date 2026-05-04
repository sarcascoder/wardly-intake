import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from 'ai';
import { BOOKING_SYSTEM_PROMPT } from '@/lib/booking-prompt';
import { buildBookingTools } from '@/lib/booking-tools';
import {
  getOrCreateBooking,
} from '@/lib/booking-store';
import { bookingMissingFields, REQUIRED_BOOKING_FIELDS } from '@/lib/booking-schema';
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

  const booking = getOrCreateBooking(sessionId);
  const missing = bookingMissingFields(booking);
  const filled = REQUIRED_BOOKING_FIELDS.filter((k) => !missing.includes(k));

  // Inject the live form snapshot — same trick as the intake route. The agent
  // sees it as part of the system prompt every turn so it can decide what to
  // ask without having to call get_booking_status repeatedly.
  const f = booking.fields;
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
Confirmed: ${booking.confirmed ? 'yes' : 'no'}

If a field is already filled, don't re-ask unless it's clearly wrong. If all required fields are filled and not yet confirmed, briefly summarise and ask the patient to confirm.`;

  const result = streamText({
    model: chatModel(),
    system: `${BOOKING_SYSTEM_PROMPT}\n\n${stateBlock}`,
    messages: await convertToModelMessages(messages),
    tools: buildBookingTools(sessionId),
    stopWhen: stepCountIs(4),
    temperature: 0.3,
  });

  return result.toUIMessageStreamResponse({
    onError: (e) =>
      e instanceof Error
        ? `⚠️ ${e.message.split('\n')[0]}`
        : 'Something went wrong calling the model.',
  });
}
