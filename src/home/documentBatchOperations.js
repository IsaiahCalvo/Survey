const RECOVERY_KIND = 'document-move-copy-v1';

const snapshotDocument = (document) => ({
  id: document?.id,
  name: document?.name,
  file_path: document?.file_path || document?.filePath || null,
  file_size: document?.file_size ?? document?.fileSize ?? null,
  page_count: document?.page_count ?? document?.pageCount ?? null,
  project_id: document?.project_id ?? document?.projectId ?? null,
});

export function createDocumentBatchRecovery({ documents, projectId, mode, makeOperationId }) {
  if (mode !== 'copy' && mode !== 'move') {
    throw new Error(`Unsupported document operation: ${mode}`);
  }
  const list = Array.isArray(documents) ? documents.filter(Boolean) : [];
  return {
    kind: RECOVERY_KIND,
    mode,
    projectId,
    phase: 'execute',
    nextIndex: 0,
    completed: [],
    items: list.map((document) => ({
      document: snapshotDocument(document),
      previousProjectId: document?.project_id ?? document?.projectId ?? null,
      operationId: mode === 'copy' ? makeOperationId() : null,
    })),
  };
}

export function parseDocumentBatchRecovery(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (!parsed || parsed.kind !== RECOVERY_KIND) return null;
  if (parsed.mode !== 'copy' && parsed.mode !== 'move') return null;
  if (!parsed.projectId || !Array.isArray(parsed.items) || !Array.isArray(parsed.completed)) return null;
  return parsed;
}

const committedCopyMatches = (row, state, item) => Boolean(
  row
  && row.id === item.operationId
  && (row.project_id ?? null) === (state.projectId ?? null)
);

const committedMoveMatches = (row, state, item) => Boolean(
  row
  && row.id === item.document.id
  && (row.project_id ?? null) === (state.projectId ?? null)
);

const rollbackFor = (state, rollbackCopy, rollbackMove) => (
  state.mode === 'copy' ? rollbackCopy : rollbackMove
);

async function drainCleanup(state, rollbackCopy, rollbackMove, onRecoveryChange) {
  const rollback = rollbackFor(state, rollbackCopy, rollbackMove);
  const pending = [];
  const cleanupErrors = [];
  for (const value of state.completed) {
    try { await rollback(value); }
    catch (error) {
      pending.push(value);
      cleanupErrors.push(error);
    }
  }
  state.completed = pending;
  onRecoveryChange?.(pending.length ? state : null);
  if (cleanupErrors.length) {
    const error = new Error('Could not finish cleaning up the previous document operation.');
    error.code = 'COMPENSATION_INCOMPLETE';
    error.cleanupErrors = cleanupErrors;
    error.recovery = state;
    throw error;
  }
}

export async function moveOrCopyDocumentsAtomically({
  documents,
  projectId,
  mode,
  copyDocument,
  rollbackCopy,
  moveDocument,
  rollbackMove,
  readDocument,
  makeOperationId = () => globalThis.crypto.randomUUID(),
  recovery = null,
  onRecoveryChange,
}) {
  const state = parseDocumentBatchRecovery(recovery) || createDocumentBatchRecovery({
    documents,
    projectId,
    mode,
    makeOperationId,
  });
  onRecoveryChange?.(state);

  // A retry always finishes the original operation using its original mode and
  // destination. A newly-clicked mode can never reinterpret old cleanup data.
  if (state.phase === 'cleanup') {
    await drainCleanup(state, rollbackCopy, rollbackMove, onRecoveryChange);
    return [];
  }

  for (let index = state.nextIndex; index < state.items.length; index += 1) {
    const item = state.items[index];
    let committed;
    try {
      if (state.mode === 'copy') {
        committed = await copyDocument(item.document, state.projectId, item);
      } else {
        await moveDocument(item.document, state.projectId, item);
        committed = { document: item.document, previousProjectId: item.previousProjectId };
      }
    } catch (operationError) {
      let authoritative;
      try {
        authoritative = await readDocument(
          state.mode === 'copy' ? item.operationId : item.document.id,
        );
      } catch (reconcileError) {
        // The operation outcome is unknown. Do not compensate earlier values or
        // delete bytes until an authoritative read resolves it on retry.
        operationError.reconcileError = reconcileError;
        operationError.recovery = state;
        onRecoveryChange?.(state);
        throw operationError;
      }

      const didCommit = state.mode === 'copy'
        ? committedCopyMatches(authoritative, state, item)
        : committedMoveMatches(authoritative, state, item);
      if (didCommit) {
        committed = state.mode === 'copy'
          ? authoritative
          : { document: item.document, previousProjectId: item.previousProjectId };
      } else {
        state.phase = 'cleanup';
        // A failed copy can still have uploaded its deterministic object. Its
        // recovery value lets rollback remove that orphan without guessing.
        if (state.mode === 'copy' && operationError.recoveryValue) {
          state.completed.unshift(operationError.recoveryValue);
        }
        onRecoveryChange?.(state);
        try { await drainCleanup(state, rollbackCopy, rollbackMove, onRecoveryChange); }
        catch (cleanupError) {
          operationError.cleanupErrors = cleanupError.cleanupErrors;
          operationError.recovery = cleanupError.recovery;
        }
        throw operationError;
      }
    }

    state.completed.unshift(committed);
    state.nextIndex = index + 1;
    onRecoveryChange?.(state);
  }

  const result = [...state.completed].reverse();
  onRecoveryChange?.(null);
  return result;
}
