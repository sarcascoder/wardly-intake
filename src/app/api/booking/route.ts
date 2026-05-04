import {
  getBooking,
  patchBookingFields,
  resetBooking,
} from '@/lib/booking-store';
import { BookingFieldsSchema } from '@/lib/booking-schema';

/**
 * GET  /api/booking?sessionId=...     → current BookingState
 * PATCH /api/booking                  → user-typed updates from the form
 * DELETE /api/booking                 → drop the booking session
 *
 * Lets the form on the right be a two-way live mirror: the agent fills via
 * tools, the patient can also type and the agent will see the updated state
 * in the auto-injected system block on the next turn.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId required' }), { status: 400 });
  }
  const state = getBooking(sessionId);
  if (!state) return Response.json({ exists: false });
  return Response.json({ exists: true, state });
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as { sessionId: string; patch?: unknown };
  if (!body.sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId required' }), { status: 400 });
  }
  const parsed = BookingFieldsSchema.partial().safeParse(body.patch ?? {});
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid patch', details: parsed.error.message }), {
      status: 400,
    });
  }
  const next = patchBookingFields(body.sessionId, parsed.data);
  return Response.json({ ok: true, state: next });
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (!body.sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId required' }), { status: 400 });
  }
  resetBooking(body.sessionId);
  return Response.json({ ok: true });
}
