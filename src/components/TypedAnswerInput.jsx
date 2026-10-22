/**
 * TypedAnswerInput — the answer box for a text or number checklist item
 * (nightly 'custom-answers'), shown where pick-one items show their answer
 * buttons. Commits on Enter or when focus leaves; Escape puts the saved value
 * back. A number item that gets no number keeps its old answer.
 */
import { useState } from 'react';
import { itemKind, typedAnswer, TYPED_ANSWER_MAX } from '../services/answerSets.js';

export default function TypedAnswerInput({ item, value, onCommit, className, phone = false }) {
  const saved = value ?? '';
  const [draft, setDraft] = useState(null); // null = showing the saved value
  const number = itemKind(item) === 'number';
  const commit = () => {
    if (draft === null) return;
    const next = typedAnswer(item, draft);
    setDraft(null);
    if (next !== null && next !== saved) onCommit(next);
  };
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input
        type="text"
        inputMode={number ? 'decimal' : 'text'}
        aria-label={`${item?.text || 'Checklist'} answer`}
        value={draft ?? saved}
        maxLength={TYPED_ANSWER_MAX}
        placeholder={number ? '#' : 'Type'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') setDraft(null);
        }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: number ? (phone ? 72 : 56) : (phone ? 140 : 110),
          height: phone ? 32 : 22,
          font: 'inherit',
          fontSize: phone ? 14 : 'var(--sv-small-type)',
          color: 'var(--text-1)',
          background: 'var(--panel-well)',
          border: 0,
          borderRadius: 6,
          padding: '0 6px',
          textAlign: number ? 'right' : 'left',
        }}
      />
      {item?.unit ? <span style={{ fontSize: phone ? 13 : 'var(--sv-small-type)', color: 'var(--text-3)' }}>{item.unit}</span> : null}
    </span>
  );
}
