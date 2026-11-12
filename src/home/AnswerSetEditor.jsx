/**
 * AnswerSetEditor — type a template's own checklist answers (flag
 * 'custom-answers'): one or more answers, no upper limit, each with a colour:
 * green (fine), red (an issue) or grey (doesn't count), and an optional
 * "means" line kept behind "More" (owner 2026-11-12).
 * Green and grey answers count as done; red answers show as issues.
 *
 * The typed list is a local draft. Only a usable list
 * (answerSets.cleanAnswerSet) ever reaches the template, so nothing
 * downstream (card buttons, Excel drop-down, agent) sees a broken set.
 * Inline, a usable list is written as you type. With `modal` it opens as a
 * dialog and is written once, on Save; Cancel keeps the old list.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './HubShell';
import BodyPortal from '../components/BodyPortal';
import DialogCard from '../components/DialogCard.jsx';
import ValueSelect from '../components/ValueSelect.jsx';
import { hoverOnly, useTooltip } from '../components/Tooltip';
import {
  ANSWER_MEANS_MAX, EXCEL_LIST_MAX, ITEM_UNIT_MAX, SCORE_SCALES, excelAnswerListFormula, itemAnswerFields, MIN_ANSWERS, answerSetProblem, cleanAnswerSet,
  sameAnswerSet,
} from '../services/answerSets.js';
import { showIfChoices, showIfOf } from '../services/conditionalLines.js';
import './AnswerSetPicker.css';

// Named by colour and what it does (owner 2026-11-12: Good / Problem /
// Neutral said nothing). The saved tones stay good / bad / neutral.
const TONE_OPTIONS = [
  { value: 'good', label: 'Green: fine' },
  { value: 'bad', label: 'Red: issue' },
  { value: 'neutral', label: 'Grey: doesn\'t count' },
];
const TONE_DOT = { good: 'var(--success-plate)', bad: 'var(--danger-plate)', neutral: 'var(--border-strong, var(--border))' };
const toneDot = (tone) => (
  <span
    aria-hidden="true"
    style={{ flex: 'none', width: 10, height: 10, borderRadius: '50%', background: TONE_DOT[tone] || TONE_DOT.neutral }}
  />
);

const fieldStyle = {
  font: 'inherit', fontSize: 12, color: 'var(--ink)', background: 'transparent',
  border: '1px solid var(--rule)', borderRadius: 4, padding: '3px 6px', minWidth: 0,
};

const stopEvent = (e) => e.stopPropagation();

const toDraft = (a) => ({ value: a.value, tone: a.tone, means: a.means || '' });

/**
 * modal: { kicker, title } opens the editor as a dialog with Cancel / Save.
 */
export default function AnswerSetEditor({ set, onCommit, onClose, phone = false, intro = null, modal = null }) {
  const [draft, setDraft] = useState(() => set.map(toDraft));
  // The "means" lines sit behind "More"; open already when any is filled.
  const [showMeans, setShowMeans] = useState(() => set.some((a) => a.means));
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
    if (modal) return;
    const clean = cleanAnswerSet(next);
    if (clean && !sameAnswerSet(clean, lastWritten.current)) {
      lastWritten.current = clean;
      onCommit(clean);
    }
  };
  const save = () => {
    const clean = cleanAnswerSet(draft);
    if (!clean) return;
    if (!sameAnswerSet(clean, set)) onCommit(clean);
    onClose();
  };
  const problem = answerSetProblem(draft);
  const pad = modal ? 0 : phone ? '8px 16px 12px' : '8px 18px 10px';

  const body = (
    <div
      className="hub-answer-set-editor"
      data-testid="answer-set-editor"
      style={{
        padding: pad, borderBottom: modal ? 0 : '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 6,
      }}
    >
      <p className="micro" style={{ margin: 0 }}>
        {intro || 'Name each answer and pick its colour.'}
      </p>
      {showMeans && (
        <p className="micro" style={{ margin: 0 }}>
          What each answer means (optional), for example N/A: &ldquo;not in our scope of work&rdquo;.
        </p>
      )}
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
          {showMeans && (
            <input
              aria-label={`What answer ${i + 1} means`}
              value={a.means}
              maxLength={ANSWER_MEANS_MAX}
              placeholder="What it means (optional)"
              onChange={(e) => update(draft.map((d, j) => (j === i ? { ...d, means: e.target.value } : d)))}
              style={{
                ...fieldStyle, flex: phone ? '1 1 100%' : 2, order: phone ? 1 : 0,
                fontSize: phone ? 14 : 12, height: phone ? 36 : undefined, color: 'var(--text-2, var(--ink))',
              }}
            />
          )}
          {toneDot(a.tone)}
          {phone ? (
            <select
              aria-label={`Answer ${i + 1} counts as`}
              value={a.tone}
              onChange={(e) => update(draft.map((d, j) => (j === i ? { ...d, tone: e.target.value } : d)))}
              style={{ ...fieldStyle, fontSize: 14, height: 36 }}
            >
              {TONE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          ) : (
            <ValueSelect
              size="sm"
              width="150px"
              label={`Answer ${i + 1} counts as`}
              value={a.tone}
              options={TONE_OPTIONS}
              onChange={(tone) => update(draft.map((d, j) => (j === i ? { ...d, tone } : d)))}
            />
          )}
          <button
            type="button"
            aria-label={`Remove answer ${i + 1}`}
            className={`hub-icon-btn is-danger${phone ? ' hub-answer-set-editor__remove--phone' : ''}`}
            disabled={draft.length <= MIN_ANSWERS}
            onClick={() => update(draft.filter((_, j) => j !== i))}
          ><Icon name="close" size={11} /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => update([...draft, { value: '', tone: 'neutral', means: '' }])}
          style={{
            padding: '4px 10px', border: '1px dashed var(--rule-strong)', background: 'transparent',
            color: 'var(--ink-muted)', borderRadius: 2, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <Icon name="plus" size={12} /> Add answer
        </button>
        {!showMeans && (
          <button
            type="button"
            aria-label="More: what each answer means"
            onClick={() => setShowMeans(true)}
            style={{
              padding: '4px 10px', border: 0, background: 'transparent', color: 'var(--ink-muted)',
              fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            More
          </button>
        )}
        <span style={{ flex: 1 }} />
        {!modal && (
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
        )}
      </div>
      {problem && <p role="alert" className="micro" style={{ margin: 0, color: 'var(--danger, #c0392b)' }}>{problem}</p>}
      {!problem && !intro && excelAnswerListFormula(draft.map((d) => ({ value: String(d.value).trim() }))).length > EXCEL_LIST_MAX && (
        <p className="micro" style={{ margin: 0 }}>
          This list is too long for an Excel drop-down, so the Excel sheet will take typed answers instead.
        </p>
      )}
    </div>
  );
  if (!modal) return body;
  return (
    <BodyPortal>
      {/* A portal still bubbles React events to the row that opened it (drag,
          select), so they stop here. */}
      <div onPointerDown={stopEvent} onMouseDown={stopEvent} onKeyDown={stopEvent} onClick={stopEvent}>
        <DialogCard
          title={modal.kicker}
          ariaLabel={modal.title}
          message={modal.title}
          onClose={onClose}
          width={phone ? 560 : 600}
          zIndex={5600}
          footer={(
            <>
              <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose}>Cancel</button>
              <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={save} disabled={Boolean(problem)}>Save</button>
            </>
          )}
        >
          {body}
        </DialogCard>
      </div>
    </BodyPortal>
  );
}

// The kinds a new line can take (owner 2026-11-12: five; Score and Count are
// a Number with a fine range, Photo and Signature and the ready line types
// went). A line already saved as an older kind keeps it and shows it here.
const KIND_OPTIONS = [
  { value: 'choice', label: 'Pick one' },
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'many', label: 'Pick many' },
];
const OLD_KIND_LABELS = { score: 'Score', count: 'Count', photo: 'Photo', signature: 'Signature' };

// A small box that commits on blur / Enter: a number (blank = not set) or text.
function SettingBox({ label, value, onCommit, width, size, placeholder, text = false, maxLength }) {
  const shown = value === undefined || value === null ? '' : String(value);
  const tip = useTooltip();
  return (
    <input
      aria-label={label}
      {...hoverOnly(tip(label))}
      defaultValue={shown}
      key={shown}
      maxLength={maxLength}
      inputMode={text ? 'text' : 'decimal'}
      placeholder={placeholder}
      onBlur={(e) => {
        const raw = e.currentTarget.value.trim();
        if (text) { if (raw !== shown) onCommit(raw); return; }
        const n = raw === '' ? undefined : Number(raw.replace(/,/g, ''));
        if (n !== undefined && !Number.isFinite(n)) { e.currentTarget.value = shown; return; }
        if (String(n ?? '') !== shown) onCommit(n);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{ ...fieldStyle, ...size, width, padding: '1px 4px' }}
    />
  );
}

/**
 * How one checklist item is answered: the template's buttons (Pick one), a
 * text box, a number (unit, fine range), a score (1-5 or 1-10, the score at
 * or below which it is an issue), a count (fine range) or a date (an issue
 * once past). `onChange` gets the item's whole answer settings
 * ({ kind, ...settings }, {} for pick-one), cleaned by itemAnswerFields.
 */
export function ItemKindPicker({ item, onChange, phone = false, children = null }) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const fields = itemAnswerFields(item);
  const kind = fields.kind || 'choice';
  const name = item.text || 'this item';
  const size = { fontSize: phone ? 13 : 11, height: phone ? 32 : undefined };
  const set = (patch) => onChange(itemAnswerFields({ ...fields, kind, ...patch }));
  const small = phone ? 48 : 36;
  const selectStyle = { ...fieldStyle, ...size, padding: '1px 4px', color: 'var(--text-2)' };
  const range = (kind === 'number' || kind === 'count') && (
    <>
      <SettingBox label={`Lowest fine value for "${name}"`} placeholder="min" value={fields.min} width={small} size={size} onCommit={(min) => set({ min })} />
      <SettingBox label={`Highest fine value for "${name}"`} placeholder="max" value={fields.max} width={small} size={size} onCommit={(max) => set({ max })} />
    </>
  );
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <select
        aria-label={`How "${name}" is answered`}
        value={kind}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === 'choice' ? {} : itemAnswerFields({ ...fields, kind: v }));
        }}
        style={selectStyle}
      >
        {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        {OLD_KIND_LABELS[kind] && <option value={kind}>{OLD_KIND_LABELS[kind]}</option>}
      </select>
      {kind === 'number' && (
        <SettingBox text label={`Unit for "${name}"`} placeholder="unit" value={fields.unit} maxLength={ITEM_UNIT_MAX} width={phone ? 56 : 44} size={size} onCommit={(unit) => set({ unit })} />
      )}
      {range}
      {kind === 'score' && (
        <>
          {phone ? (
            <>
              <select aria-label={`Score scale for "${name}"`} value={fields.scale} onChange={(e) => set({ scale: Number(e.target.value) })} style={selectStyle}>
                {SCORE_SCALES.map((n) => <option key={n} value={n}>1-{n}</option>)}
              </select>
              <select
                aria-label={`Issue at or below, for "${name}"`}
                value={fields.issueAt ?? ''}
                onChange={(e) => set({ issueAt: e.target.value ? Number(e.target.value) : undefined })}
                style={selectStyle}
              >
                <option value="">No issue line</option>
                {Array.from({ length: fields.scale - 1 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Issue at {n} or lower</option>)}
              </select>
            </>
          ) : (
            <>
              <ValueSelect
                look="pill"
                width="auto"
                label={`Score scale for "${name}"`}
                value={String(fields.scale)}
                options={SCORE_SCALES.map((n) => ({ value: String(n), label: `1-${n}` }))}
                onChange={(v) => set({ scale: Number(v) })}
              />
              <ValueSelect
                look="pill"
                width="auto"
                label={`Issue at or below, for "${name}"`}
                hint="A score at or below this is an issue"
                value={fields.issueAt == null ? '' : String(fields.issueAt)}
                options={[
                  { value: '', label: 'No issue line' },
                  ...Array.from({ length: fields.scale - 1 }, (_, i) => i + 1).map((n) => ({ value: String(n), label: `Issue at ${n} or lower` })),
                ]}
                onChange={(v) => set({ issueAt: v ? Number(v) : undefined })}
              />
            </>
          )}
        </>
      )}
      {kind === 'many' && (
        <span>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={optionsOpen}
            aria-label={`Options for "${name}"`}
            onClick={() => setOptionsOpen((v) => !v)}
            style={{ ...selectStyle, cursor: 'pointer' }}
          >
            Options ({fields.options.length})
          </button>
          {optionsOpen && (
            <AnswerSetEditor
              phone={phone}
              modal={{ kicker: 'Pick many options', title: name }}
              set={fields.options}
              onCommit={(options) => set({ options })}
              onClose={() => setOptionsOpen(false)}
              intro="The options people can pick, any number of them. Any pick counts as done; a red option shows as an issue."
            />
          )}
        </span>
      )}
      {kind === 'date' && (
        <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: size.fontSize, color: 'var(--text-2)' }}>
          <input type="checkbox" checked={fields.issueIfPast === true} onChange={(e) => set({ issueIfPast: e.target.checked })} />
          Issue once past
        </label>
      )}
      {children}
    </span>
  );
}

const SHOW_ALWAYS = '';
const choiceKey = (c) => `${c.itemId}\u0000${c.value}`;

/**
 * When a line shows (Nightly, hidden flag 'conditional-lines'): always, or
 * only once a pick-one or Pick many line above it has a certain answer.
 * `answersOf(line)` gives a line's answers; `onChange` gets
 * { itemId, value } or null for always.
 */
export function ShowIfPicker({ item, lines, answersOf, onChange }) {
  const name = item.text || 'this item';
  const current = showIfOf(item);
  const choices = showIfChoices(lines, item.id, answersOf);
  const value = current ? choiceKey(current) : SHOW_ALWAYS;
  // A condition on a line that is gone or changed stays listed until it is replaced.
  const options = [
    { value: SHOW_ALWAYS, label: 'Always shown' },
    ...(current && !choices.some((c) => choiceKey(c) === value) ? [{ value, label: `When an old line is ${current.value}` }] : []),
    ...choices.map((c) => ({ value: choiceKey(c), label: c.label })),
  ];
  const pick = (v) => {
    const hit = choices.find((c) => choiceKey(c) === v);
    if (v === SHOW_ALWAYS) onChange(null);
    else if (hit) onChange({ itemId: hit.itemId, value: hit.value });
  };
  const label = `When "${name}" shows`;
  return (
    <ValueSelect
      look="pill"
      width="auto"
      label={label}
      hint="Show this line only once another line has a certain answer"
      value={value}
      options={options}
      onChange={pick}
    />
  );
}
