import { resetSession } from '@/lib/session-store';

export async function POST(req: Request) {
  const { sessionId }: { sessionId: string } = await req.json();
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId required' }), { status: 400 });
  }
  resetSession(sessionId);
  return Response.json({ ok: true });
}
