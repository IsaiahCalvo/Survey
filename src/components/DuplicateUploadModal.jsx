/**
 * DuplicateUploadModal.jsx — the two ASK halves of the duplicate-upload flow
 * (decision 6, DECISION-BATCH-2026-07-07; KAL-277 + KAL-290).
 *
 * mode="version": the incoming file shares a name with an existing document but
 * the contents differ. Choices: open the existing document, or upload the new
 * file as a new version (the old copy is archived, its marks kept).
 *
 * mode="alias": the incoming bytes matched an existing document stored under a
 * different name. The document is reused either way; the only question is
 * whether to also keep the new name as an alias.
 *
 * onResolve(choice) fires with 'open-existing' | 'new-version' | 'add-alias' |
 * 'skip-alias'; onClose() means the user backed out (Escape/backdrop) — for
 * mode="version" the caller cancels the upload, for mode="alias" the caller
 * treats it like 'skip-alias'. This component just reports.
 */
import { useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS, Z_INDEX } from '../theme';

const DuplicateUploadModal = ({
  isOpen,
  mode, // 'version' | 'alias'
  incomingName = '',
  existingName = '',
  // version mode only: true when the existing doc's hash provably differs;
  // false for legacy rows with no hash yet (we can't claim "different").
  contentsKnownDifferent = true,
  onResolve,
  onClose,
}) => {
  const dialogRef = useRef(null);

  // Accessibility: the shared focus trap keeps Tab inside the dialog, closes
  // it on Escape, and returns focus to whatever opened it.
  useFocusTrap(dialogRef, isOpen, { onEscape: onClose });

  if (!isOpen) return null;

  const isVersion = mode === 'version';
  const title = isVersion ? 'You already have this file name' : 'You already have this file';
  const body = isVersion
    ? (contentsKnownDifferent
      ? `A document named “${existingName}” already exists here, but its contents are different from the file you picked.`
      : `A document named “${existingName}” already exists here. It was added before content checking, so we can’t tell whether your file matches it.`)
    : `The file you picked is identical to “${existingName}”, so that document will be opened. Keep “${incomingName}” as an extra name for it?`;
  const actions = isVersion
    ? [
        // When we can't prove the contents differ, opening the existing copy
        // is the safe default action.
        { id: 'open-existing', label: 'Open existing', primary: !contentsKnownDifferent },
        { id: 'new-version', label: 'Upload as new version', primary: contentsKnownDifferent },
      ]
    : [
        { id: 'skip-alias', label: 'No thanks', primary: false },
        { id: 'add-alias', label: 'Keep both names', primary: true },
      ];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: COLORS.modal.overlay,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: Z_INDEX.modalOverlay,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.modal.surface,
          border: `1px solid ${COLORS.modal.border}`,
          borderRadius: BORDERS.radius.dialog,
          boxShadow: SHADOWS.lg,
          padding: 24,
          width: 'min(92vw, 440px)',
          fontFamily: TYPOGRAPHY.fontFamily.default,
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: 10,
            fontSize: TYPOGRAPHY.fontSize.xl,
            fontWeight: TYPOGRAPHY.fontWeight.semibold,
            color: COLORS.text.primary,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: 0,
            marginBottom: 8,
            fontSize: TYPOGRAPHY.fontSize.md,
            lineHeight: TYPOGRAPHY.lineHeight.normal,
            color: COLORS.text.secondary,
          }}
        >
          {body}
        </p>
        {isVersion && (
          <p
            style={{
              margin: 0,
              fontSize: TYPOGRAPHY.fontSize.base,
              lineHeight: TYPOGRAPHY.lineHeight.normal,
              color: COLORS.text.muted,
            }}
          >
            Uploading as a new version keeps the old copy and its marks — it just moves out of your active list.
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              autoFocus={a.primary}
              onClick={() => onResolve?.(a.id)}
              style={{
                padding: '9px 16px',
                borderRadius: BORDERS.radius.md,
                border: a.primary ? 'none' : `1px solid ${COLORS.modal.border}`,
                background: a.primary ? COLORS.accent.primary : 'transparent',
                color: a.primary ? COLORS.text.dark : COLORS.text.primary,
                fontSize: TYPOGRAPHY.fontSize.md,
                fontWeight: TYPOGRAPHY.fontWeight.medium,
                cursor: 'pointer',
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DuplicateUploadModal;
