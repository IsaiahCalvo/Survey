import './ApplyRedactionsModal.css';

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
    <div className="apply-redactions-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel?.();
    }}>
      <section className="apply-redactions-modal" role="alertdialog" aria-modal="true" aria-labelledby="apply-redactions-title" aria-describedby="apply-redactions-copy">
        <h2 id="apply-redactions-title">Permanently redact selected content?</h2>
        <p id="apply-redactions-copy">
          This will permanently remove the selected content and save a new PDF with {countLabel}.
          Content under the redaction cannot be recovered. Everything else in the PDF will be kept.
        </p>
        <p className="apply-redactions-original-note">Your open PDF and its editable marks will stay unchanged.</p>
        {progress && <p className="apply-redactions-progress" role="status">Applying redactions {progress.pageNumber} of {progress.pageCount}…</p>}
        {error && <p className="apply-redactions-error" role="alert">{error}</p>}
        <div className="apply-redactions-actions">
          <button type="button" className="apply-redactions-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="apply-redactions-confirm" onClick={onConfirm} disabled={busy}>
            {busy ? 'Redacting…' : 'Redact & download'}
          </button>
        </div>
      </section>
    </div>
  );
}
