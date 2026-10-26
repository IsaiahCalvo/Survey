/**
 * TypedAnswerInput — the answer control for a checklist item that is not
 * pick-one (nightly 'custom-answers'), shown where pick-one items show their
 * answer buttons:
 * - text / number: a box (number with its unit). Commits on Enter or when
 *   focus leaves; Escape puts the saved value back. A box that gets no
 *   valid value keeps the old answer.
 * - score: buttons 1..5 (a list for 1..10); a score at or below the issue
 *   line lights red. Pressing the lit score again clears it.
 * - count: - box +.
 * - date: the system date picker.
 */
import { useState } from 'react';
import { itemKind, scoreScaleOf, typedAnswer, typedAnswerIsIssue, TYPED_ANSWER_MAX } from '../services/answerSets.js';

const boxStyle = (phone, width, align = 'left') => ({
  width,
  height: phone ? 32 : 22,
  font: 'inherit',
  fontSize: phone ? 14 : 'var(--sv-small-type)',
  color: 'var(--text-1)',
  background: 'var(--panel-well)',
  border: 0,
  borderRadius: 6,
  padding: '0 6px',
  textAlign: align,
});

const stop = (e) => e.stopPropagation();

function TypedBox({ item, saved, onCommit, phone, number, width }) {
  const [draft, setDraft] = useState(null); // null = showing the saved value
  const commit = () => {
    if (draft === null) return;
    const next = typedAnswer(item, draft);
    setDraft(null);
    if (next !== null && next !== saved) onCommit(next);
  };
  return (
    <input
      type="text"
      inputMode={number ? (itemKind(item) === 'count' ? 'numeric' : 'decimal') : 'text'}
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
      onClick={stop}
      style={boxStyle(phone, width, number ? 'right' : 'left')}
    />
  );
}

function ScoreAnswer({ item, saved, onCommit, phone }) {
  const top = scoreScaleOf(item);
  const label = item?.text || 'Checklist';
  if (top > 5) {
    return (
      <select
        aria-label={`${label} score`}
        value={saved}
        onClick={stop}
        onChange={(e) => { if (e.target.value !== saved) onCommit(e.target.value); }}
        style={boxStyle(phone, phone ? 72 : 56)}
      >
        <option value="">–</option>
        {Array.from({ length: top }, (_, i) => String(i + 1)).map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    );
  }
  const group = phone ? 'mobile-survey-check-group' : 'survey-rail__answers';
  const button = phone ? 'mobile-survey-check-btn' : 'survey-rail__answer';
  return (
    <div className={group} role="group" aria-label={`${label} score`}>
      {Array.from({ length: top }, (_, i) => String(i + 1)).map((v) => {
        const on = saved === v;
        const tone = typedAnswerIsIssue(item, v) ? 'is-no' : 'is-yes';
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            aria-label={`${label} ${v}`}
            className={`${button}${on ? ` is-active ${tone}` : ''}`}
            onClick={(e) => { stop(e); onCommit(on ? '' : v); }}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}

function CountAnswer({ item, saved, onCommit, phone }) {
  const n = saved === '' ? null : Number(saved);
  const button = phone ? 'mobile-survey-check-btn' : 'survey-rail__answer';
  const label = item?.text || 'Checklist';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        className={button}
        aria-label={`${label} one less`}
        disabled={!n}
        onClick={(e) => { stop(e); onCommit(String(n - 1)); }}
      >
        −
      </button>
      <TypedBox item={item} saved={saved} onCommit={onCommit} phone={phone} number width={phone ? 48 : 36} />
      <button
        type="button"
        className={button}
        aria-label={`${label} one more`}
        onClick={(e) => { stop(e); onCommit(String((n ?? 0) + 1)); }}
      >
        +
      </button>
    </span>
  );
}

export default function TypedAnswerInput({ item, value, onCommit, className, phone = false }) {
  const saved = value == null ? '' : String(value);
  const kind = itemKind(item);
  let control;
  if (kind === 'score') control = <ScoreAnswer item={item} saved={saved} onCommit={onCommit} phone={phone} />;
  else if (kind === 'count') control = <CountAnswer item={item} saved={saved} onCommit={onCommit} phone={phone} />;
  else if (kind === 'date') {
    control = (
      <input
        type="date"
        aria-label={`${item?.text || 'Checklist'} date`}
        value={typedAnswer(item, saved) || ''}
        onClick={stop}
        onChange={(e) => {
          const next = typedAnswer(item, e.target.value);
          if (next !== null && next !== saved) onCommit(next);
        }}
        style={{
          ...boxStyle(phone, phone ? 150 : 128),
          color: typedAnswerIsIssue(item, saved) ? 'var(--danger-text)' : 'var(--text-1)',
        }}
      />
    );
  } else {
    const number = kind === 'number';
    control = <TypedBox item={item} saved={saved} onCommit={onCommit} phone={phone} number={number} width={number ? (phone ? 72 : 56) : (phone ? 140 : 110)} />;
  }
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {control}
      {kind === 'number' && item?.unit ? <span style={{ fontSize: phone ? 13 : 'var(--sv-small-type)', color: 'var(--text-3)' }}>{item.unit}</span> : null}
    </span>
  );
}
