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
import DialogCard from './DialogCard.jsx';
import { Z_INDEX } from '../theme';

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

  // The app's one dialog shell. The safe default action takes the first focus.
  return (
    <DialogCard
      title={title}
      message={body}
      onClose={onClose}
      width={440}
      zIndex={Z_INDEX.modalOverlay}
      footer={actions.map((a) => (
        <button
          key={a.id}
          type="button"
          data-autofocus={a.primary ? '' : undefined}
          className={a.primary ? 'hub-btn hub-btn--primary dialog-touch-pad' : 'hub-btn dialog-touch-pad'}
          onClick={() => onResolve?.(a.id)}
        >
          {a.label}
        </button>
      ))}
    >
      {isVersion ? 'Uploading as a new version keeps the old copy and its marks. It just moves out of your active list.' : null}
    </DialogCard>
  );
};

export default DuplicateUploadModal;
