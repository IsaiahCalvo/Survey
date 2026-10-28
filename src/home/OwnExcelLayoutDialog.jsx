import { useRef, useState } from 'react';
import DialogCard, { DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE } from '../components/DialogCard.jsx';
import { C } from '../uiPalette';
import ValueSelect from '../components/ValueSelect.jsx';
import { listExportKits } from '../services/exportFormats/registry.js';
import { OWN_KIT_CHOICES, OWN_KIT_LIMITS, buildOwnKit, ownKitId, readSheetHeaders } from '../services/exportFormats/ownKits.js';

const LEAVE_OUT = '';

/**
 * "Your own Excel layout" (Nightly beta 'own-excel-layouts', plan 2026-10-27,
 * step 1): pick the sheet your company uses, say which of its columns Survey
 * fills with what, save. The layout is kept on the account and picked for
 * this template.
 */
export default function OwnExcelLayoutDialog({ store, onSaved, onClose }) {
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
      setMatches(found.map(() => LEAVE_OUT));
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
  return (
    <DialogCard
      title="Your own Excel layout"
      message="Pick the sheet your company uses, then say what Survey puts in each of its columns."
      onClose={onClose}
      busy={state === 'saving'}
      width={480}
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
        {state === 'reading' ? 'Reading…' : headers ? 'Pick another sheet' : 'Pick your Excel sheet'}
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
            <div className="own-layout__head"><span>Your column</span><span>Survey puts in it</span></div>
            {headers.map((header, i) => (
              <div key={`${i}-${header}`} className="own-layout__row">
                <span className="own-layout__header">{header}</span>
                <ValueSelect
                  width="100%"
                  label={`Survey puts in ${header}`}
                  value={matches[i] || LEAVE_OUT}
                  options={[{ value: LEAVE_OUT, label: 'Nothing (left out)' }, ...OWN_KIT_CHOICES.map((c) => ({ value: c.field, label: c.label }))]}
                  onChange={(v) => match(i, v)}
                />
              </div>
            ))}
          </div>
          <p className="own-layout__note">
            Checklist lines fill one column each, from that column on. Columns left as Nothing are not in the export. Survey always adds a hidden Row ID column first, then Changed by and Changed date, so it can read the sheet back. Anything you don't match goes after your columns.
          </p>
        </>
      ) : null}
      {error ? <p role="alert" style={{ margin: '10px 0 0', color: C.dangerText }}>{error}</p> : null}
    </DialogCard>
  );
}
