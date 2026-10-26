/**
 * AnswerSetEditor — type a template's own checklist answers (nightly flag
 * 'custom-answers'): 1 to 6 answers, each marked Good, Problem or Neutral,
 * with an optional "means" line.
 * Good and Neutral answers count as done; Problem answers show as issues.
 *
 * The typed list is a local draft. It reaches the template only while it is
 * usable (answerSets.cleanAnswerSet), so a half-typed list never replaces the
 * last good one and nothing downstream (card buttons, Excel drop-down, agent)
 * ever sees a broken set.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './HubShell';
import {
  ANSWER_MEANS_MAX, ITEM_UNIT_MAX, MAX_ANSWERS, MIN_ANSWERS, answerSetProblem, cleanAnswerSet, sameAnswerSet,
} from '../services/answerSets.js';

const TONE_OPTIONS = [
  { value: 'good', label: 'Good' },
  { value: 'bad', label: 'Problem' },
  { value: 'neutral', label: 'Neutral' },
];

const fieldStyle = {
  font: 'inherit', fontSize: 12, color: 'var(--ink)', background: 'transparent',
  border: '1px solid var(--rule)', borderRadius: 4, padding: '3px 6px', minWidth: 0,
};

const toDraft = (a) => ({ value: a.value, tone: a.tone, means: a.means || '' });

export default function AnswerSetEditor({ set, onCommit, onClose, phone = false }) {
  const [draft, setDraft] = useState(() => set.map(toDraft));
  // The set this editor last wrote. Any other change from outside (Cancel,
  // a reload, picking a preset) replaces the draft.
  const lastWritten = useRef(set);
  useEffect(() => {
    if (sameAnswerSet(set, lastWritten.current)) return;
    lastWritten.current = set;
    setDraft(set.map(toDraft));
  }, [set]);

  const update = (next) => {
    setDraft(next);
    const clean = cleanAnswerSet(next);
    if (clean && !sameAnswerSet(clean, lastWritten.current)) {
      lastWritten.current = clean;
      onCommit(clean);
    }
  };
  const problem = answerSetProblem(draft);
  const pad = phone ? '8px 16px 12px' : '8px 18px 10px';

  return (
    <div
      className="hub-answer-set-editor"
      data-testid="answer-set-editor"
      style={{ padding: pad, borderBottom: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <p className="micro" style={{ margin: 0 }}>
        Your answers. Good and Neutral count as done; Problem shows as an issue.
        A "means" line shows as a hint on the answer and helps the voice agent pick it.
      </p>
      {draft.map((a, i) => (
        <div key={i} style={{ display: 'flex', flexWrap: phone ? 'wrap' : 'nowrap', gap: 6, alignItems: 'center' }}>
          <input
            aria-label={`Answer ${i + 1}`}
            value={a.value}
            maxLength={20}
            placeholder={`Answer ${i + 1}`}
            onChange={(e) => update(draft.map((d, j) => (j === i ? { ...d, value: e.target.value } : d)))}
            style={{ ...fieldStyle, flex: 1, fontSize: phone ? 14 : 12, height: phone ? 36 : undefined }}
          />
          <input
            aria-label={`What answer ${i + 1} means`}
            value={a.means}
            maxLength={ANSWER_MEANS_MAX}
            placeholder="Means… (optional)"
            onChange={(e) => update(draft.map((d, j) => (j === i ? { ...d, means: e.target.value } : d)))}
            style={{
              ...fieldStyle, flex: phone ? '1 1 100%' : 2, order: phone ? 1 : 0,
              fontSize: phone ? 14 : 12, height: phone ? 36 : undefined, color: 'var(--text-2, var(--ink))',
            }}
          />
          <select
            aria-label={`Answer ${i + 1} counts as`}
            value={a.tone}
            onChange={(e) => update(draft.map((d, j) => (j === i ? { ...d, tone: e.target.value } : d)))}
            style={{ ...fieldStyle, fontSize: phone ? 14 : 12, height: phone ? 36 : undefined }}
          >
            {TONE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button
            type="button"
            aria-label={`Remove answer ${i + 1}`}
            className="hub-icon-btn is-danger"
            disabled={draft.length <= MIN_ANSWERS}
            onClick={() => update(draft.filter((_, j) => j !== i))}
          ><Icon name="close" size={11} /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          disabled={draft.length >= MAX_ANSWERS}
          onClick={() => update([...draft, { value: '', tone: 'neutral', means: '' }])}
          style={{
            padding: '4px 10px', border: '1px dashed var(--rule-strong)', background: 'transparent',
            color: 'var(--ink-muted)', borderRadius: 2, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <Icon name="plus" size={12} /> Add answer
        </button>
        <span className="micro" style={{ flex: 1 }}>{draft.length} of {MAX_ANSWERS}</span>
        <button
          type="button"
          onClick={onClose}
          disabled={Boolean(problem)}
          style={{
            padding: '4px 12px', border: '1px solid var(--rule)', background: 'transparent',
            color: 'var(--ink)', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Done
        </button>
      </div>
      {problem && <p role="alert" className="micro" style={{ margin: 0, color: 'var(--danger, #c0392b)' }}>{problem}</p>}
    </div>
  );
}

const KIND_OPTIONS = [
  { value: 'choice', label: 'Pick one' },
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
];

/**
 * How one checklist item is answered: the template's buttons (Pick one), a
 * text box, or a number with an optional unit ("ft", "V").
 */
export function ItemKindPicker({ item, onChange, phone = false }) {
  const kind = item.kind === 'text' || item.kind === 'number' ? item.kind : 'choice';
  const size = { fontSize: phone ? 13 : 11, height: phone ? 32 : undefined };
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <select
        aria-label={`How "${item.text || 'this item'}" is answered`}
        value={kind}
        onChange={(e) => onChange(e.target.value, kind === 'number' ? item.unit : '')}
        style={{ ...fieldStyle, ...size, padding: '1px 4px', color: 'var(--text-2)' }}
      >
        {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
      {kind === 'number' && (
        <input
          aria-label={`Unit for "${item.text || 'this item'}"`}
          defaultValue={item.unit || ''}
          key={item.unit || ''}
          maxLength={ITEM_UNIT_MAX}
          placeholder="unit"
          onBlur={(e) => { const u = e.currentTarget.value.trim(); if (u !== (item.unit || '')) onChange('number', u); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          style={{ ...fieldStyle, ...size, width: phone ? 56 : 44, padding: '1px 4px' }}
        />
      )}
    </span>
  );
}
