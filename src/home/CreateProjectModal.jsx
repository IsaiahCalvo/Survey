import { useEffect, useRef } from 'react';
import Spinner from '../components/Spinner';
import Icon from '../Icons';
import { C } from '../uiPalette';

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
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || busy) return;
      event.stopPropagation();
      onCancel?.();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown, true);
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
    };
  }, [busy, onCancel, open]);

  if (!open) return null;
  const canSubmit = !!name.trim() && !busy;

  return (
    <div
      className="create-project-modal-scrim"
      onClick={() => { if (!busy) onCancel?.(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 2100, display: 'grid', placeItems: 'center', padding: 16, background: COLORS.scrim, backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Create project"
        onClick={(event) => event.stopPropagation()}
        style={{ width: 440, maxWidth: '100%', maxHeight: 'calc(100vh - 32px)', overflow: 'auto', borderRadius: 12, border: `1px solid ${COLORS.rule}`, background: COLORS.card, color: COLORS.ink, boxShadow: '0 24px 64px rgba(0,0,0,0.58)', fontFamily: 'var(--font-ui)' }}
      >
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 18px 14px', borderBottom: `1px solid ${COLORS.rule}` }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Create project</h2>
            <p style={{ margin: '6px 0 0', color: COLORS.muted, fontSize: 12 }}>Add PDFs now or start with an empty project.</p>
          </div>
          <button type="button" title="Close" disabled={busy} onClick={onCancel} className="hub-icon-btn"><Icon name="close" size={16} /></button>
        </header>

        <div style={{ display: 'grid', gap: 16, padding: 18 }}>
          <label>
            <span style={{ display: 'block', marginBottom: 7, color: COLORS.muted, fontSize: 11, fontWeight: 600, letterSpacing: 0 }}>Project name</span>
            <input
              ref={inputRef}
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
              style={{ width: '100%', minHeight: 44, boxSizing: 'border-box', padding: '0 12px', borderRadius: 7, border: `1px solid ${COLORS.rule}`, outline: 'none', background: COLORS.deep, color: COLORS.ink, font: 'inherit', fontSize: 16 }}
            />
          </label>

          <label style={{ display: 'grid', gap: 7 }}>
            <span style={{ color: COLORS.muted, fontSize: 11, fontWeight: 600, letterSpacing: 0 }}>PDF files (optional)</span>
            <input
              data-testid="create-project-files"
              type="file"
              accept="application/pdf"
              multiple
              disabled={busy}
              onChange={(event) => {
                onFilesChange?.(Array.from(event.target.files || []));
                event.target.value = '';
              }}
              style={{ width: '100%', minHeight: 44, boxSizing: 'border-box', padding: 9, borderRadius: 7, border: `1px solid ${COLORS.rule}`, background: COLORS.deep, color: COLORS.muted, font: 'inherit', fontSize: 12 }}
            />
          </label>

          {files.length > 0 ? (
            <div aria-label="Selected PDF files" style={{ display: 'grid', gap: 6 }}>
              {files.map((file, index) => (
                <div key={`${file.name}-${file.size}-${index}`} style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 7, border: `1px solid ${COLORS.rule}`, background: COLORS.deep }}>
                  <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{file.name}</span>
                  <button type="button" disabled={busy} onClick={() => onRemoveFile?.(index)} className="hub-icon-btn" style={{ minWidth: 44, minHeight: 44 }} aria-label={`Remove ${file.name}`}><Icon name="close" size={16} /></button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: `1px solid ${COLORS.rule}`, background: COLORS.deep }}>
          <button type="button" disabled={busy} onClick={onCancel} className="hub-btn" style={{ minHeight: 44 }}>Cancel</button>
          <button type="button" disabled={!canSubmit} onClick={onConfirm} className="hub-btn hub-btn--primary" style={{ minHeight: 44 }}>
            {/* KAL-73: ring + participle while the project (and any PDFs) persist. */}
            {busy && <Spinner size={14} color="currentColor" />}
            {busy ? 'Creating project…' : 'Create project'}
          </button>
        </footer>
      </section>
    </div>
  );
}
