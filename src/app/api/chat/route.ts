import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from 'ai';
import { INTAKE_SYSTEM_PROMPT } from '@/lib/system-prompt';
import { buildIntakeTools } from '@/lib/intake-tools';
import { resetSession, updateSession } from '@/lib/session-store';
import {
  deriveIntakeStateFromMessages,
  intakeStatusFromState,
} from '@/lib/derive-state';
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

  // Stateless server: derive the state for THIS request from the conversation
  // history's tool calls. Persist it briefly into the in-process Map so the
  // tool execute handlers (which mutate via updateSession) keep working
  // unchanged for the duration of this streamText call. Subsequent requests
  // will re-derive — Vercel's serverless functions don't share memory.
  const derived = deriveIntakeStateFromMessages(messages, sessionId);
  resetSession(sessionId);
  updateSession(sessionId, (s) => {
    Object.assign(s, derived);
  });
  const status = intakeStatusFromState(derived);

  const stateBlock = `
Current intake state (auto-injected each turn):
- Chief complaint captured: ${derived.cc ? `yes — "${derived.cc.verbatim}"` : 'no'}
- HPI slots filled: ${status.filled.join(', ') || '(none yet)'}
- HPI slots missing: ${status.missing.join(', ') || '(all filled)'}
- ROS systems probed: ${status.rosProbed.join(', ') || '(none yet)'}
- Red flags raised: ${derived.redFlags.length}
- Allergies confirmed: ${derived.allergies.length > 0 ? derived.allergies.join(', ') : '(not yet asked)'}
- Current medications confirmed: ${derived.currentMedications.length > 0 ? derived.currentMedications.join(', ') : '(not yet asked)'}
- Intake complete: ${derived.intakeComplete ? `YES — ${derived.completionReason}` : 'no'}

If intake is complete, simply acknowledge politely and stop calling tools.`;

  const result = streamText({
    model: chatModel(),
    system: `${INTAKE_SYSTEM_PROMPT}\n\n${stateBlock}`,
    messages: await convertToModelMessages(messages),
    tools: buildIntakeTools(sessionId),
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
