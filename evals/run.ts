/**
 * Eval harness for Wardly intake.
 *
 * Replays each persona against the real /api/chat + /api/brief endpoints.
 * Asserts on the final IntakeState, prints per-persona scorecard, and
 * exits non-zero on any assertion failure.
 *
 * Run:  pnpm eval
 *
 * Notes:
 *  - Requires the dev server running on http://localhost:3000 (or set BASE_URL).
 *  - Each run uses a fresh sessionId so personas don't bleed into each other.
 *  - This is *not* a substitute for clinician review — it's a regression
 *    safety net for the agent's structuring behaviour.
 */
import { ALL_PERSONAS, type Persona } from './personas';
import type { IntakeState, ClinicalBrief } from '../src/lib/clinical-schema';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: Array<{ type: string; text?: string }>;
};

let messageCounter = 0;
const newId = () => `m-${Date.now()}-${++messageCounter}`;

async function callChat(sessionId: string, messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, messages }),
  });
  if (!res.ok) throw new Error(`/api/chat HTTP ${res.status}: ${await res.text()}`);
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assistantText = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // The UIMessageStream uses SSE-style "data: ..." lines.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload) as { type?: string; delta?: string; text?: string };
        if (evt.type === 'text-delta' && typeof evt.delta === 'string') {
          assistantText += evt.delta;
        } else if (evt.type === 'text' && typeof evt.text === 'string') {
          assistantText += evt.text;
        }
      } catch {
        /* skip non-JSON keep-alives */
      }
    }
  }
  return assistantText.trim();
}

async function fetchState(sessionId: string): Promise<IntakeState | null> {
  const res = await fetch(`${BASE_URL}/api/intake-status?sessionId=${sessionId}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { exists: boolean; state?: IntakeState };
  return json.exists ? (json.state ?? null) : null;
}

async function generateBrief(sessionId: string): Promise<ClinicalBrief | null> {
  const res = await fetch(`${BASE_URL}/api/brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) return null;
  return (await res.json()) as ClinicalBrief;
}

async function resetSession(sessionId: string): Promise<void> {
  await fetch(`${BASE_URL}/api/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
}

interface PersonaResult {
  persona: string;
  turns: number;
  state: IntakeState | null;
  brief: ClinicalBrief | null;
  assertions: { name: string; passed: boolean }[];
  durationMs: number;
}

async function runPersona(p: Persona): Promise<PersonaResult> {
  const sessionId = `eval-${p.id}-${Date.now()}`;
  await resetSession(sessionId);
  const startedAt = Date.now();

  const messages: ChatMessage[] = [];
  let turn = 0;
  let lastAgent = '';

  // Patient speaks first (mirrors the UI's start button)
  const initial = p.reply(0, '');
  messages.push({ id: newId(), role: 'user', parts: [{ type: 'text', text: initial }] });

  while (turn < p.maxTurns) {
    const agentText = await callChat(sessionId, messages);
    lastAgent = agentText;
    if (agentText) {
      messages.push({ id: newId(), role: 'assistant', parts: [{ type: 'text', text: agentText }] });
    }

    const state = await fetchState(sessionId);
    if (state?.intakeComplete) break;

    turn += 1;
    const reply = p.reply(turn, agentText);
    if (!reply) break;
    messages.push({ id: newId(), role: 'user', parts: [{ type: 'text', text: reply }] });
  }

  const finalState = await fetchState(sessionId);
  const brief = finalState ? await generateBrief(sessionId) : null;

  const assertions = p.assertions.map((a) => ({
    name: a.name,
    passed: finalState ? a.check(finalState) : false,
  }));

  return {
    persona: p.id,
    turns: turn + 1,
    state: finalState,
    brief,
    assertions,
    durationMs: Date.now() - startedAt,
    // last agent text deliberately swallowed — keeps the report compact
    ...(lastAgent ? {} : {}),
  };
}

function pad(s: string, n: number) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main() {
  console.log(`\n▶ Wardly intake eval · ${BASE_URL}\n`);
  let totalPassed = 0;
  let totalChecks = 0;
  const results: PersonaResult[] = [];

  for (const p of ALL_PERSONAS) {
    process.stdout.write(`  ${pad(p.id, 22)} `);
    try {
      const r = await runPersona(p);
      results.push(r);
      const passed = r.assertions.filter((a) => a.passed).length;
      totalPassed += passed;
      totalChecks += r.assertions.length;
      const ok = passed === r.assertions.length;
      console.log(
        `${ok ? '✓' : '✗'} ${passed}/${r.assertions.length} · ${r.turns} turns · ${(r.durationMs / 1000).toFixed(1)}s${
          r.brief ? ` · triage=${r.brief.recommendedTriage}` : ' · brief=skipped'
        }`,
      );
      for (const a of r.assertions) {
        if (!a.passed) console.log(`      · ${a.name}`);
      }
    } catch (e) {
      console.log(`✗ ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\n  ${totalPassed}/${totalChecks} assertions passed`);
  if (totalPassed < totalChecks) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
