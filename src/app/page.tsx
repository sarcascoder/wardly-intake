'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { ChatMessage } from '@/components/chat-message';
import { IntakeSidebar } from '@/components/intake-sidebar';
import { BriefView } from '@/components/brief-view';
import { BookingModal } from '@/components/booking-modal';
import { useVoice } from '@/lib/use-voice';
import type { ClinicalBrief, IntakeState } from '@/lib/clinical-schema';
import type { BookingState } from '@/lib/booking-schema';

export default function Home() {
  // Stable per-tab session id. Using a ref so re-renders don't churn it.
  const sessionIdRef = useRef<string>('');
  if (!sessionIdRef.current) sessionIdRef.current = nanoid(10);

  const [input, setInput] = useState('');
  const [intakeState, setIntakeState] = useState<IntakeState | null>(null);
  const [brief, setBrief] = useState<ClinicalBrief | null>(null);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<BookingState | null>(null);
  const [chartHintDismissed, setChartHintDismissed] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, setMessages, error, regenerate } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest: ({ messages }) => ({
        body: { sessionId: sessionIdRef.current, messages },
      }),
    }),
  });

  const handleTranscript = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      sendMessage({ text });
    },
    [sendMessage],
  );

  const voice = useVoice({ onTranscript: handleTranscript });

  // Speak the latest assistant text once it finishes streaming (voice mode
  // only). The hook auto-restarts the mic when speech ends. CRITICAL: if the
  // agent replies with only tool calls and no text, we still re-open the mic
  // so the user isn't stranded waiting for a question that never came.
  const lastHandledTurnRef = useRef<string | null>(null);
  useEffect(() => {
    if (!voice.voiceMode) return;
    if (status !== 'ready') return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;
    if (lastHandledTurnRef.current === lastAssistant.id) return;
    lastHandledTurnRef.current = lastAssistant.id;

    const text = lastAssistant.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join('')
      .trim();

    if (text.length > 0) {
      voice.speak(text);
    } else if (!voice.listening) {
      // Agent issued only tool calls / no text. Open the mic so the user can
      // prompt the next step.
      voice.start();
    }
  }, [messages, status, voice]);

  // Refresh structured intake state from the server. We poll on a 700ms tick
  // while a stream is in-flight (so chips appear live), and once after each
  // stream settles. Cheap because it's an in-memory read.
  const refreshState = useCallback(async () => {
    try {
      const res = await fetch(`/api/intake-status?sessionId=${sessionIdRef.current}`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.exists) setIntakeState(json.state);
    } catch {
      /* ignore network blip */
    }
  }, []);

  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') {
      const t = setInterval(refreshState, 700);
      return () => clearInterval(t);
    }
    refreshState();
  }, [status, refreshState]);

  // Auto-scroll to newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const hasStarted = messages.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput('');
  };

  const startConversation = (withVoice: boolean) => {
    if (withVoice) voice.setVoiceMode(true);
    sendMessage({ text: 'Hi, I just checked in for my appointment.' });
  };

  const startConversationWithScenario = (seedText: string, withVoice: boolean) => {
    if (withVoice) voice.setVoiceMode(true);
    sendMessage({ text: seedText });
  };

  const startConversationFromBooking = (booking: BookingState) => {
    const name = [booking.fields.firstName, booking.fields.lastName].filter(Boolean).join(' ');
    const reason = booking.fields.reasonForVisit ?? '';
    const opener = `Hi, I'm ${name || 'a patient'} and I just booked an appointment${reason ? ` because ${reason.toLowerCase()}` : ''}.`;
    sendMessage({ text: opener });
  };

  const handleBookingConfirmed = (booking: BookingState) => {
    setConfirmedBooking(booking);
    setBookingOpen(false);
    // Auto-start the intake conversation so the patient flows naturally from
    // booking → clinical questions, with the visit reason seeded as opening
    // context. The CC will be captured as the agent re-confirms it.
    startConversationFromBooking(booking);
  };

  const generateBrief = async () => {
    setGeneratingBrief(true);
    setBriefError(null);
    try {
      const res = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ClinicalBrief;
      setBrief(json);
    } catch (e) {
      setBriefError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setGeneratingBrief(false);
    }
  };

  const resetSession = async () => {
    voice.cancelSpeech();
    await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionIdRef.current }),
    });
    sessionIdRef.current = nanoid(10);
    setMessages([]);
    setIntakeState(null);
    setBrief(null);
    setBriefError(null);
    lastHandledTurnRef.current = null;
  };

  const intakeComplete = intakeState?.intakeComplete ?? false;
  const ccCaptured = intakeState?.cc != null;

  const caseId = useMemo(
    () => `WRD-${sessionIdRef.current.slice(0, 6).toUpperCase()}`,
    [intakeState?.sessionId],
  );

  return (
    <div className="relative z-10 flex flex-col h-screen">
      {/* Top bar */}
      <header
        className="flex items-center justify-between px-6 py-3.5 border-b"
        style={{ borderColor: 'var(--rule-strong)', background: 'var(--paper)' }}
      >
        <div className="flex items-baseline gap-4">
          <div className="flex items-baseline gap-2">
            <span
              className="font-display text-xl tracking-tight"
              style={{ color: 'var(--ink)' }}
            >
              Wardly
            </span>
            <span style={{ color: 'var(--terracotta)' }}>·</span>
            <span className="section-label">Pre-visit intake</span>
            <span
              className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ml-1"
              style={{
                background: 'var(--paper-2)',
                border: '1px solid var(--rule)',
                color: 'var(--ink-3)',
              }}
              title="Take-home build for the Wardly Founding Engineer role"
            >
              demo
            </span>
          </div>
          <div className="hidden md:flex items-center gap-3 ml-2">
            <span className="font-mono text-[11px]" style={{ color: 'var(--ink-3)' }}>
              {caseId}
            </span>
            {confirmedBooking && (
              <span className="chip chip-filled">
                <span className="chip-dot" />
                appt requested · {confirmedBooking.fields.preferredDate ?? 'tbd'}
              </span>
            )}
            {voice.voiceMode && (
              <span className="chip chip-warn">
                <span className="chip-dot" />
                {voice.speaking ? 'agent speaking' : voice.listening ? 'listening' : 'voice mode'}
              </span>
            )}
            {!voice.voiceMode && status === 'streaming' && (
              <span className="chip chip-warn">
                <span className="chip-dot" />
                capturing
              </span>
            )}
            {intakeComplete && (
              <span className="chip chip-filled">
                <span className="chip-dot" />
                intake complete
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setBookingOpen(true)}
            className="btn"
            title="Open the appointment booking flow (voice-driven form)"
          >
            Book appointment
          </button>
          <button
            onClick={generateBrief}
            disabled={!ccCaptured || generatingBrief}
            className="btn btn-primary"
            title={
              !ccCaptured
                ? 'Capture a chief complaint first'
                : 'Generate the clinician handoff brief from the captured chart'
            }
          >
            {generatingBrief ? 'Synthesising…' : 'Generate brief'}
          </button>
          <button
            onClick={resetSession}
            className="btn"
            title="Clear all state and start a fresh intake"
          >
            Reset
          </button>
        </div>
      </header>

      {briefError && (
        <div
          className="px-6 py-2 text-[12px] border-b"
          style={{
            background: 'var(--rose-soft)',
            color: 'var(--rose-deep)',
            borderColor: 'var(--rose)',
          }}
        >
          Could not generate brief: {briefError}
        </div>
      )}

      {error && (
        <div
          className="px-6 py-2 text-[12px] border-b flex items-center justify-between gap-3"
          style={{
            background: 'var(--amber-soft)',
            color: '#6b4f1d',
            borderColor: 'var(--amber)',
          }}
        >
          <span>
            <strong>Connection issue.</strong>{' '}
            {/quota|rate|429/i.test(error.message)
              ? 'Free-tier rate limit hit on Gemini — wait ~60 s or try again.'
              : error.message.slice(0, 200)}
          </span>
          <button
            onClick={() => regenerate()}
            className="btn"
            style={{ padding: '4px 10px', fontSize: '11px' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Main grid */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_380px] overflow-hidden">
        {/* Conversation pane */}
        <main
          className="flex flex-col overflow-hidden border-r"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          <div className="flex-1 overflow-y-auto scroll-clinical px-6 md:px-12 py-8">
            {!hasStarted ? (
              <div className="max-w-xl mx-auto py-2 soft-in">
                {/* Hero */}
                <span className="section-label">About this demo</span>
                <h1
                  className="font-display text-4xl md:text-[44px] leading-[1.08] mt-2 mb-4"
                  style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}
                >
                  A pre-visit conversation that{' '}
                  <em className="font-display italic" style={{ color: 'var(--terracotta)' }}>
                    builds the brief
                  </em>{' '}
                  as you talk.
                </h1>
                <p
                  className="text-[15px] leading-relaxed mb-6"
                  style={{ color: 'var(--ink-2)' }}
                >
                  This intake assistant captures the chief complaint, HPI
                  (OLDCARTS), targeted ROS, and red-flag screening through a
                  hands-free voice or text conversation. The chart on the right
                  fills in real time as the agent records each clinical fact via
                  typed tool calls — then synthesises a clinician-ready brief at
                  the end.
                </p>

                {/* How to test */}
                <div
                  className="rounded-md p-4 mb-6"
                  style={{ background: 'var(--paper-2)', border: '1px solid var(--rule)' }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="section-label">How to test</span>
                    <span
                      className="font-mono text-[10px]"
                      style={{ color: 'var(--ink-3)' }}
                    >
                      ~60 seconds
                    </span>
                  </div>
                  <ol className="space-y-2.5">
                    {[
                      ['01', 'Pick a scenario below — or describe any symptom in your own words.'],
                      ['02', 'Watch the chart on the right fill as the assistant captures each detail.'],
                      ['03', (
                        <>
                          When you have shared enough, click{' '}
                          <strong>Generate brief</strong> for the clinician handoff.
                        </>
                      )],
                    ].map(([n, body], i) => (
                      <li key={i} className="flex gap-3 text-[14px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                        <span className="font-mono text-[11px] shrink-0 mt-1" style={{ color: 'var(--terracotta)' }}>
                          {n}
                        </span>
                        <span>{body}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Scenarios */}
                <span className="section-label block mb-2">Scenarios to try</span>
                <div className="grid gap-2 mb-7">
                  {[
                    {
                      title: 'Chest pain · 2 days',
                      seed: "I've had a sharp chest pain for two days, worse when I climb stairs.",
                      note: 'Best demonstrates red-flag detection and CV / respiratory ROS branching.',
                    },
                    {
                      title: 'Throbbing headache · yesterday',
                      seed: 'A throbbing headache started yesterday and light really bothers me.',
                      note: 'Tests neuro ROS, aura/photophobia, and pertinent negatives.',
                    },
                    {
                      title: 'RUQ abdominal pain · Saturday',
                      seed: 'My stomach has been hurting since Saturday, mostly upper-right after meals.',
                      note: 'Exercises GI ROS, biliary red-flag screen, and allergy capture.',
                    },
                  ].map((s) => (
                    <button
                      key={s.title}
                      onClick={() => startConversationWithScenario(s.seed, true)}
                      className="text-left rounded-md p-3 transition-colors"
                      style={{
                        background: 'var(--paper)',
                        border: '1px solid var(--rule)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--paper-2)';
                        e.currentTarget.style.borderColor = 'var(--rule-strong)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--paper)';
                        e.currentTarget.style.borderColor = 'var(--rule)';
                      }}
                    >
                      <div className="flex items-baseline justify-between mb-1">
                        <span
                          className="font-display text-[15px]"
                          style={{ color: 'var(--ink)' }}
                        >
                          {s.title}
                        </span>
                        <span
                          className="font-mono text-[10px]"
                          style={{ color: 'var(--terracotta)' }}
                        >
                          start →
                        </span>
                      </div>
                      <div
                        className="font-display italic text-[13px] mb-1"
                        style={{ color: 'var(--ink-2)' }}
                      >
                        &ldquo;{s.seed}&rdquo;
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                        {s.note}
                      </div>
                    </button>
                  ))}
                </div>

                {/* CTAs */}
                <span className="section-label block mb-2">Or start blank</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => startConversation(true)} className="btn btn-primary">
                    Begin voice intake →
                  </button>
                  <button
                    onClick={() => {
                      voice.setVoiceMode(true);
                      setBookingOpen(true);
                    }}
                    className="btn"
                  >
                    Book appointment first
                  </button>
                  <button onClick={() => startConversation(false)} className="btn">
                    Continue by text
                  </button>
                </div>
                <p
                  className="mt-3 text-[12px] leading-relaxed"
                  style={{ color: 'var(--ink-3)' }}
                >
                  Voice mode is hands-free: the assistant speaks each question and
                  the mic re-opens automatically when it finishes. You can switch
                  to text at any time.
                </p>

                {/* Build context for the reviewer */}
                <div
                  className="mt-8 pt-4 border-t"
                  style={{ borderColor: 'var(--rule)' }}
                >
                  <span className="section-label">About the build</span>
                  <p
                    className="text-[12px] mt-1.5 leading-relaxed"
                    style={{ color: 'var(--ink-3)' }}
                  >
                    Take-home for the Wardly Founding Engineer role. ~5-hour
                    time-box. The README walks through the slot-filling
                    architecture, model selection rationale (Groq{' '}
                    <code className="font-mono text-[11px] px-1 py-0.5 rounded" style={{ background: 'var(--paper-2)', border: '1px solid var(--rule)' }}>gpt-oss-20b</code>{' '}
                    for chat,{' '}
                    <code className="font-mono text-[11px] px-1 py-0.5 rounded" style={{ background: 'var(--paper-2)', border: '1px solid var(--rule)' }}>llama-4-scout</code>{' '}
                    for synthesis), and the design tradeoffs.
                  </p>
                </div>
              </div>
            ) : (
              <div className="max-w-2xl mx-auto">
                {/* One-time hint after the conversation has actually moved
                    forward (so it doesn't shout on the welcome screen). */}
                {!chartHintDismissed && messages.length >= 2 && intakeState?.cc && (
                  <div
                    className="mb-4 px-3 py-2.5 rounded-md flex items-center justify-between gap-3 soft-in"
                    style={{
                      background: 'var(--amber-soft)',
                      border: '1px solid var(--amber)',
                      color: '#6b4f1d',
                    }}
                  >
                    <span className="text-[12px] leading-snug">
                      Notice the chart on the right — every detail is being
                      recorded as a typed slot via tool calls. Click{' '}
                      <strong>Generate brief</strong> in the header when you have shared enough.
                    </span>
                    <button
                      onClick={() => setChartHintDismissed(true)}
                      className="font-mono text-[10px] px-2 py-1 rounded shrink-0"
                      style={{ color: '#6b4f1d', border: '1px solid var(--amber)' }}
                    >
                      Got it
                    </button>
                  </div>
                )}
                {messages.map((m) => (
                  <ChatMessage key={m.id} message={m} />
                ))}
                {status === 'submitted' && (
                  <div className="flex justify-start mb-3 soft-in">
                    <div className="bubble-agent" style={{ color: 'var(--ink-3)' }}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                          style={{ background: 'var(--ink-3)' }}
                        />
                        thinking
                      </span>
                    </div>
                  </div>
                )}
                {voice.interim && (
                  <div className="flex justify-end mb-3 opacity-60">
                    <div className="bubble-patient" style={{ background: 'var(--ink-2)' }}>
                      <em>{voice.interim}</em>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-3 px-6 md:px-12 py-4 border-t"
            style={{ borderColor: 'var(--rule-strong)', background: 'var(--paper)' }}
          >
            {voice.supported && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (voice.speaking) voice.cancelSpeech();
                    if (voice.listening) voice.stop();
                    else voice.start();
                  }}
                  className={`relative btn-mic ${voice.listening ? 'active' : ''}`}
                  aria-label={voice.listening ? 'Stop listening' : 'Speak'}
                  title={
                    voice.listening
                      ? 'Stop listening'
                      : voice.speaking
                      ? 'Interrupt agent and speak'
                      : 'Speak your answer'
                  }
                >
                  {voice.listening ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="2" y="2" width="10" height="10" rx="1.5" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M8 1.5C7.06 1.5 6.3 2.26 6.3 3.2v4.6c0 .94.76 1.7 1.7 1.7s1.7-.76 1.7-1.7V3.2c0-.94-.76-1.7-1.7-1.7Z"
                        stroke="currentColor"
                        strokeWidth="1.4"
                      />
                      <path
                        d="M3.5 7.2v.6a4.5 4.5 0 0 0 9 0v-.6M8 12.3v2.2"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => voice.setVoiceMode(!voice.voiceMode)}
                  className={`btn ${voice.voiceMode ? 'btn-primary' : ''}`}
                  style={{ padding: '8px 12px', fontSize: '11px' }}
                  title={
                    voice.voiceMode
                      ? 'Voice mode on — agent speaks and mic auto-opens'
                      : 'Turn on voice mode for hands-free conversation'
                  }
                >
                  Voice {voice.voiceMode ? 'on' : 'off'}
                </button>
              </>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                voice.speaking
                  ? 'Agent speaking — type or interrupt'
                  : voice.listening
                  ? voice.interim || 'Listening… you can also type here'
                  : hasStarted
                  ? 'Type your reply or tap the mic'
                  : 'Type or tap the mic to begin'
              }
              className="flex-1 px-4 py-3 rounded-full text-[14px] outline-none transition-colors"
              style={{
                background: 'var(--paper-2)',
                border: '1px solid var(--rule)',
                color: 'var(--ink)',
              }}
              disabled={status === 'streaming'}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!input.trim() || status === 'streaming'}
            >
              Send
            </button>
          </form>
        </main>

        {/* Sidebar */}
        <aside className="hidden md:flex flex-col overflow-hidden" style={{ background: 'var(--paper)' }}>
          <IntakeSidebar state={intakeState} />
        </aside>
      </div>

      {brief && <BriefView brief={brief} onClose={() => setBrief(null)} />}
      {bookingOpen && (
        <BookingModal
          onClose={() => setBookingOpen(false)}
          onConfirmed={handleBookingConfirmed}
        />
      )}
    </div>
  );
}
