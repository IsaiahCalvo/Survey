// Durable single-document orchestration. No automatic replay, cache eviction,
// cloud cleanup, or best-effort in-memory substitute for saved upload bytes.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const PHASES = ['ready', 'running', 'document-confirmed', 'archive-confirmed', 'complete'];
export class DocumentUploadRecoveryError extends Error {
  constructor(code, message, attempt = {}, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DocumentUploadRecoveryError'; this.code = code;
    this.attemptId = attempt.id || attempt.attemptId; this.projectId = attempt.projectId;
  }
}
const fail = (code, message, attempt, cause) => new DocumentUploadRecoveryError(code, message, attempt, cause);
const check = (ok, message, attempt) => { if (!ok) throw fail('cloud-conflict', message, attempt); };
const requireId = value => { if (!UUID.test(value || '')) throw fail('invalid-input', 'A valid account or upload ID is required.'); return value; };
const current = (isCurrent, attempt) => {
  if (typeof isCurrent !== 'function' || !isCurrent()) throw fail('scope-changed', 'The account or view changed. The saved upload was kept for retry.', attempt);
};
const boundary = (isCurrent, attempt) => async action => {
  current(isCurrent, attempt); const result = await action(); current(isCurrent, attempt); return result;
};
function lockManager(locks, attempt) {
  let manager;
  try { manager = locks === undefined ? globalThis.navigator?.locks : locks; } catch { /* fail closed below */ }
  if (typeof manager?.request !== 'function') throw fail('locks-unavailable', 'Safe upload retry is unavailable in this browser. Keep the original file or saved retry copy.', attempt);
  return manager;
}
export async function withDocumentUploadLock({ actorId, attemptId, locks, isCurrent }, work) {
  requireId(actorId); requireId(attemptId); const attempt = { id: attemptId }; current(isCurrent, attempt);
  return lockManager(locks, attempt).request(`survey:document-upload:${actorId}:${attemptId}`, { mode: 'exclusive' }, async () => {
    current(isCurrent, attempt); const result = await work(); current(isCurrent, attempt); return result;
  });
}

export async function stageDocumentUpload({ actorId, projectId = null, file, archiveDocument = null,
  journal, prepareFile, makeId = () => crypto.randomUUID(), isCurrent, locks }) {
  requireId(actorId); if (projectId !== null) requireId(projectId);
  const attempt = { id: requireId(makeId()), documentId: requireId(makeId()), projectId };
  const wait = boundary(isCurrent, attempt); let recoveryCreated = false;
  try {
    return await withDocumentUploadLock({ actorId, attemptId: attempt.id, locks, isCurrent }, async () => {
      // Capture replacement consent before any asynchronous read can change it.
      const archive = archiveDocument === null ? null : structuredClone(archiveDocument);
      const prepared = await wait(() => prepareFile(file));
      if (!(prepared?.file instanceof Blob) || !prepared.file.size || !SHA.test(prepared.contentSha || '')) {
        throw fail('invalid-input', 'Could not read and verify the selected PDF.', attempt);
      }
      Object.assign(attempt, { name: prepared.file.name, size: prepared.file.size, type: prepared.file.type,
        lastModified: prepared.file.lastModified, contentSha: prepared.contentSha,
        filePath: `${actorId}/${attempt.documentId}/${prepared.contentSha}.pdf`, archiveDocument: archive });
      await wait(async () => { await journal.create(actorId, attempt, prepared.file); recoveryCreated = true; });
      return attempt.id;
    });
  } catch (error) {
    const result = error instanceof DocumentUploadRecoveryError ? error : fail('staging-failed', 'Could not save this upload on this device. Keep the original file and try again. No cloud changes were made.', attempt, error);
    result.recoveryCreated = recoveryCreated; throw result;
  }
}

function ownedPath(path, actorId) {
  return typeof path === 'string' && path.startsWith(`${actorId}/`) && !/[\\%?#]/.test(path)
    && path.split('/').every(part => part && part !== '.' && part !== '..');
}
function assertDocument(row, attempt, target = attempt.target) {
  // A reused legacy row may not record its size. This permits reading its
  // published PDF, not repairing missing bytes; the cloud adapter still needs
  // an exact recorded size for repair. Our own candidate must retain its size.
  const validSize = (Number.isSafeInteger(row?.file_size) && row.file_size >= 0)
    || (row?.file_size === null && row.id !== attempt.documentId);
  check(row && UUID.test(row.id || '') && row.user_id === attempt.actorId && row.project_id === attempt.projectId
    && row.content_sha256 === attempt.contentSha && ownedPath(row.file_path, attempt.actorId)
    && validSize && row.user_archived_at == null
    && (row.archived === false || row.archived === true)
    && (!target || (row.id === target.id && row.file_path === target.file_path)),
  'The cloud document changed or is no longer available. Its saved upload was kept.', attempt);
  return row;
}
const snapshotFields = ['id', 'user_id', 'project_id', 'name', 'file_path', 'content_sha256', 'file_size', 'user_archived_at'];
function assertArchive(row, expected, attempt) {
  check(row && row.id !== attempt.target.id && snapshotFields.every(key => (row[key] ?? null) === (expected[key] ?? null))
    && row.user_id === attempt.actorId && row.user_archived_at == null
    && (row.archived === true || (row.archived === false && row.updated_at === expected.updated_at)),
  'The previous version changed after you chose to replace it. Its saved upload was kept for review.', attempt);
}

export async function runDocumentUpload(options) {
  return withDocumentUploadLock(options, async () => {
    const { actorId, attemptId, journal, isCurrent, locks } = options;
    let attempt = { id: attemptId }; const wait = boundary(isCurrent, attempt);
    try {
      attempt = await wait(() => journal.get(actorId, attemptId));
      if (!attempt || attempt.actorId !== actorId || attempt.id !== attemptId) throw fail('not-found', 'This saved upload was not found for this account.', { id: attemptId });
      if (attempt.phase === 'complete') {
        await wait(() => journal.finish(actorId, attemptId));
        return { attemptId, document: attempt.target, file: null, complete: true, reused: attempt.target.id !== attempt.documentId };
      }
      check(SHA.test(attempt.contentSha) && (attempt.projectId === null || UUID.test(attempt.projectId)), 'Invalid saved upload identity.', attempt);
      // Different attempts for identical bytes serialize too, so another tab
      // can publish its row before this one performs its dedup lookup.
      return await lockManager(locks, attempt).request(`survey:document-upload-content:${JSON.stringify([actorId, attempt.projectId, attempt.contentSha])}`, { mode: 'exclusive' }, async () => {
        current(isCurrent, attempt);
        return runUnlocked({ ...options, attempt });
      });
    } catch (error) {
      const result = error instanceof DocumentUploadRecoveryError ? error : fail('upload-pending', 'The upload did not finish. Its saved file was kept for retry.', attempt || { id: attemptId }, error);
      // Never let old-account error reporting mutate a later account's state.
      try { if (attempt?.actorId === actorId) await boundary(isCurrent, attempt)(() => journal.patch(actorId, attemptId, { error: result.message })); } catch { /* retain original error */ }
      throw result;
    }
  });
}

async function runUnlocked({ actorId, attemptId, journal, cloud, isCurrent, chooseAlias, onProgress,
  readPageCount = cloud?.readPageCount, attempt }) {
  const wait = boundary(isCurrent, attempt);
  const patch = async updates => { await wait(() => journal.patch(actorId, attemptId, updates)); Object.assign(attempt, updates); };
  const advance = async phase => { if (PHASES.indexOf(attempt.phase) < PHASES.indexOf(phase)) await patch({ phase }); };
  const readTarget = async () => assertDocument(await wait(() => cloud.readDocument(attempt.target.id)), attempt);
  const staged = await wait(() => journal.readFile(actorId, attemptId));
  check(staged instanceof Blob && staged.size === attempt.size && attempt.filePath === `${actorId}/${attempt.documentId}/${attempt.contentSha}.pdf`,
    'The saved upload bytes are missing or invalid. Keep its retry record.', attempt);
  if (attempt.projectId !== null) {
    const project = await wait(() => cloud.readProject(attempt.projectId));
    const writable = project?.user_id === actorId
      || (UUID.test(project?.user_id || '') && project?.uploadWritable === true);
    check(project && project.id === attempt.projectId && writable && project.archived === false && project.user_archived_at == null,
      'The chosen project is no longer available. The saved file was kept.', attempt);
  }
  await advance('running');
  let row = await wait(() => cloud.readDocument(attempt.target?.id || attempt.documentId));
  if (row === null && !attempt.target) row = await wait(() => cloud.findDocumentByHash(attempt.projectId, attempt.contentSha));
  if (row !== null) assertDocument(row, attempt);
  if (row === null && attempt.target && (attempt.target.id !== attempt.documentId || PHASES.indexOf(attempt.phase) >= 2)) {
    throw fail('cloud-conflict', 'The bound document was removed. No replacement was created; its saved file was kept.', attempt);
  }
  if (!attempt.target) {
    const target = row || { id: attempt.documentId, user_id: actorId, project_id: attempt.projectId, name: attempt.name,
      file_path: attempt.filePath, content_sha256: attempt.contentSha, file_size: attempt.size,
      page_count: null, archived: false, user_archived_at: null, updated_at: null };
    await patch({ target }); // Commit exact target before any storage or row write.
  }
  let publishedFile;
  if (row === null) {
    await wait(() => cloud.uploadFile(attempt.filePath, staged));
    let pageCount = null;
    try { const count = readPageCount ? await wait(() => readPageCount(staged)) : null;
      if (Number.isSafeInteger(count) && count > 0) pageCount = count;
    } catch { current(isCurrent, attempt); }
    try {
      row = await wait(() => cloud.createDocument({ id: attempt.documentId, user_id: actorId, project_id: attempt.projectId,
        name: attempt.name, file_path: attempt.filePath, content_sha256: attempt.contentSha, file_size: attempt.size,
        page_count: pageCount, archived: false }));
    } catch (error) {
      current(isCurrent, attempt);
      row = await wait(() => cloud.readDocument(attempt.documentId));
      if (row === null) {
        const winner = await wait(() => cloud.findDocumentByHash(attempt.projectId, attempt.contentSha));
        if (winner !== null) throw fail('cloud-conflict', 'Another upload published these bytes under a different document. The pending receipt was kept for review; no objects were deleted.', attempt, error);
        throw error;
      }
    }
    assertDocument(row, attempt);
    // Upload is confirmed and the candidate row now has a read/write receipt.
    // Commit it before further network work so a later deleted row cannot be
    // mistaken for an insert that never happened. An insert whose reply and
    // row both disappear before this receipt still needs server tombstones to
    // distinguish deletion from an uncommitted insert; never claim exactly-once.
    await patch({ target: row }); await advance('document-confirmed');
  }
  // The published object, not the staged original, is the only safe preview.
  // Always use a fresh read proof before repair/revive and later mutations.
  row = await readTarget();
  const previewVersionFields = ['updated_at', 'file_path', 'file_size'];
  const downloadedVersion = Object.fromEntries(previewVersionFields.map(key => [key, row[key]]));
  publishedFile = await wait(() => cloud.ensureDocumentFile(row, staged));
  check(publishedFile instanceof Blob && publishedFile.size > 0, 'The published PDF could not be verified.', attempt);
  if (row.archived === true) {
    row = await readTarget();
    row = assertDocument(await wait(() => cloud.reviveDocument(row)), attempt);
  }
  check(row.archived === false, 'The cloud document could not be restored.', attempt);
  await patch({ target: row }); await advance('document-confirmed');
  let aliasPromptAwaited = false;
  let archiveProcessed = false;
  if (!attempt.aliasDecided) {
    let aliasName = null;
    const knownAlias = Array.isArray(row.name_aliases) && row.name_aliases.includes(attempt.name);
    if (row.name !== attempt.name && !knownAlias) {
      if (typeof chooseAlias !== 'function') throw fail('alias-choice-required', 'Choose whether to keep the picked file name as an alias before this upload can finish.', attempt);
      aliasPromptAwaited = true;
      const choice = await wait(() => chooseAlias(row, attempt.name));
      if (choice === true || choice === 'add-alias' || choice === attempt.name) aliasName = attempt.name;
      else if (choice !== false && choice !== null && choice !== 'skip-alias') throw fail('alias-choice-required', 'The file name choice was not completed. The saved upload was kept.', attempt);
    }
    await patch({ aliasName, aliasDecided: true });
  }
  if (attempt.aliasName) {
    row = await readTarget(); row = assertDocument(await wait(() => cloud.addAlias(row, attempt.aliasName)), attempt);
    await patch({ target: row });
  }
  if (attempt.archiveDocument && PHASES.indexOf(attempt.phase) < 3) {
    archiveProcessed = true;
    const expected = attempt.archiveDocument;
    let previous = await wait(() => cloud.readDocument(expected.id)); assertArchive(previous, expected, attempt);
    if (previous.archived !== true) {
      previous = await wait(() => cloud.archiveDocument(previous)); assertArchive(previous, expected, attempt);
      check(previous.archived === true, 'The previous version was not archived. Its retry record was kept.', attempt);
    }
  }
  await advance('archive-confirmed');
  // Detect a removed/archived target before acknowledging local cleanup.
  row = await readTarget(); check(row.archived === false, 'The uploaded document is no longer active. Its saved file was kept.', attempt);
  if (aliasPromptAwaited || archiveProcessed || previewVersionFields.some(key => row[key] !== downloadedVersion[key])) {
    // Prompts and replacement steps can outlive a shared PDF edit. Read with
    // the final row's current proof, then reject a mixed row/byte version.
    const beforeDownload = row;
    publishedFile = await wait(() => cloud.ensureDocumentFile(beforeDownload, staged));
    check(publishedFile instanceof Blob && publishedFile.size > 0, 'The published PDF could not be verified.', attempt);
    row = await readTarget();
    check(row.archived === false && previewVersionFields.every(key => row[key] === beforeDownload[key]),
      'The published PDF changed while its preview was loading. Its saved upload was kept for retry.', attempt);
  }
  await patch({ target: row }); await advance('complete');
  current(isCurrent, attempt); try { onProgress?.({ attemptId, document: row, phase: 'complete' }); } catch { /* UI cannot change receipts */ }
  await wait(() => journal.finish(actorId, attemptId));
  return { attemptId, document: row, file: publishedFile, complete: true, reused: row.id !== attempt.documentId };
}
