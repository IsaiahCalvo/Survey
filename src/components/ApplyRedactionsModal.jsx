import DialogCard from './DialogCard.jsx';
import { C } from '../uiPalette';

/**
 * The last stop before a permanent redaction is written: it names how many
 * redactions will burn in and that the open PDF stays as it is. The app's one
 * dialog shell (DialogCard); while it works nothing closes it.
 */
export default function ApplyRedactionsModal({
  open,
  redactionCount = 0,
  busy = false,
  progress = null,
  error = '',
  onCancel,
  onConfirm,
}) {
  if (!open) return null;
  const countLabel = `${redactionCount} redaction${redactionCount === 1 ? '' : 's'}`;
  return (
    <DialogCard
      role="alertdialog"
      title="Permanently redact selected content?"
      message={`This will permanently remove the selected content and save a new PDF with ${countLabel}. Content under the redaction cannot be recovered. Everything else in the PDF will be kept.`}
      onClose={onCancel}
      busy={busy}
      width={440}
      zIndex={12000}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="hub-btn hub-btn--primary is-danger dialog-touch-pad" onClick={onConfirm} disabled={busy}>
            {busy ? 'Redacting…' : 'Redact & download'}
          </button>
        </>
      )}
    >
      <p style={{ margin: 0, color: C.ink }}>Your open PDF and its editable marks will stay unchanged.</p>
      {progress && <p role="status" style={{ margin: '10px 0 0' }}>Applying redactions {progress.pageNumber} of {progress.pageCount}…</p>}
      {error && <p role="alert" style={{ margin: '10px 0 0', color: C.dangerText }}>{error}</p>}
    </DialogCard>
  );
}
