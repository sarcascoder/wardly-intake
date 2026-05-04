import type { UIMessage } from 'ai';

const TOOL_LABELS: Record<string, string> = {
  'tool-record_patient_demographics': 'demographics',
  'tool-record_cc': 'chief complaint',
  'tool-record_hpi_oldcarts': 'HPI · OLDCARTS',
  'tool-record_hpi_context': 'HPI · context',
  'tool-record_ros': 'ROS',
  'tool-flag_red_flag': 'red flag',
  'tool-record_pertinent_negative': 'pertinent negative',
  'tool-record_clinical_history': 'history',
  'tool-get_intake_status': 'status check',
  'tool-end_intake': 'intake complete',
};

export function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';

  const text = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('');

  const toolChips = !isUser
    ? message.parts
        .filter((p) => p.type.startsWith('tool-'))
        .map((p, i) => ({
          key: `${message.id}-tool-${i}`,
          label: TOOL_LABELS[p.type] ?? p.type.replace('tool-', ''),
          isFlag: p.type === 'tool-flag_red_flag',
        }))
    : [];

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 soft-in`}>
      <div className={`max-w-[78%] ${isUser ? 'order-2' : 'order-1'}`}>
        {!isUser && (
          <div className="section-label mb-1.5 ml-1">Intake assistant</div>
        )}
        <div className={isUser ? 'bubble-patient' : 'bubble-agent'}>
          {text || (!isUser && toolChips.length > 0 && (
            <span className="text-xs italic" style={{ color: 'var(--ink-3)' }}>
              (recording details — see chart)
            </span>
          ))}
        </div>
        {toolChips.length > 0 && (
          <div className="mt-2 ml-1 flex flex-wrap gap-1.5">
            {toolChips.map((c) => (
              <span key={c.key} className={`chip ${c.isFlag ? 'chip-flag' : 'chip-filled'}`}>
                <span className="chip-dot" />
                {c.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
