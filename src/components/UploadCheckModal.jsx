/* Upload check (Nightly, flag 'upload-check'; Drawboard Projects round 2):
   after the file pick, one card lists each PDF with the name, sheet number
   and revision its title block (or file name) gave. Fix any of them, then
   Upload. Cancel uploads nothing. Pure helpers: home/uploadCheck.js.

   rows / onChange are owned by the caller (Dashboard), which fills each row
   as its title block is read. */
import DialogCard, { DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE } from './DialogCard.jsx';
import Spinner from './Spinner';
import { Z_INDEX } from '../theme';
import { uploadCheckProblems } from '../home/uploadCheck.js';
import './UploadCheckModal.css';

const SOURCE_TEXT = { 'title-block': 'Read from the title block', 'file-name': 'Read from the file name' };

export default function UploadCheckModal({ rows, onChange, onUpload, onCancel }) {
  if (!rows) return null;
  const problems = uploadCheckProblems(rows);
  const blocked = Object.keys(problems).length > 0;
  const reading = rows.some((r) => r.reading);
  const set = (key, field, value) => onChange(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const count = rows.length;
  return (
    <DialogCard
      title={count === 1 ? 'Check the sheet before upload' : `Check ${count} sheets before upload`}
      message="Fix the name, sheet number or revision if they read wrong. The sheet number is how Survey spots a new version of a sheet."
      onClose={onCancel}
      width={640}
      zIndex={Z_INDEX.modalOverlay}
      cardProps={{ 'data-upload-check': '' }}
      footer={(
        <>
          {reading && <span className="upload-check__reading" role="status"><Spinner size={12} color="currentColor" /> Reading title blocks…</span>}
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            data-autofocus=""
            className="hub-btn hub-btn--primary dialog-touch-pad"
            disabled={blocked}
            onClick={onUpload}
          >
            {count === 1 ? 'Upload' : `Upload ${count}`}
          </button>
        </>
      )}
    >
      <ul className="upload-check__list">
        {rows.map((row) => (
          <li key={row.key} className="upload-check__row" data-upload-check-row={row.fileName}>
            <label className="upload-check__field upload-check__field--name">
              <span style={DIALOG_LABEL_STYLE}>Name</span>
              <input
                className="dialog-prompt-input"
                type="text"
                value={row.name}
                maxLength={196}
                aria-invalid={problems[row.key] ? 'true' : undefined}
                onChange={(e) => set(row.key, 'name', e.target.value)}
                style={DIALOG_FIELD_STYLE}
              />
            </label>
            <label className="upload-check__field">
              <span style={DIALOG_LABEL_STYLE}>Sheet number</span>
              <input
                className="dialog-prompt-input"
                type="text"
                value={row.sheet}
                maxLength={40}
                placeholder={row.reading ? 'Reading…' : 'None'}
                onChange={(e) => set(row.key, 'sheet', e.target.value)}
                style={DIALOG_FIELD_STYLE}
              />
            </label>
            <label className="upload-check__field upload-check__field--rev">
              <span style={DIALOG_LABEL_STYLE}>Revision</span>
              <input
                className="dialog-prompt-input"
                type="text"
                value={row.revision}
                maxLength={12}
                placeholder={row.reading ? '…' : 'None'}
                onChange={(e) => set(row.key, 'revision', e.target.value)}
                style={DIALOG_FIELD_STYLE}
              />
            </label>
            <p className={`upload-check__note${problems[row.key] ? ' is-error' : ''}`}>
              {problems[row.key] || [row.fileName, SOURCE_TEXT[row.source]].filter(Boolean).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </DialogCard>
  );
}
