import { useRef, useState } from 'react';
import DialogCard, { DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE } from '../components/DialogCard.jsx';
import { C } from '../uiPalette';
import ValueSelect from '../components/ValueSelect.jsx';
import { listExportKits } from '../services/exportFormats/registry.js';
import { OWN_KIT_CHOICES, OWN_KIT_LIMITS, buildOwnKit, followsChecklistColumn, guessOwnKitMatches, isRowIdHeader, ownKitId, readSheetHeaders } from '../services/exportFormats/ownKits.js';

const LEAVE_OUT = '';

/**
 * "Use your own spreadsheet" (Nightly beta 'own-excel-layouts', plan
 * 2026-10-27, step 1): pick the sheet your company uses, say which of its
 * columns Survey fills with what, save. The layout is kept on the account and
 * picked for this template. The common columns come filled in from their
 * names (guessOwnKitMatches); `lineNames` are the template's checklist lines.
 */
export default function OwnExcelLayoutDialog({ store, onSaved, onClose, lineNames = [] }) {
  const fileRef = useRef(null);
  const [label, setLabel] = useState('');
  const [headers, setHeaders] = useState(null);
  const [matches, setMatches] = useState([]);
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');

  const pickFile = async (file) => {
    if (!file) return;
    setError('');
    setState('reading');
    try {
      const found = await readSheetHeaders(await file.arrayBuffer());
      if (!found.length) throw new Error('That sheet has no column names in its first rows.');
      setHeaders(found);
      setMatches(guessOwnKitMatches(found, lineNames));
      setLabel((cur) => cur || file.name.replace(/\.xlsx$/i, '').slice(0, OWN_KIT_LIMITS.label));
    } catch (err) {
      setError(/zip|central directory|signature/i.test(err.message || '') ? 'That file is not an Excel workbook (.xlsx).' : err.message);
    } finally {
      setState('idle');
    }
  };

  // One Survey field per column: picking a field taken by another column moves it here.
  const match = (i, field) => setMatches((cur) => cur.map((f, k) => (k === i ? field : (field && f === field ? LEAVE_OUT : f))));

  const save = async () => {
    setError('');
    setState('saving');
    try {
      const id = ownKitId(label, listExportKits().map((k) => k.id));
      const kit = buildOwnKit({ id, label, headers, matches });
      await store.save(kit);
      onSaved(id);
    } catch (err) {
      setError(err.message);
      setState('idle');
    }
  };

  const matched = matches.filter(Boolean).length;
  const busy = state !== 'idle';
  // Their columns after the Checklist answers column that are named like
  // checklist lines: those lines fill them, so they need no choice.
  const checklistAt = matches.indexOf('checklist');
  const followsChecklist = (i) => checklistAt >= 0 && i > checklistAt && !matches[i]
    && followsChecklistColumn(headers?.[i], headers?.[checklistAt], lineNames);
  const options = [
    { value: LEAVE_OUT, label: 'Leave empty', detail: 'Survey writes nothing in this column' },
    ...OWN_KIT_CHOICES.map((c) => ({ value: c.field, label: c.label, detail: c.detail })),
  ];
  return (
    <DialogCard
      title="Use your own spreadsheet"
      message="Pick a spreadsheet your company already uses. Survey reads the column names in its top row; then say what Survey writes in each column."
      onClose={onClose}
      busy={state === 'saving'}
      width={500}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose} disabled={state === 'saving'}>Cancel</button>
          <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={save} disabled={busy || !headers || !matched || !label.trim()}>
            {state === 'saving' ? 'Saving…' : 'Save layout'}
          </button>
        </>
      )}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label="Your Excel sheet"
        style={{ display: 'none' }}
        onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }}
      />
      <button type="button" className="hub-btn dialog-touch-pad own-layout__pick" onClick={() => fileRef.current?.click()} disabled={busy}>
        {state === 'reading' ? 'Reading…' : headers ? 'Pick another spreadsheet' : 'Pick your spreadsheet (.xlsx)'}
      </button>
      {headers ? (
        <>
          <label style={{ ...DIALOG_LABEL_STYLE, marginTop: 14 }} htmlFor="own-layout-name">Layout name</label>
          <input
            id="own-layout-name"
            className="dialog-prompt-input"
            style={DIALOG_FIELD_STYLE}
            value={label}
            maxLength={OWN_KIT_LIMITS.label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="own-layout__table" role="group" aria-label="Your columns">
            <div className="own-layout__head"><span>Column in your sheet</span><span>What Survey writes there</span></div>
            {headers.map((header, i) => (
              <div key={`${i}-${header}`} className="own-layout__row">
                <span className="own-layout__header">{header}</span>
                {isRowIdHeader(header) ? (
                  <span className="own-layout__fixed">Survey's own row ID (always added)</span>
                ) : followsChecklist(i) ? (
                  <span className="own-layout__fixed">Checklist answer (that line)</span>
                ) : (
                  <ValueSelect
                    width="100%"
                    label={`What Survey writes in ${header}`}
                    value={matches[i] || LEAVE_OUT}
                    options={options}
                    onChange={(v) => match(i, v)}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="own-layout__note">
            Survey filled in the columns it could tell from their names; change any of them. To read the sheet back, Survey also keeps a hidden Row ID column and fills Who changed it and Date changed. Anything you don't place goes after your columns.
          </p>
        </>
      ) : null}
      {error ? <p role="alert" style={{ margin: '10px 0 0', color: C.dangerText }}>{error}</p> : null}
    </DialogCard>
  );
}
