// src/components/DocumentVersionsDialog.jsx
//
// Version history of the open document (Drawboard Projects' versions;
// Nightly, flag 'document-versions'). Newest first: open an older version, or
// lay it over the one that is open (VersionCompareDialog). With 'version-delete'
// (onDelete set; Drawboard DL-28) any one version can be deleted, Undo in the toast.
import DialogCard from './DialogCard.jsx';
import AppIcon from '../Icons';
import { useTooltip } from './Tooltip';
import { C } from '../uiPalette';
import { Z_INDEX } from '../theme';

function versionLine(version) {
  const parts = [];
  if (version.createdAt) {
    const when = new Date(version.createdAt);
    if (!Number.isNaN(when.getTime())) parts.push(when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
  }
  if (version.pageCount > 0) parts.push(`${version.pageCount} page${version.pageCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export default function DocumentVersionsDialog({ versions, openId, onOpen, onCompare, onDelete = null, onClose }) {
  const tip = useTooltip();
  const newestFirst = [...(versions || [])].sort((a, b) => b.versionNumber - a.versionNumber);
  return (
    <DialogCard
      title="Versions"
      message="Each new version brings the marks across. Older versions stay here to open or compare."
      onClose={onClose}
      width={460}
      zIndex={Z_INDEX.modalOverlay}
      cardProps={{ 'data-document-versions': 'true' }}
      footer={<button type="button" className="hub-btn dialog-touch-pad" onClick={onClose}>Close</button>}
    >
      <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50dvh', overflow: 'auto' }}>
        {newestFirst.map((version) => {
          const isOpen = version.id === openId;
          return (
            <div
              key={version.id}
              role="listitem"
              data-version-row={version.versionNumber}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                border: `1px solid ${C.rule}`, borderRadius: 'var(--radius-sm)',
                background: isOpen ? C.deep : 'transparent',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13, minWidth: 28 }}>v{version.versionNumber}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {version.name}
                </span>
                <span style={{ display: 'block', fontSize: 11, color: C.muted }}>
                  {[version.isCurrent ? 'Current' : null, isOpen ? 'Open now' : null, versionLine(version)].filter(Boolean).join(' · ')}
                </span>
              </span>
              {!isOpen && (
                <>
                  <button type="button" className="hub-btn dialog-touch-pad" data-version-compare-button={version.versionNumber} onClick={() => onCompare(version)}>
                    Compare
                  </button>
                  <button type="button" className="hub-btn dialog-touch-pad" data-version-open-button={version.versionNumber} onClick={() => onOpen(version)}>
                    Open
                  </button>
                </>
              )}
              {onDelete && newestFirst.length > 1 && (
                <button
                  type="button"
                  className="hub-icon-btn dialog-touch-pad"
                  data-version-delete-button={version.versionNumber}
                  aria-label={`Delete v${version.versionNumber}`}
                  {...tip(version.isCurrent ? 'Delete this version. The one before becomes current' : 'Delete this version')}
                  onClick={() => onDelete(version)}
                >
                  <AppIcon name="trash" size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </DialogCard>
  );
}
