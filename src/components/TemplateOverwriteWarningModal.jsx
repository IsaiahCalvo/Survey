/**
 * TemplateOverwriteWarningModal.jsx — confirmation shown before overwriting a
 * saved file that was created from a different template. Compares the
 * existing file's template with the current one and warns the overwrite cannot
 * be undone. The app's one dialog shell (DialogCard); Overwrite is destructive.
 */
import DialogCard from './DialogCard.jsx';
import { C } from '../uiPalette';

const label = { fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 4 };

const TemplateOverwriteWarningModal = ({
  isOpen,
  onConfirm,
  onCancel,
  fileName = '',
  existingTemplateName = 'Unknown template',
  currentTemplateName = 'Current template',
}) => {
  if (!isOpen) return null;

  return (
    <DialogCard
      title="Different template detected"
      message={<>A file named <strong style={{ color: C.ink }}>"{fileName}"</strong> already exists here, but it was made from a different template. Overwriting replaces its template structure with your current template. This cannot be undone.</>}
      ariaLabel="Different template detected"
      onClose={onCancel}
      width={440}
      zIndex={10000}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          <button type="button" className="hub-btn hub-btn--primary is-danger dialog-touch-pad" onClick={onConfirm}>Overwrite file</button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 10, padding: 12, border: `1px solid ${C.rule}`, borderRadius: 6 }}>
        <div>
          <div style={label}>Existing file template</div>
          <div style={{ color: C.ink, fontWeight: 600 }}>{existingTemplateName}</div>
        </div>
        <div style={{ borderTop: `1px solid ${C.rule}`, paddingTop: 10 }}>
          <div style={label}>Your current template</div>
          <div style={{ color: C.ink, fontWeight: 600 }}>{currentTemplateName}</div>
        </div>
      </div>
    </DialogCard>
  );
};

export default TemplateOverwriteWarningModal;
