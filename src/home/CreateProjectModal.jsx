import { useRef } from 'react';
import Spinner from '../components/Spinner';
import Icon from '../Icons';
import { C } from '../uiPalette';
import DialogCard from '../components/DialogCard.jsx';
import { DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE } from '../components/DialogCard.jsx';

const COLORS = C;

export default function CreateProjectModal({
  busy = false,
  files = [],
  name = '',
  onCancel,
  onConfirm,
  onFilesChange,
  onNameChange,
  onRemoveFile,
  open,
}) {
  const inputRef = useRef(null);
  if (!open) return null;
  const canSubmit = !!name.trim() && !busy;

  // Design review 2026-10-27: this was its own card (an 18px title, a rule
  // under the header, 44px fields and buttons on a mouse too). It now sits on
  // the one dialog shell (DialogCard: KAL-66 focus trap, Escape cancels, not
  // while creating, the name field takes focus, focus goes back to "New
  // project") with the shared field; touch screens still get 44px targets
  // from hub.css (dialog-prompt-input, dialog-touch-pad).
  return (
    <DialogCard
      open
      title="Create project"
      ariaLabel="Create project"
      message="Add PDFs now or start with an empty project."
      onClose={onCancel}
      busy={busy}
      width={440}
      zIndex={2100}
      footer={(
        <>
          <button type="button" disabled={busy} onClick={onCancel} className="hub-btn dialog-touch-pad">Cancel</button>
          <button type="button" disabled={!canSubmit} onClick={onConfirm} className="hub-btn hub-btn--primary dialog-touch-pad">
            {/* KAL-73: ring + participle while the project (and any PDFs) persist. */}
            {busy && <Spinner size={14} color="currentColor" />}
            {busy ? 'Creating project…' : 'Create project'}
          </button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <label style={{ display: 'block' }}>
          <span style={DIALOG_LABEL_STYLE}>Project name</span>
          <input
            ref={inputRef}
            className="dialog-prompt-input"
            aria-label="Project name"
            value={name}
            disabled={busy}
            onChange={(event) => onNameChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) {
                event.preventDefault();
                onConfirm?.();
              }
            }}
            style={DIALOG_FIELD_STYLE}
          />
        </label>

        <label style={{ display: 'block' }}>
          <span style={DIALOG_LABEL_STYLE}>PDF files (optional)</span>
          <input
            data-testid="create-project-files"
            className="create-project-file-input"
            type="file"
            accept="application/pdf"
            multiple
            disabled={busy}
            onChange={(event) => {
              onFilesChange?.(Array.from(event.target.files || []));
              event.target.value = '';
            }}
            style={{ width: '100%', boxSizing: 'border-box', color: COLORS.muted, font: 'inherit', fontSize: 12 }}
          />
        </label>

        {files.length > 0 ? (
          <div aria-label="Selected PDF files" style={{ display: 'grid', gap: 4 }}>
            {files.map((file, index) => (
              <div key={`${file.name}-${file.size}-${index}`} style={{ minHeight: 32, display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 2px 10px', borderRadius: 'var(--radius-sm)', border: `1px solid ${COLORS.rule}`, background: COLORS.deep }}>
                <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: COLORS.ink }}>{file.name}</span>
                <button type="button" disabled={busy} onClick={() => onRemoveFile?.(index)} className="hub-icon-btn dialog-close-touch-pad" aria-label={`Remove ${file.name}`}><Icon name="close" size={13} /></button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </DialogCard>
  );
}
