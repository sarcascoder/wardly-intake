'use client';

import type { IntakeState } from '@/lib/clinical-schema';

function SlotRow({
  filled,
  k,
  v,
}: {
  filled: boolean;
  k: string;
  v?: string | null;
}) {
  return (
    <div className="slot-row">
      <div className={`slot-bullet ${filled ? 'filled' : ''}`}>{filled ? '●' : '○'}</div>
      <div>
        <div className={`slot-key ${filled ? 'filled' : ''}`}>{k}</div>
        {filled && v ? <div className="slot-value">{v}</div> : null}
      </div>
    </div>
  );
}

function Section({
  label,
  index,
  children,
}: {
  label: string;
  index: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <div className="flex items-baseline justify-between mb-2 pb-1 border-b border-(--rule-strong)">
        <h3 className="section-label" style={{ color: 'var(--ink)' }}>{label}</h3>
        <span className="font-mono text-[10px]" style={{ color: 'var(--ink-soft)' }}>
          {index}
        </span>
      </div>
      <div>{children}</div>
    </section>
  );
}

export function IntakeSidebar({ state }: { state: IntakeState | null }) {
  if (!state) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="px-5 py-4 border-b border-(--rule-strong)"
          style={{ background: 'var(--paper)' }}
        >
          <span className="section-label">Pre-visit chart</span>
          <h2 className="font-display text-2xl mt-1" style={{ color: 'var(--ink)' }}>
            Live intake
          </h2>
        </div>
        <div className="flex-1 px-5 py-5 chart-rule" style={{ background: 'var(--paper)' }}>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            This is where the patient&apos;s structured chart assembles in real
            time as the intake assistant captures each clinical fact through
            the conversation on the left.
          </p>
          <ul className="mt-3 space-y-1.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
            <li className="flex gap-2">
              <span className="font-mono shrink-0">•</span>
              <span>Section §1–§7 fills as patient details are recorded.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-mono shrink-0">•</span>
              <span>Filled slots turn sage-green; empty slots stay outlined.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-mono shrink-0">•</span>
              <span>Red flags appear in their own panel when detected.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-mono shrink-0">•</span>
              <span>The progress bar above shows overall completeness.</span>
            </li>
          </ul>
          <div
            className="mt-5 pt-4 border-t text-[11px] leading-relaxed"
            style={{ borderColor: 'var(--rule)', color: 'var(--ink-3)' }}
          >
            The brief generated at the end is built from this state, not from
            the raw transcript — so the clinician sees only what the agent
            actually captured.
          </div>
        </div>
      </div>
    );
  }

  const o = state.hpi.oldcarts;
  const totalSlots = 16;
  const filledSlots =
    (state.cc ? 1 : 0) +
    (o.onset ? 1 : 0) +
    (o.location ? 1 : 0) +
    (o.duration ? 1 : 0) +
    (o.character ? 1 : 0) +
    (o.aggravating ? 1 : 0) +
    (o.relieving ? 1 : 0) +
    (o.timing ? 1 : 0) +
    (o.severity !== null ? 1 : 0) +
    (o.associatedSymptoms.length > 0 ? 1 : 0) +
    (state.hpi.context ? 1 : 0) +
    Math.min(2, Object.keys(state.ros).length) +
    (state.allergies.length > 0 ? 1 : 0) +
    (state.currentMedications.length > 0 ? 1 : 0);
  const completeness = Math.min(1, filledSlots / totalSlots);

  const startedDate = new Date(state.startedAt);
  const caseId = `WRD-${state.sessionId.slice(0, 6).toUpperCase()}`;

  return (
    <div className="flex flex-col h-full">
      {/* Chart header — looks like a clinical case file label */}
      <div
        className="px-5 py-4 border-b border-(--rule-strong)"
        style={{ background: 'var(--paper)' }}
      >
        <div className="flex items-baseline justify-between mb-1">
          <span className="section-label">Pre-visit chart</span>
          <span className="font-mono text-[10px]" style={{ color: 'var(--ink-soft)' }}>
            {caseId}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-2xl" style={{ color: 'var(--ink)' }}>
            Live intake
          </h2>
          <span className="font-mono text-[10px]" style={{ color: 'var(--ink-3)' }}>
            {startedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-[3px] bg-(--paper-3) rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${completeness * 100}%`,
                background: state.intakeComplete ? 'var(--forest)' : 'var(--terracotta)',
              }}
            />
          </div>
          <span
            className="font-mono text-[10px] tabular-nums"
            style={{ color: 'var(--ink-3)' }}
          >
            {String(Math.round(completeness * 100)).padStart(2, '0')}%
          </span>
        </div>
        {state.intakeComplete && (
          <div className="mt-2 chip chip-filled">
            <span className="chip-dot" />
            intake complete
          </div>
        )}
      </div>

      {/* Chart body */}
      <div
        className="flex-1 overflow-y-auto px-5 py-5 chart-rule scroll-clinical"
        style={{ backgroundColor: 'var(--paper)' }}
      >
        <Section label="Patient" index="§1">
          <SlotRow filled={state.patient.name !== null} k="Name" v={state.patient.name ?? undefined} />
          <SlotRow filled={state.patient.age !== null} k="Age" v={state.patient.age?.toString()} />
          <SlotRow filled={state.patient.sex !== null} k="Sex" v={state.patient.sex ?? undefined} />
        </Section>

        <Section label="Chief complaint" index="§2">
          {state.cc ? (
            <blockquote
              className="font-display italic text-[15px] leading-snug pl-3"
              style={{ borderLeft: '2px solid var(--terracotta)', color: 'var(--ink)' }}
            >
              &ldquo;{state.cc.verbatim}&rdquo;
            </blockquote>
          ) : (
            <SlotRow filled={false} k="Awaiting CC" />
          )}
        </Section>

        <Section label="HPI · OLDCARTS" index="§3">
          <SlotRow filled={o.onset !== null} k="Onset" v={o.onset ?? undefined} />
          <SlotRow filled={o.location !== null} k="Location" v={o.location ?? undefined} />
          <SlotRow filled={o.duration !== null} k="Duration" v={o.duration ?? undefined} />
          <SlotRow filled={o.character !== null} k="Character" v={o.character ?? undefined} />
          <SlotRow filled={o.aggravating !== null} k="Aggravating" v={o.aggravating ?? undefined} />
          <SlotRow filled={o.relieving !== null} k="Relieving" v={o.relieving ?? undefined} />
          <SlotRow filled={o.timing !== null} k="Timing" v={o.timing ?? undefined} />
          <SlotRow
            filled={o.severity !== null}
            k="Severity 0–10"
            v={o.severity?.toString()}
          />
          <SlotRow
            filled={o.associatedSymptoms.length > 0}
            k="Associated"
            v={o.associatedSymptoms.length > 0 ? o.associatedSymptoms.join(', ') : undefined}
          />
          {state.hpi.context && (
            <SlotRow filled={true} k="Context" v={state.hpi.context} />
          )}
          {state.hpi.priorEpisodes && (
            <SlotRow filled={true} k="Prior episodes" v={state.hpi.priorEpisodes} />
          )}
        </Section>

        {Object.values(state.ros).length > 0 && (
          <Section label="Review of systems" index="§4">
            {Object.values(state.ros).map((r) => (
              <div key={r.system} className="py-2">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="font-display text-[13px] capitalize" style={{ color: 'var(--ink)' }}>
                    {r.system}
                  </span>
                </div>
                {r.positives.length > 0 && (
                  <div
                    className="text-[12px] leading-relaxed pl-2"
                    style={{ color: 'var(--forest)' }}
                  >
                    <span className="font-mono mr-1">+</span>
                    {r.positives.join(', ')}
                  </div>
                )}
                {r.negatives.length > 0 && (
                  <div
                    className="text-[12px] leading-relaxed pl-2 mt-0.5"
                    style={{ color: 'var(--ink-3)' }}
                  >
                    <span className="font-mono mr-1">−</span>
                    {r.negatives.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </Section>
        )}

        {state.redFlags.length > 0 && (
          <Section label="Red flags" index="§5">
            {state.redFlags.map((r, i) => (
              <div
                key={i}
                className="mb-2 py-2 px-3 rounded"
                style={{
                  background:
                    r.severity === 'high'
                      ? 'var(--rose-soft)'
                      : r.severity === 'moderate'
                      ? 'var(--amber-soft)'
                      : 'var(--paper-2)',
                  border:
                    r.severity === 'high'
                      ? '1px solid var(--rose)'
                      : r.severity === 'moderate'
                      ? '1px solid var(--amber)'
                      : '1px solid var(--rule)',
                  color:
                    r.severity === 'high'
                      ? 'var(--rose-deep)'
                      : r.severity === 'moderate'
                      ? '#6b4f1d'
                      : 'var(--ink)',
                }}
              >
                <div className="font-mono text-[10px] uppercase tracking-wider mb-0.5">
                  {r.severity}
                </div>
                <div className="text-[13px]">{r.description}</div>
              </div>
            ))}
          </Section>
        )}

        {state.pertinentNegatives.length > 0 && (
          <Section label="Pertinent negatives" index="§6">
            <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              {state.pertinentNegatives.join('; ')}
            </div>
          </Section>
        )}

        <Section label="History" index="§7">
          <SlotRow
            filled={state.allergies.length > 0}
            k="Allergies"
            v={state.allergies.length > 0 ? state.allergies.join(', ') : undefined}
          />
          <SlotRow
            filled={state.currentMedications.length > 0}
            k="Current meds"
            v={
              state.currentMedications.length > 0 ? state.currentMedications.join(', ') : undefined
            }
          />
          <SlotRow
            filled={state.pastMedicalHistory.length > 0}
            k="PMH"
            v={
              state.pastMedicalHistory.length > 0 ? state.pastMedicalHistory.join(', ') : undefined
            }
          />
        </Section>
      </div>
    </div>
  );
}
