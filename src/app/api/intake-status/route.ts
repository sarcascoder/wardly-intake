import { getSession } from '@/lib/session-store';

/**
 * GET /api/intake-status?sessionId=...
 * Returns the live IntakeState so the sidebar can render filled slots in
 * real time. The chat UI polls this whenever a tool-* part appears in the
 * stream (or every ~1s as a safety net).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId required' }), { status: 400 });
  }
  const session = getSession(sessionId);
  if (!session) {
    return Response.json({ exists: false });
  }
  return Response.json({ exists: true, state: session });
}
