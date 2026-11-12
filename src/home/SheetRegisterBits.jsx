/* Sheet register (Nightly flag 'sheet-register'): the pieces the Home
   documents list adds. Pure rules: sheets/sheetRegister.js; server:
   home/sheetRegisterData.js.

   - SheetLine: sheet number, revision, discipline and open items under a name.
   - RegisterChips: discipline and open-items filter chips.
   - SheetDetailsDialog: Edit details (number, name, revision, discipline).
   - BulkChoiceDialog: one pick applied to every selected document
     (status, assignee or discipline). */
import { useEffect, useMemo, useRef, useState } from 'react';
import DialogCard, { DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE } from '../components/DialogCard.jsx';
import ValueSelect from '../components/ValueSelect.jsx';
import { isPhoneLayout } from '../utils/layoutMode.js';
import { countLabel } from './countLabel.js';
import {
  DISCIPLINES,
  SHEET_NUMBER_MAX_LENGTH,
  SHEET_REVISION_MAX_LENGTH,
  checkSheetDetails,
  disciplineFromNumber,
} from '../sheets/sheetRegister.js';
import './sheetRegister.css';

export function SheetLine({ info, openItems = 0 }) {
  if (!info) return null;
  const open = Number(openItems) || 0;
  if (!info.number && !info.revision && !info.discipline && !open) return null;
  return (
    <span className="sheet-register-line" data-sheet-register-line="">
      {info.number && <span className="sheet-register-number" data-sheet-number="">{info.number}</span>}
      {info.revision && <span className="sheet-register-rev" data-sheet-revision="">Rev {info.revision}</span>}
      {info.discipline && <span className="sheet-register-discipline" data-sheet-discipline="">{info.discipline}</span>}
      {open > 0 && <span className="sheet-register-open" data-sheet-open-items={open}>{countLabel(open, 'open item')}</span>}
    </span>
  );
}

export function RegisterChips({ filter, onChange, disciplines, openCounts, phone = false }) {
  const toggle = (patch) => onChange({ ...filter, ...patch });
  return (
    <div className={`doc-review-chips${phone ? ' doc-review-chips--phone' : ''}`} role="group" aria-label="Filter by discipline and open items" data-sheet-register-chips="">
      {(disciplines || []).map(({ discipline, count }) => (
        <button
          key={discipline || '__none__'}
          type="button"
          className="doc-review-chip"
          aria-pressed={filter.discipline === discipline}
          data-discipline-filter={discipline || 'none'}
          onClick={() => toggle({ discipline: filter.discipline === discipline ? null : discipline })}
        >
          {discipline || 'No discipline'}
          <span className="doc-review-chip__count">{count}</span>
        </button>
      ))}
      <button
        type="button"
        className="doc-review-chip"
        aria-pressed={filter.openItems === 'with'}
        data-open-items-filter="with"
        onClick={() => toggle({ openItems: filter.openItems === 'with' ? null : 'with' })}
      >
        Open items{openCounts?.with ? <span className="doc-review-chip__count">{openCounts.with}</span> : null}
      </button>
      <button
        type="button"
        className="doc-review-chip"
        aria-pressed={filter.openItems === 'without'}
        data-open-items-filter="without"
        onClick={() => toggle({ openItems: filter.openItems === 'without' ? null : 'without' })}
      >
        No open items
      </button>
    </div>
  );
}

const FROM_NUMBER = '__from_number__';

/* Drawboard's "Edit details": number, name and revision in one card, plus
   the discipline (Drawboard sets it from the row menu). The name needs the
   owner (rename is owner-only); the rest needs edit access. */
export function SheetDetailsDialog({ name, info, canRename, onSave, onClose }) {
  const phone = isPhoneLayout();
  const [number, setNumber] = useState(info?.number || '');
  const [title, setTitle] = useState(name || '');
  const [revision, setRevision] = useState(info?.revision || '');
  const [discipline, setDiscipline] = useState(info?.disciplinePicked ? info.discipline : FROM_NUMBER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstRef = useRef(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => firstRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const auto = disciplineFromNumber(number);
  const options = useMemo(() => {
    const list = [{ value: FROM_NUMBER, label: auto ? `From sheet number (${auto})` : 'From sheet number (none)' }];
    const picked = discipline !== FROM_NUMBER && !DISCIPLINES.includes(discipline) ? [discipline] : [];
    return [...list, ...[...picked, ...DISCIPLINES].map((d) => ({ value: d, label: d }))];
  }, [auto, discipline]);
  const submit = async (event) => {
    event?.preventDefault?.();
    if (busy) return;
    const checked = checkSheetDetails({ number, name: title, revision, discipline: discipline === FROM_NUMBER ? '' : discipline });
    if (checked.error) { setError(checked.error); return; }
    setBusy(true);
    setError('');
    try {
      await onSave(checked.value);
      onClose();
    } catch (err) {
      setError(err?.message || 'Survey could not save these details. Try again.');
      setBusy(false);
    }
  };
  const field = (label, input) => (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={DIALOG_LABEL_STYLE}>{label}</span>
      {input}
    </label>
  );
  return (
    <DialogCard
      title="Edit details"
      onClose={onClose}
      busy={busy}
      width={400}
      atRoot
      as="form"
      cardProps={{ onSubmit: submit, 'data-sheet-details-dialog': '' }}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="hub-btn hub-btn--primary dialog-touch-pad" disabled={busy}>Save</button>
        </>
      )}
    >
      {field('Sheet number', (
        <input ref={firstRef} className="dialog-prompt-input" style={DIALOG_FIELD_STYLE} aria-label="Sheet number" value={number} maxLength={SHEET_NUMBER_MAX_LENGTH} placeholder="A-101" onChange={(e) => setNumber(e.target.value)} />
      ))}
      {field('Name', (
        <input className="dialog-prompt-input" style={DIALOG_FIELD_STYLE} aria-label="Name" value={title} disabled={!canRename} onChange={(e) => setTitle(e.target.value)} />
      ))}
      {!canRename && <div className="sheet-register-note">Only the owner can rename this drawing.</div>}
      {field('Revision', (
        <input className="dialog-prompt-input" style={DIALOG_FIELD_STYLE} aria-label="Revision" value={revision} maxLength={SHEET_REVISION_MAX_LENGTH} placeholder="B" onChange={(e) => setRevision(e.target.value)} />
      ))}
      <div style={{ marginBottom: 4 }}>
        <span style={DIALOG_LABEL_STYLE}>Discipline</span>
        {phone ? (
          <select className="doc-review-native" style={{ width: '100%' }} aria-label="Discipline" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <ValueSelect label="Discipline" value={discipline} options={options} onChange={setDiscipline} />
        )}
      </div>
      {error && <div role="alert" className="sheet-register-error">{error}</div>}
    </DialogCard>
  );
}

/* One pick for every selected document: `choices` = [{ value, label }]. */
export function BulkChoiceDialog({ title, count, choices, onPick, onClose, kind }) {
  const [busy, setBusy] = useState(false);
  const pick = async (value) => {
    if (busy) return;
    setBusy(true);
    try {
      await onPick(value);
    } finally {
      onClose();
    }
  };
  return (
    <DialogCard
      title={title}
      message={`For ${countLabel(count, 'document')}.`}
      onClose={onClose}
      busy={busy}
      width={320}
      atRoot
      cardProps={{ 'data-sheet-bulk-dialog': kind }}
    >
      <div role="menu" aria-label={title} style={{ display: 'grid', gap: 4 }}>
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            role="menuitem"
            className="hub-btn dialog-touch-pad"
            disabled={busy}
            data-bulk-choice={c.value}
            style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, justifyContent: 'flex-start', width: '100%' }}
            onClick={() => pick(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </DialogCard>
  );
}

export const disciplineChoices = () => [
  { value: '', label: 'From sheet number' },
  ...DISCIPLINES.map((d) => ({ value: d, label: d })),
];
