'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { ChatMessage } from '@/components/chat-message';
import { useVoice } from '@/lib/use-voice';
import type { BookingFields, BookingState } from '@/lib/booking-schema';
import { newBookingState } from '@/lib/booking-schema';
import { deriveBookingStateFromMessages } from '@/lib/derive-state';

type Props = {
  onClose: () => void;
  onConfirmed: (state: BookingState) => void;
};

const FIELD_LABELS: Record<keyof BookingFields, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  dateOfBirth: 'Date of birth',
  phone: 'Phone',
  email: 'Email',
  preferredDate: 'Preferred date',
  preferredTime: 'Preferred time',
  reasonForVisit: 'Reason for visit',
  visitType: 'Visit type',
  insuranceProvider: 'Insurance',
  notes: 'Anything else',
};

const REQUIRED: (keyof BookingFields)[] = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'phone',
  'preferredDate',
  'preferredTime',
  'reasonForVisit',
];

export function BookingModal({ onClose, onConfirmed }: Props) {
  // Stable booking session id, separate from intake. Carries over to the
  // intake CC after confirm, but the LLM context is its own.
  const bookingIdRef = useRef<string>('');
  if (!bookingIdRef.current) bookingIdRef.current = `book-${nanoid(8)}`;

  const [input, setInput] = useState('');
  // Manual edits typed directly into form fields (separate from agent tool
  // calls). Sent on every /api/book request as `formOverrides` so the agent
  // sees the user's typed-in values in the next turn's stateBlock.
  const [overrides, setOverrides] = useState<Partial<BookingFields>>({});
  const [confirming, setConfirming] = useState(false);
  const [confirmedLocally, setConfirmedLocally] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Latest overrides in a ref so prepareSendMessagesRequest sees fresh values.
  const overridesRef = useRef(overrides);
  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

  const { messages, sendMessage, status, setMessages, error, regenerate } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/book',
      prepareSendMessagesRequest: ({ messages }) => ({
        body: {
          sessionId: bookingIdRef.current,
          messages,
          formOverrides: overridesRef.current,
        },
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

  // Stateless: derive booking state from the message stream's tool-call
  // history, then overlay manual user form edits. No server polling needed.
  const state: BookingState = useMemo(() => {
    const derived =
      messages.length > 0
        ? deriveBookingStateFromMessages(messages, bookingIdRef.current)
        : newBookingState(bookingIdRef.current);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === null) continue;
      // @ts-expect-error — keys come from BookingFields
      derived.fields[k] = v;
    }
    if (confirmedLocally) {
      derived.confirmed = true;
      derived.confirmedAt = derived.confirmedAt ?? Date.now();
    }
    return derived;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, overrides, confirmedLocally]);

  // Speak agent replies when voice mode is on. Booking opens with voice on by
  // default so the patient can answer hands-free; the hook auto-restarts the
  // mic when the agent finishes speaking.
  useEffect(() => {
    voice.setVoiceMode(true);
    // Run once at mount; no cleanup — closing modal cancels speech via handleClose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastHandledTurnRef = useRef<string | null>(null);
  useEffect(() => {
    if (!voice.voiceMode) return;
    if (status !== 'ready') return;
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!last || lastHandledTurnRef.current === last.id) return;
    lastHandledTurnRef.current = last.id;
    const text = last.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join('')
      .trim();
    if (text) {
      voice.speak(text);
    } else if (!voice.listening) {
      voice.start();
    }
  }, [messages, status, voice]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const startConversation = () => {
    sendMessage({ text: "Hi, I'd like to book an appointment." });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    sendMessage({ text: t });
    setInput('');
  };

  // User typing into a form field updates the local override map. Each
  // subsequent /api/book request includes the override so the agent sees the
  // edited value in the next turn's stateBlock — true two-way live mirror,
  // no server-side persistence required.
  const updateField = (key: keyof BookingFields, value: string) => {
    setOverrides((prev) => ({ ...prev, [key]: value || null }));
  };

  const f = state.fields;
  const missing = useMemo(() => REQUIRED.filter((k) => !f[k]), [f]);
  const isComplete = missing.length === 0;
  const isConfirmed = state.confirmed;

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      setConfirmedLocally(true);
      onConfirmed({ ...state, confirmed: true, confirmedAt: Date.now() });
    } finally {
      setConfirming(false);
    }
  };

  const handleClose = async () => {
    voice.cancelSpeech();
    if (voice.listening) voice.stop();
    setMessages([]);
    onClose();
  };

  const hasStarted = messages.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: 'rgba(20, 32, 27, 0.45)' }}
    >
      <div
        className="w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden rounded-lg shadow-2xl soft-in"
        style={{ background: 'var(--paper)', border: '1px solid var(--rule-strong)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: 'var(--rule-strong)', background: 'var(--paper-2)' }}
        >
          <div className="flex items-baseline gap-3">
            <span className="section-label">Wardly</span>
            <span className="font-display text-base" style={{ color: 'var(--ink)' }}>
              Book an appointment
            </span>
            {isConfirmed && (
              <span className="chip chip-filled">
                <span className="chip-dot" /> request confirmed
              </span>
            )}
            {!isConfirmed && isComplete && (
              <span className="chip chip-warn">
                <span className="chip-dot" /> ready to confirm
              </span>
            )}
          </div>
          <button
            onClick={handleClose}
            className="btn"
            style={{ padding: '5px 12px', fontSize: '11px' }}
          >
            Close
          </button>
        </div>

        {error && (
          <div
            className="px-5 py-2 text-[12px] border-b flex items-center justify-between gap-3"
            style={{
              background: 'var(--amber-soft)',
              color: '#6b4f1d',
              borderColor: 'var(--amber)',
            }}
          >
            <span>
              <strong>Connection issue.</strong>{' '}
              {/quota|rate|429/i.test(error.message)
                ? 'Free-tier rate limit hit — wait ~60 s or switch providers (see .env.local).'
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

        {/* Body grid */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_380px] overflow-hidden">
          {/* Conversation pane */}
          <div
            className="flex flex-col overflow-hidden border-r"
            style={{ borderColor: 'var(--rule-strong)' }}
          >
            <div className="flex-1 overflow-y-auto scroll-clinical px-6 md:px-8 py-6">
              {!hasStarted ? (
                <div className="max-w-md mx-auto mt-4 soft-in">
                  <span className="section-label">Voice booking</span>
                  <h2
                    className="font-display text-2xl md:text-3xl leading-[1.1] mt-2 mb-3"
                    style={{ color: 'var(--ink)', letterSpacing: '-0.015em' }}
                  >
                    Talk through your appointment request.
                  </h2>
                  <p
                    className="text-[14px] leading-relaxed mb-5"
                    style={{ color: 'var(--ink-2)' }}
                  >
                    Speak naturally — the assistant fills the form on the right
                    as you go through name, date of birth, contact, preferred
                    date and time, and reason for visit. You can edit any field
                    directly while the conversation runs.
                  </p>
                  <p
                    className="text-[12px] leading-relaxed mb-5"
                    style={{ color: 'var(--ink-3)' }}
                  >
                    The same slot-filling pattern as the clinical intake — proves the
                    architecture generalises beyond just symptoms. After confirming,
                    you transition straight into the intake conversation.
                  </p>
                  <button onClick={startConversation} className="btn btn-primary">
                    Begin →
                  </button>
                </div>
              ) : (
                <div className="max-w-2xl mx-auto">
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
              className="flex items-center gap-2 px-6 md:px-8 py-3 border-t"
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
                        : 'Turn on voice mode for hands-free booking'
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
                    : 'Type your reply or tap the mic'
                }
                className="flex-1 px-4 py-2.5 rounded-full text-[14px] outline-none"
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
          </div>

          {/* Form pane */}
          <aside
            className="flex flex-col overflow-y-auto scroll-clinical chart-rule"
            style={{ background: 'var(--paper)' }}
          >
            <div
              className="px-5 py-4 border-b"
              style={{ borderColor: 'var(--rule-strong)', background: 'var(--paper)' }}
            >
              <span className="section-label">Appointment request</span>
              <h3 className="font-display text-xl mt-1" style={{ color: 'var(--ink)' }}>
                Form
              </h3>
              <p className="text-[12px] mt-1" style={{ color: 'var(--ink-3)' }}>
                Fields fill as you talk — or edit any field directly.
              </p>
            </div>

            <div className="px-5 py-4 space-y-3">
              {(Object.keys(FIELD_LABELS) as (keyof BookingFields)[]).map((key) => {
                const value = f?.[key] ?? '';
                const required = REQUIRED.includes(key);
                const filled = !!value;
                const isLong = key === 'reasonForVisit' || key === 'notes';
                if (key === 'visitType') {
                  return (
                    <FormField key={key} label={FIELD_LABELS[key]} required={required} filled={filled}>
                      <select
                        value={value}
                        onChange={(e) => updateField(key, e.target.value)}
                        className="w-full px-3 py-2 rounded text-[13px] outline-none"
                        style={{
                          background: filled ? 'var(--forest-soft)' : 'var(--paper-2)',
                          border: `1px solid ${filled ? 'var(--forest-2)' : 'var(--rule)'}`,
                          color: 'var(--ink)',
                        }}
                      >
                        <option value="">—</option>
                        <option value="new-patient">New patient</option>
                        <option value="follow-up">Follow-up</option>
                        <option value="urgent">Urgent</option>
                        <option value="unsure">Not sure</option>
                      </select>
                    </FormField>
                  );
                }
                return (
                  <FormField key={key} label={FIELD_LABELS[key]} required={required} filled={filled}>
                    {isLong ? (
                      <textarea
                        value={value}
                        onChange={(e) => updateField(key, e.target.value)}
                        rows={2}
                        placeholder=""
                        className="w-full px-3 py-2 rounded text-[13px] outline-none resize-y min-h-[44px]"
                        style={{
                          background: filled ? 'var(--forest-soft)' : 'var(--paper-2)',
                          border: `1px solid ${filled ? 'var(--forest-2)' : 'var(--rule)'}`,
                          color: 'var(--ink)',
                        }}
                      />
                    ) : (
                      <input
                        value={value}
                        onChange={(e) => updateField(key, e.target.value)}
                        placeholder=""
                        className="w-full px-3 py-2 rounded text-[13px] outline-none"
                        style={{
                          background: filled ? 'var(--forest-soft)' : 'var(--paper-2)',
                          border: `1px solid ${filled ? 'var(--forest-2)' : 'var(--rule)'}`,
                          color: 'var(--ink)',
                        }}
                      />
                    )}
                  </FormField>
                );
              })}
            </div>

            <div
              className="mt-auto px-5 py-3 border-t"
              style={{ borderColor: 'var(--rule-strong)', background: 'var(--paper-2)' }}
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="font-mono text-[10px]" style={{ color: 'var(--ink-3)' }}>
                  {missing.length === 0
                    ? 'all required fields filled'
                    : `${missing.length} required missing`}
                </span>
              </div>
              <button
                onClick={handleConfirm}
                disabled={!isComplete || confirming}
                className="btn btn-primary w-full justify-center"
                title={
                  isComplete
                    ? 'Confirm appointment request'
                    : `Still need: ${missing.map((m) => FIELD_LABELS[m]).join(', ')}`
                }
              >
                {confirming
                  ? 'Confirming…'
                  : isConfirmed
                  ? 'Continue to intake →'
                  : 'Confirm request'}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  required,
  filled,
  children,
}: {
  label: string;
  required: boolean;
  filled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        className="flex items-center justify-between text-[10px] uppercase tracking-wider mb-1"
        style={{ color: filled ? 'var(--forest)' : 'var(--ink-3)' }}
      >
        <span>
          {label}
          {required && <span style={{ color: 'var(--terracotta)', marginLeft: 4 }}>*</span>}
        </span>
        {filled && <span className="font-mono">●</span>}
      </label>
      {children}
    </div>
  );
}
