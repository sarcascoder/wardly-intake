'use client';

import { useState } from 'react';
import type { ClinicalBrief } from '@/lib/clinical-schema';

function briefToMarkdown(brief: ClinicalBrief): string {
  const lines: string[] = [];
  const p = brief.patient;
  lines.push(`# Pre-visit clinical brief`);
  lines.push('');
  lines.push(
    `**Patient:** ${[p.name, p.age ? `${p.age}y` : null, p.sex].filter(Boolean).join(' · ') || '(not provided)'}`,
  );
  lines.push(
    `**Triage:** \`${brief.recommendedTriage.toUpperCase()}\` · Completeness: ${(brief.completenessScore * 100).toFixed(0)}% · Duration: ${brief.intakeDurationSeconds}s`,
  );
  lines.push('');
  if (brief.redFlags.length > 0) {
    lines.push(`## Red flags`);
    for (const r of brief.redFlags) {
      lines.push(`- **[${r.severity.toUpperCase()}]** ${r.description}`);
    }
    lines.push('');
  }
  lines.push(`## Chief complaint`);
  lines.push(`> ${brief.cc}`);
  lines.push('');
  lines.push(`## History of present illness`);
  lines.push(brief.hpi.narrative);
  lines.push('');
  lines.push(`### OLDCARTS`);
  const o = brief.hpi.oldcarts;
  const row = (k: string, v: unknown) =>
    v !== null && v !== undefined && (typeof v !== 'string' || v.length > 0)
      ? `- **${k}:** ${typeof v === 'object' ? JSON.stringify(v) : v}`
      : `- **${k}:** —`;
  lines.push(row('Onset', o.onset));
  lines.push(row('Location', o.location));
  lines.push(row('Duration', o.duration));
  lines.push(row('Character', o.character));
  lines.push(row('Aggravating', o.aggravating));
  lines.push(row('Relieving', o.relieving));
  lines.push(row('Timing', o.timing));
  lines.push(row('Severity (0–10)', o.severity));
  lines.push(
    row('Associated symptoms', o.associatedSymptoms?.length ? o.associatedSymptoms.join(', ') : null),
  );
  lines.push('');
  lines.push(`## Review of systems`);
  if (brief.ros.systems.length === 0) {
    lines.push(`_None probed._`);
  } else {
    for (const s of brief.ros.systems) {
      lines.push(`### ${s.system}`);
      if (s.positives.length > 0) lines.push(`- **Positives:** ${s.positives.join(', ')}`);
      if (s.negatives.length > 0) lines.push(`- **Negatives:** ${s.negatives.join(', ')}`);
    }
  }
  if (brief.ros.notAssessed.length > 0) {
    lines.push('');
    lines.push(`_Not assessed: ${brief.ros.notAssessed.join(', ')}._`);
  }
  lines.push('');
  if (brief.pertinentNegatives.length > 0) {
    lines.push(`## Pertinent negatives`);
    for (const n of brief.pertinentNegatives) lines.push(`- ${n}`);
    lines.push('');
  }
  lines.push(`## History`);
  lines.push(`- **Allergies:** ${brief.allergies.length > 0 ? brief.allergies.join(', ') : 'none reported'}`);
  lines.push(
    `- **Current medications:** ${brief.currentMedications.length > 0 ? brief.currentMedications.join(', ') : 'none reported'}`,
  );
  lines.push(
    `- **PMH:** ${brief.pastMedicalHistory.length > 0 ? brief.pastMedicalHistory.join(', ') : 'none reported'}`,
  );
  return lines.join('\n');
}

function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split('\n');
  const out: React.ReactNode[] = [];
  let listBuf: React.ReactNode[] = [];
  const flushList = () => {
    if (listBuf.length > 0) {
      out.push(<ul key={`ul-${out.length}`}>{listBuf}</ul>);
      listBuf = [];
    }
  };
  const inline = (s: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    const re = /\*\*(.+?)\*\*|`(.+?)`|_(.+?)_/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(s)) !== null) {
      if (m.index > lastIndex) parts.push(s.slice(lastIndex, m.index));
      if (m[1]) parts.push(<strong key={i++}>{m[1]}</strong>);
      else if (m[2]) parts.push(<code key={i++}>{m[2]}</code>);
      else if (m[3]) parts.push(<em key={i++}>{m[3]}</em>);
      lastIndex = re.lastIndex;
    }
    if (lastIndex < s.length) parts.push(s.slice(lastIndex));
    return parts;
  };
  for (const line of lines) {
    if (line.startsWith('# ')) {
      flushList();
      out.push(<h1 key={out.length}>{inline(line.slice(2))}</h1>);
    } else if (line.startsWith('## ')) {
      flushList();
      out.push(<h2 key={out.length}>{inline(line.slice(3))}</h2>);
    } else if (line.startsWith('### ')) {
      flushList();
      out.push(<h3 key={out.length}>{inline(line.slice(4))}</h3>);
    } else if (line.startsWith('> ')) {
      flushList();
      out.push(<blockquote key={out.length}>{inline(line.slice(2))}</blockquote>);
    } else if (line.startsWith('- ')) {
      listBuf.push(<li key={`li-${out.length}-${listBuf.length}`}>{inline(line.slice(2))}</li>);
    } else if (line.trim() === '') {
      flushList();
    } else {
      flushList();
      out.push(<p key={out.length}>{inline(line)}</p>);
    }
  }
  flushList();
  return out;
}

export function BriefView({ brief, onClose }: { brief: ClinicalBrief; onClose: () => void }) {
  const [tab, setTab] = useState<'brief' | 'json'>('brief');
  const md = briefToMarkdown(brief);

  const triageStyle =
    brief.recommendedTriage === 'emergency'
      ? { background: 'var(--rose-soft)', color: 'var(--rose-deep)', border: '1px solid var(--rose)' }
      : brief.recommendedTriage === 'urgent'
      ? { background: 'var(--amber-soft)', color: '#6b4f1d', border: '1px solid var(--amber)' }
      : brief.recommendedTriage === 'self-care'
      ? { background: 'var(--paper-2)', color: 'var(--ink-2)', border: '1px solid var(--rule)' }
      : { background: 'var(--forest-soft)', color: 'var(--forest)', border: '1px solid var(--forest-2)' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm" style={{ background: 'rgba(20, 32, 27, 0.45)' }}>
      <div
        className="w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden rounded-lg shadow-2xl soft-in"
        style={{ background: 'var(--paper)', border: '1px solid var(--rule-strong)' }}
      >
        {/* Header strip — case-file label */}
        <div
          className="flex items-center justify-between px-6 py-3 border-b"
          style={{ borderColor: 'var(--rule-strong)', background: 'var(--paper-2)' }}
        >
          <div className="flex items-baseline gap-3">
            <span className="section-label">Wardly</span>
            <span className="font-display text-base" style={{ color: 'var(--ink)' }}>
              Pre-visit brief
            </span>
            <span
              className="font-mono text-[9px] uppercase tracking-wider"
              style={{ color: 'var(--ink-3)' }}
              title="Synthesised from the structured slot store, not the raw transcript"
            >
              clinician handoff
            </span>
            <span
              className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded"
              style={triageStyle}
            >
              {brief.recommendedTriage}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setTab('brief')} className={`btn ${tab === 'brief' ? 'btn-primary' : ''}`} style={{ padding: '5px 12px', fontSize: '11px' }}>
              Brief
            </button>
            <button onClick={() => setTab('json')} className={`btn ${tab === 'json' ? 'btn-primary' : ''}`} style={{ padding: '5px 12px', fontSize: '11px' }}>
              JSON
            </button>
            <button onClick={onClose} className="btn" style={{ padding: '5px 12px', fontSize: '11px' }}>
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scroll-clinical px-8 py-7" style={{ background: 'var(--paper)' }}>
          {tab === 'brief' ? (
            <div className="brief-prose">{renderMarkdown(md)}</div>
          ) : (
            <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all"
              style={{ background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 6, padding: 16 }}
            >
              {JSON.stringify(brief, null, 2)}
            </pre>
          )}
        </div>

        <div
          className="px-6 py-3 flex items-center justify-between border-t"
          style={{ borderColor: 'var(--rule-strong)', background: 'var(--paper-2)' }}
        >
          <span className="font-mono text-[10px]" style={{ color: 'var(--ink-3)' }}>
            completeness {(brief.completenessScore * 100).toFixed(0)}% · intake {brief.intakeDurationSeconds}s
          </span>
          <button
            onClick={() => navigator.clipboard.writeText(md)}
            className="btn"
            style={{ padding: '5px 12px', fontSize: '11px' }}
          >
            Copy markdown
          </button>
        </div>
      </div>
    </div>
  );
}
