import { nextAvailableName } from '../utils/incomingFileResolver.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/i;

export class ProjectUploadRecoveryError extends Error {
  constructor(code, message, attempt = {}, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProjectUploadRecoveryError'; this.code = code;
    this.attemptId = attempt.attemptId || attempt.id; this.projectId = attempt.projectId;
  }
}

const fail = (code, message, attempt, cause) => new ProjectUploadRecoveryError(code, message, attempt, cause);
const current = (isCurrent, attempt) => {
  if (typeof isCurrent !== 'function' || !isCurrent()) throw fail('scope-changed', 'The account or upload view changed. This upload was kept for retry.', attempt);
};
const requireId = (id, label) => { if (typeof id !== 'string' || !UUID.test(id)) throw fail('invalid-input', `Invalid ${label}.`); return id; };
const nonempty = value => typeof value === 'string' && !!value.trim();

// Wait for all active slots even if one fails. A returned failure never leaves
// another unobserved parser or upload running behind a new retry.
async function bounded(entries, worker) {
  let next = 0; const results = new Array(entries.length);
  await Promise.all(Array.from({ length: Math.min(2, entries.length) }, async () => {
    while (next < entries.length) {
      const index = next++;
      try { results[index] = { value: await worker(entries[index], index) }; }
      catch (error) { results[index] = { error }; }
    }
  }));
  const failure = results.find(result => result.error);
  if (failure) throw failure.error;
  return results.map(result => result.value);
}

function projectMatches(row, attempt) {
  return row && row.id === attempt.projectId && row.user_id === attempt.actorId && row.name === attempt.name
    && row.archived !== true && row.user_archived_at == null;
}

function documentMatches(row, attempt, file, id = file.documentId) {
  return row && row.id === id && row.user_id === attempt.actorId && row.project_id === attempt.projectId
    && row.content_sha256 === file.contentSha && row.file_path === file.filePath && row.file_size === file.size
    && row.archived === false && row.user_archived_at == null;
}

function boundary(isCurrent, attempt) {
  return async action => { current(isCurrent, attempt); const result = await action(); current(isCurrent, attempt); return result; };
}
const sourceMetadata = file => ({ sourceName: file.name, size: Blob.prototype.slice.call(file).size,
  type: file.type, lastModified: file.lastModified });
const sourceMatches = (left, right) => left.sourceName === right.sourceName && left.size === right.size
  && left.type === right.type && left.lastModified === right.lastModified;
function checkPrepared(value, metadata, attempt) {
  if (!(value?.file instanceof Blob) || value.file.size !== metadata.size || !SHA.test(value.contentSha || '')
    || value.file.name !== metadata.sourceName || value.file.lastModified !== metadata.lastModified || value.file.type !== metadata.type) {
    throw fail('source-mismatch', 'The selected file changed or could not be verified. Its pending upload was kept.', attempt);
  }
  return value;
}
async function reportFailure(journal, actorId, attempt, isCurrent, error,
  message = 'This upload did not finish. Its saved files were kept for retry.') {
  if (error instanceof ProjectUploadRecoveryError) return error;
  try {
    await boundary(isCurrent, attempt)(() => journal.patchAttempt(actorId, attempt.id,
      { error: message }));
  } catch { /* Failure reporting must not replace the original recovery record. */ }
  return fail('upload-pending', message, attempt, error);
}

export async function stageProjectUpload({ actorId, name, files, journal, prepareFile,
  makeId = () => crypto.randomUUID(), isCurrent, locks }) {
  requireId(actorId, 'account'); current(isCurrent);
  if (!nonempty(name) || !Array.isArray(files)) throw fail('invalid-input', 'Choose a project name and PDF files.');
  const taken = new Set();
  const attempt = { id: requireId(makeId(), 'attempt ID'), projectId: requireId(makeId(), 'project ID'), name: name.trim(),
    files: files.map(file => {
      const metadata = sourceMetadata(file); const displayName = nextAvailableName(metadata.sourceName, taken); taken.add(displayName);
      return { ...metadata, id: requireId(makeId(), 'file ID'), documentId: requireId(makeId(), 'document ID'), name: displayName };
    }) };
  const wait = boundary(isCurrent, attempt);
  let recoveryCreated = false;
  try { return await withProjectUploadLock({ actorId, attemptId: attempt.id, locks, isCurrent }, async () => {
    try {
      await wait(async () => {
        const saved = await journal.create(actorId, attempt);
        recoveryCreated = true;
        return saved;
      });
      await bounded(files, async (source, index) => {
        const entry = attempt.files[index];
        const prepared = checkPrepared(await wait(() => prepareFile(source)), entry, attempt);
        await wait(() => journal.stageFile(actorId, attempt.id, entry.id,
          { contentSha: prepared.contentSha, filePath: `${actorId}/${attempt.projectId}/${prepared.contentSha}.pdf` }, prepared.file));
      });
      await wait(() => journal.patchAttempt(actorId, attempt.id, { phase: 'ready', error: null }));
      return attempt.id;
    } catch (error) {
      if (!recoveryCreated) throw fail('staging-failed', 'Could not save this upload on this device.', attempt, error);
      throw await reportFailure(journal, actorId, attempt, isCurrent, error,
        'Could not finish saving this upload on this device. Keep the original files and reselect them to retry. No cloud changes were made.');
    }
  }); } catch (error) {
    error.recoveryCreated = recoveryCreated;
    if (!recoveryCreated) error.message = 'Could not save this upload on this device. Keep the selected files and try again. No cloud changes were made.';
    throw error;
  }
}

async function resumeUnlocked({ actorId, attemptId, files, journal, prepareFile, isCurrent }) {
  requireId(actorId, 'account'); requireId(attemptId, 'attempt ID');
  let attempt = { id: attemptId }; const wait = boundary(isCurrent, attempt);
  try {
    attempt = await wait(() => journal.get(actorId, attemptId));
    if (!attempt || attempt.actorId !== actorId || attempt.id !== attemptId) throw fail('not-found', 'This upload was not found for this account.', { id: attemptId });
    if (attempt.phase !== 'preparing') return attemptId;
    if (!Array.isArray(files) || files.length !== attempt.files.length) throw fail('source-mismatch', 'Reselect all original files for this upload.', attempt);
    const inputs = files.map(file => ({ file, metadata: sourceMetadata(file) }));
    const prepared = await bounded(inputs, async input => ({ ...input,
      prepared: checkPrepared(await wait(() => prepareFile(input.file)), input.metadata, attempt) }));
    const unused = new Set(prepared); const matched = new Map();
    // Already staged hashes disambiguate equal names/sizes without replacing
    // their durable bytes. Unstaged ambiguous sources must not be guessed.
    for (const entry of [...attempt.files].sort((a, b) => Number(!!b.contentSha) - Number(!!a.contentSha))) {
      const candidates = [...unused].filter(input => sourceMatches(input.metadata, entry)
        && (!entry.contentSha || input.prepared.contentSha === entry.contentSha));
      if (!candidates.length || new Set(candidates.map(input => input.prepared.contentSha)).size > 1) {
        throw fail('source-mismatch', 'The reselected files do not uniquely match this upload. No cloud changes were made.', attempt);
      }
      const selected = candidates[0]; unused.delete(selected); matched.set(entry.id, selected.prepared);
    }
    await bounded(attempt.files.filter(file => file.state === 'pending'), async entry => {
      const value = matched.get(entry.id);
      await wait(() => journal.stageFile(actorId, attemptId, entry.id,
        { contentSha: value.contentSha, filePath: `${actorId}/${attempt.projectId}/${value.contentSha}.pdf` }, value.file));
    });
    await wait(() => journal.patchAttempt(actorId, attemptId, { phase: 'ready', error: null }));
    return attemptId;
  } catch (error) { throw await reportFailure(journal, actorId, attempt || { id: attemptId }, isCurrent, error); }
}

export async function withProjectUploadLock({ actorId, attemptId, locks, isCurrent }, work) {
  requireId(actorId, 'account'); requireId(attemptId, 'attempt ID');
  const attempt = { id: attemptId }; current(isCurrent, attempt);
  let manager;
  try { manager = locks === undefined ? globalThis.navigator?.locks : locks; }
  catch (error) { throw fail('locks-unavailable', 'Safe upload retry is unavailable in this browser. Its saved files were kept.', attempt, error); }
  if (typeof manager?.request !== 'function') throw fail('locks-unavailable', 'Safe upload retry is unavailable in this browser. Its saved files were kept.', attempt);
  return manager.request(`survey:project-upload:${actorId}:${attemptId}`, { mode: 'exclusive' }, async () => {
    current(isCurrent, attempt); const result = await work(); current(isCurrent, attempt); return result;
  });
}

export const resumeStaging = options => withProjectUploadLock(options, () => resumeUnlocked(options));

export const runProjectUpload = options => withProjectUploadLock(options, () => runUnlocked(options));

async function runUnlocked({ actorId, attemptId, journal, cloud, isCurrent, onProgress }) {
  let attempt = { id: attemptId }; let wait = boundary(isCurrent, attempt);
  const progress = value => { try { onProgress?.(value); } catch { /* UI reporting cannot alter receipts. */ } };
  try {
    attempt = await wait(() => journal.get(actorId, attemptId));
    if (!attempt || attempt.actorId !== actorId || attempt.id !== attemptId) throw fail('not-found', 'This upload was not found for this account.', { id: attemptId });
    wait = boundary(isCurrent, attempt);
    if (attempt.phase === 'complete') {
      await wait(() => journal.finish(actorId, attemptId));
      return { attemptId, projectId: attempt.projectId, complete: true };
    }
    if (attempt.phase === 'preparing' && attempt.files.length === 0) {
      await wait(() => journal.patchAttempt(actorId, attemptId, { phase: 'ready', error: null }));
      attempt.phase = 'ready';
    }
    if (attempt.phase === 'preparing' || attempt.files.some(file => file.state === 'pending')) {
      throw fail('staging-required', 'Reselect the original files to finish saving this upload on this device first.', attempt);
    }
    const blobs = new Map();
    // No network request begins until every staged payload is readable.
    await bounded(attempt.files, async file => {
      const blob = await wait(() => journal.readFile(actorId, attemptId, file.id));
      if (!(blob instanceof Blob) || blob.size !== file.size || !SHA.test(file.contentSha)
        || file.filePath !== `${actorId}/${attempt.projectId}/${file.contentSha}.pdf`) {
        throw fail('staging-required', 'A saved upload file is missing or invalid. Its recovery record was kept.', attempt);
      }
      blobs.set(file.id, blob);
    });
    await wait(() => journal.patchAttempt(actorId, attemptId, { phase: 'running', error: null }));
    let project = await wait(() => cloud.readProject(attempt.projectId));
    if (project === null && attempt.projectState !== 'confirmed') {
      await wait(() => journal.patchAttempt(actorId, attemptId, { projectState: 'unknown' }));
      try { project = await wait(() => cloud.createProject({ id: attempt.projectId, user_id: actorId, name: attempt.name })); }
      catch (error) {
        current(isCurrent, attempt);
        project = await wait(() => cloud.readProject(attempt.projectId));
        if (!projectMatches(project, attempt)) throw error;
      }
    }
    if (!projectMatches(project, attempt)) throw fail('cloud-conflict', 'The saved project no longer matches this upload. No cleanup was performed.', attempt);
    await wait(() => journal.patchAttempt(actorId, attemptId, { projectState: 'confirmed' }));
    progress({ attemptId, projectId: attempt.projectId, phase: 'running' });

    const groups = new Map();
    for (const file of attempt.files) {
      if (!groups.has(file.contentSha)) groups.set(file.contentSha, []);
      groups.get(file.contentSha).push(file);
    }
    await bounded([...groups.values()], async files => {
      const file = files.find(entry => entry.state === 'confirmed') || files[0];
      let row = await wait(() => cloud.readDocument(file.documentId));
      if (row !== null && !documentMatches(row, attempt, file)) throw fail('cloud-conflict', 'The requested cloud document returned a different identity.', attempt);
      if (row === null && file.state !== 'confirmed') row = await wait(() => cloud.findDocumentByHash(attempt.projectId, file.contentSha));
      if (row !== null && (!UUID.test(row?.id || '') || !documentMatches(row, attempt, file, row.id))) {
        throw fail('cloud-conflict', 'A cloud document no longer matches this upload. Its saved files were kept.', attempt);
      }
      if (row === null && file.state === 'confirmed') throw fail('cloud-conflict', 'A confirmed cloud document is unavailable. No replacement was created.', attempt);
      const targetId = row?.id || file.documentId;
      if (files.some(entry => entry.state === 'confirmed' && entry.documentId !== targetId)) {
        throw fail('cloud-conflict', 'Confirmed upload files refer to different cloud documents. Their records were kept.', attempt);
      }
      const unfinished = files.filter(entry => entry.state !== 'confirmed');
      if (unfinished.length) {
        for (const member of unfinished) await wait(() => journal.patchFile(actorId, attemptId, member.id,
          { state: 'storage-pending', documentId: targetId, error: null }));
        // A matching published row may have been edited since this attempt.
        // Its original SHA is not permission to restore the staged PDF over it.
        if (row === null) await wait(() => cloud.uploadFile(file.filePath, blobs.get(file.id)));
        for (const member of unfinished) await wait(() => journal.patchFile(actorId, attemptId, member.id, { state: 'storage-confirmed' }));
      }
      for (const member of unfinished) await wait(() => journal.patchFile(actorId, attemptId, member.id, { state: 'document-pending' }));
      let pageCount = null;
      if (row === null) {
        // Count only before the first insert. Structural PDF replacement can
        // change Storage without updating row metadata, so no later row CAS
        // can make an original-byte page-count update safe for published PDFs.
        try {
          pageCount = await wait(() => cloud.readPageCount(blobs.get(file.id)));
          if (!Number.isSafeInteger(pageCount) || pageCount < 1) pageCount = null;
        } catch { current(isCurrent, attempt); pageCount = null; }
        try {
          row = await wait(() => cloud.createDocument({ id: targetId, user_id: actorId,
            project_id: attempt.projectId, name: file.name, file_path: file.filePath, file_size: file.size,
            content_sha256: file.contentSha, page_count: pageCount, archived: false }));
        } catch (error) {
          current(isCurrent, attempt);
          row = await wait(() => cloud.readDocument(targetId));
          if (row !== null && !documentMatches(row, attempt, file, targetId)) throw error;
          if (row === null) row = await wait(() => cloud.findDocumentByHash(attempt.projectId, file.contentSha));
          if (!row || !documentMatches(row, attempt, file, row.id)) throw error;
        }
      }
      if (!UUID.test(row?.id || '') || !documentMatches(row, attempt, file, targetId)) throw fail('cloud-conflict', 'The cloud write target changed. Its saved files were kept for a fresh retry.', attempt);
      // Supplementary aliases/page counts never determine PDF durability. Keep
      // their parser inside this bounded slot, including failed parses.
      const names = files.map(entry => entry.name).filter(name => name !== row.name);
      if (names.length) {
        const fresh = await wait(() => cloud.readDocument(row.id));
        if (!documentMatches(fresh, attempt, file, row.id)) throw fail('cloud-conflict', 'The cloud document changed before its names could be checked.', attempt);
        const aliases = [...new Set([...(Array.isArray(fresh.name_aliases) ? fresh.name_aliases : []), ...names])];
        if (aliases.some(name => !(fresh.name_aliases || []).includes(name))) {
          await wait(() => cloud.updateDocument(row.id, { name_aliases: aliases }, fresh));
        }
      }
      for (const member of files) {
        if (member.state !== 'confirmed') {
          await wait(() => journal.patchFile(actorId, attemptId, member.id, { state: 'confirmed', documentId: row.id, error: null }));
        }
      }
      if (pageCount) for (const member of files) await wait(() => journal.patchFile(actorId, attemptId, member.id, { pageCount }));
      progress({ attemptId, projectId: attempt.projectId, phase: 'running', documentId: row.id });
    });
    await wait(() => journal.patchAttempt(actorId, attemptId, { phase: 'complete', error: null }));
    await wait(() => journal.finish(actorId, attemptId));
    return { attemptId, projectId: attempt.projectId, complete: true };
  } catch (error) { throw await reportFailure(journal, actorId, attempt || { id: attemptId }, isCurrent, error); }
}
