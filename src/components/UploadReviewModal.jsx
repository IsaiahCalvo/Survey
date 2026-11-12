/* Upload review (Nightly flag 'upload-review'; Drawboard Projects parity
   UP-10..23): the upload check as Drawboard's "Review & Publish" grid.
   Each sheet shows a picture of its title block beside the name, sheet
   number, revision and discipline it read. Pick rows for bulk revision,
   discipline or Remove; Show All / Problems / No discipline; a multi-page
   PDF can become one drawing per page. Pure rules: home/uploadReview.js.

   rows / onChange are owned by the caller (Dashboard), which reads each row
   (and each page of a split file). */
import { useMemo, useState } from 'react';
import DialogCard, { DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE } from './DialogCard.jsx';
import ValueSelect from './ValueSelect.jsx';
import Spinner from './Spinner';
import AppIcon from '../Icons';
import { useTooltip } from './Tooltip';
import { Z_INDEX } from '../theme';
import { isPhoneLayout } from '../utils/layoutMode.js';
import { DISCIPLINES, disciplineFromNumber } from '../sheets/sheetRegister.js';
import {
  REVIEW_SHOWS, canSplit, patchRows, removeRows, reviewProblems, rowShown, showCounts,
} from '../home/uploadReview.js';
import './UploadCheckModal.css';
import './UploadReviewModal.css';

const SOURCE_TEXT = { 'title-block': 'Read from the title block', 'file-name': 'Read from the file name' };
const FROM_NUMBER = '__from_number__';
const KEEP = '__keep__';

function DisciplinePick({ value, sheet, onChange, label = 'Discipline', bulk = false }) {
  const phone = isPhoneLayout();
  const auto = disciplineFromNumber(sheet);
  const options = [
    ...(bulk ? [{ value: KEEP, label: 'Set discipline…' }] : []),
    { value: FROM_NUMBER, label: bulk ? 'From sheet number' : (auto ? `${auto} (from number)` : 'None') },
    ...DISCIPLINES.map((d) => ({ value: d, label: d })),
  ];
  const current = bulk ? KEEP : (value || FROM_NUMBER);
  const pick = (next) => { if (next !== KEEP) onChange(next === FROM_NUMBER ? '' : next); };
  return phone ? (
    <select className="doc-review-native upload-review__native" aria-label={label} value={current} onChange={(e) => pick(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ) : (
    <ValueSelect label={label} value={current} options={options} size="sm" onChange={pick} />
  );
}

export default function UploadReviewModal({
  rows, existing = [], onChange, onUpload, onCancel, onSplit, onJoin, allowSplit = true, allowRemove = true,
}) {
  const tip = useTooltip();
  const [picked, setPicked] = useState(() => new Set());
  const [show, setShow] = useState('all');
  const [bulkRevision, setBulkRevision] = useState('');
  const problems = useMemo(() => reviewProblems(rows || [], existing), [rows, existing]);
  if (!rows) return null;
  const counts = showCounts(rows, problems);
  const shown = rows.filter((row) => rowShown(row, show, problems));
  const blocked = rows.length === 0 || Object.keys(problems.errors).length > 0;
  const reading = rows.some((r) => r.reading);
  const set = (key, field, value) => onChange(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const pickedKeys = rows.filter((r) => picked.has(r.key)).map((r) => r.key);
  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.key));
  const togglePick = (key) => setPicked((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleAll = () => setPicked(allShownPicked ? new Set() : new Set(shown.map((r) => r.key)));
  const remove = (keys) => {
    onChange(removeRows(rows, keys));
    setPicked((cur) => { const n = new Set(cur); keys.forEach((k) => n.delete(k)); return n; });
  };
  const count = rows.length;
  const firstPageOf = new Set();
  return (
    <DialogCard
      title={count === 1 ? 'Review the sheet before upload' : `Review ${count} sheets before upload`}
      message="Check what Survey read from each title block. Pick rows to set the revision or discipline for all of them at once."
      onClose={onCancel}
      width={920}
      zIndex={Z_INDEX.modalOverlay}
      cardProps={{ 'data-upload-check': '', 'data-upload-review': '' }}
      footer={(
        <>
          {reading && <span className="upload-check__reading" role="status"><Spinner size={12} color="currentColor" /> Reading title blocks…</span>}
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          <button type="button" data-autofocus="" className="hub-btn hub-btn--primary dialog-touch-pad" disabled={blocked} onClick={onUpload}>
            {count === 1 ? 'Upload' : `Upload ${count}`}
          </button>
        </>
      )}
    >
      <div className="upload-review__bar" data-upload-review-bar="">
        <label className="upload-review__all">
          <input type="checkbox" checked={allShownPicked} onChange={toggleAll} aria-label={allShownPicked ? 'Pick none' : 'Pick all shown'} />
          <span>{pickedKeys.length ? `${pickedKeys.length} picked` : 'Pick all'}</span>
        </label>
        <div className="doc-review-chips upload-review__shows" role="group" aria-label="Show">
          {REVIEW_SHOWS.map(([key, label]) => (
            <button key={key} type="button" className="doc-review-chip" aria-pressed={show === key} data-upload-review-show={key} onClick={() => setShow(key)}>
              {label}<span className="doc-review-chip__count">{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>
      {pickedKeys.length > 0 && (
        <div className="upload-review__bulk" data-upload-review-bulk="">
          <input
            className="dialog-prompt-input upload-review__bulk-rev"
            style={DIALOG_FIELD_STYLE}
            aria-label="Revision for the picked rows"
            placeholder="Revision"
            maxLength={12}
            value={bulkRevision}
            onChange={(e) => setBulkRevision(e.target.value)}
          />
          <button type="button" className="hub-btn dialog-touch-pad" data-upload-review-bulk-rev="" disabled={!bulkRevision.trim()} onClick={() => { onChange(patchRows(rows, pickedKeys, { revision: bulkRevision.trim() })); setBulkRevision(''); }}>
            Set revision
          </button>
          <div className="upload-review__bulk-discipline">
            <DisciplinePick bulk label="Discipline for the picked rows" onChange={(d) => onChange(patchRows(rows, pickedKeys, { discipline: d }))} />
          </div>
          {allowRemove && (
            <button type="button" className="hub-btn dialog-touch-pad is-danger" data-upload-review-bulk-remove="" onClick={() => remove(pickedKeys)}>
              Remove {pickedKeys.length}
            </button>
          )}
        </div>
      )}
      {shown.length === 0 && (
        <p className="upload-review__empty">{count === 0 ? 'Every file was removed. Cancel, or pick files again.' : 'Nothing to show here.'}</p>
      )}
      <ul className="upload-check__list">
        {shown.map((row) => {
          const error = problems.errors[row.key];
          const warning = problems.warnings[row.key];
          const isFirstPage = row.page && !firstPageOf.has(row.fileIndex);
          if (row.page) firstPageOf.add(row.fileIndex);
          return (
            <li
              key={row.key}
              className={`upload-check__row upload-review__row${picked.has(row.key) ? ' is-picked' : ''}`}
              data-upload-check-row={row.fileName}
              data-upload-review-row={row.key}
              data-upload-review-page={row.page || undefined}
            >
              <label className="upload-review__pick">
                <input type="checkbox" checked={picked.has(row.key)} onChange={() => togglePick(row.key)} aria-label={`Pick ${row.name || row.fileName}`} />
              </label>
              <div className="upload-review__crop" data-upload-review-crop={row.crop ? 'yes' : (row.reading ? 'reading' : 'none')}>
                {row.crop
                  ? <img src={row.crop} alt={`Title block of ${row.name || row.fileName}`} />
                  : row.reading ? <Spinner size={14} color="currentColor" /> : <span>No picture</span>}
              </div>
              <label className="upload-check__field upload-review__field--name">
                <span style={DIALOG_LABEL_STYLE}>Name</span>
                <input className="dialog-prompt-input" type="text" value={row.name} maxLength={196} aria-invalid={error ? 'true' : undefined} onChange={(e) => set(row.key, 'name', e.target.value)} style={DIALOG_FIELD_STYLE} />
              </label>
              <label className="upload-check__field">
                <span style={DIALOG_LABEL_STYLE}>Sheet number</span>
                <input className="dialog-prompt-input" type="text" value={row.sheet} maxLength={40} placeholder={row.reading ? 'Reading…' : 'None'} onChange={(e) => set(row.key, 'sheet', e.target.value)} style={DIALOG_FIELD_STYLE} />
              </label>
              <label className="upload-check__field">
                <span style={DIALOG_LABEL_STYLE}>Revision</span>
                <input className="dialog-prompt-input" type="text" value={row.revision} maxLength={12} placeholder={row.reading ? '…' : 'None'} aria-invalid={warning ? 'true' : undefined} onChange={(e) => set(row.key, 'revision', e.target.value)} style={DIALOG_FIELD_STYLE} />
              </label>
              <div className="upload-check__field upload-review__field--discipline">
                <span style={DIALOG_LABEL_STYLE}>Discipline</span>
                <DisciplinePick value={row.discipline} sheet={row.sheet} onChange={(d) => set(row.key, 'discipline', d)} label={`Discipline of ${row.name || row.fileName}`} />
              </div>
              {allowRemove ? (
                <button type="button" className="hub-icon-btn upload-review__remove" aria-label={`Remove ${row.name || row.fileName}`} data-upload-review-remove="" {...tip('Remove from this upload')} onClick={() => remove([row.key])}><AppIcon name="close" size={13} /></button>
              ) : <span />}
              <p className={`upload-check__note upload-review__note${error ? ' is-error' : warning ? ' is-warning' : ''}`} data-upload-review-note={error ? 'error' : warning ? 'warning' : 'info'}>
                {error || warning || [row.page ? `Page ${row.page} of ${row.fileName}` : row.fileName, row.pageCount > 1 && !row.page ? `${row.pageCount} pages` : null, SOURCE_TEXT[row.source]].filter(Boolean).join(' · ')}
              </p>
              {allowSplit && canSplit(row) && (
                <label className="upload-review__split">
                  <input type="checkbox" checked={false} data-upload-review-split={row.fileIndex} onChange={() => onSplit?.(row.fileIndex)} />
                  <span>One document per page ({row.pageCount} pages)</span>
                </label>
              )}
              {allowSplit && isFirstPage && (
                <label className="upload-review__split">
                  <input type="checkbox" checked data-upload-review-split={row.fileIndex} onChange={() => onJoin?.(row.fileIndex)} />
                  <span>One document per page ({row.pageCount} pages)</span>
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </DialogCard>
  );
}
