/**
 * ExcelLockedModal.jsx — shown when the linked Excel file is open elsewhere
 * (Excel or OneDrive holds a lock), so the sync cannot write to it. Try again
 * re-runs the write; Cancel gives up. The app's one dialog shell (DialogCard).
 */
import DialogCard from './DialogCard.jsx';
import { C } from '../uiPalette';

const ExcelLockedModal = ({
  isOpen,
  onRetry,
  onCancel,
  filePath = '',
  isOneDrive = false
}) => {
  if (!isOpen) return null;

  const displayPath = isOneDrive
    ? `OneDrive: ${filePath.replace('/me/drive/root:', '').replace(':/content', '')}`
    : `Local: ${filePath}`;

  return (
    <DialogCard
      title="Excel file is open"
      message="The Excel file is open and cannot be updated. Close it in Excel or OneDrive, then try again."
      onClose={onCancel}
      width={440}
      zIndex={10000}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={onRetry}>Try again</button>
        </>
      )}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 4 }}>File location</div>
      <div style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', color: C.ink, wordBreak: 'break-all' }}>{displayPath}</div>
    </DialogCard>
  );
};

export default ExcelLockedModal;
