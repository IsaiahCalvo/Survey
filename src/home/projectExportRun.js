// Export project (Nightly flag 'project-export'): builds the zip on the
// device. Rules and names: projectExport.js. Marks are read from the cloud
// copy of each file's annotation store (read only, the way "Upload as new
// version" reads it) and written into the PDF with the viewer's own Export
// writer, so a file comes out as "Download with marks" would give it.
// jszip, pdf-lib and the writer load only when an export runs.

import { commentsPathFor, projectExportPlan, projectZipName } from './projectExport.js';

const BOM = '﻿';

async function bytesOf(blob) {
  if (blob instanceof Uint8Array) return blob;
  if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Older copies of each file: { [currentId]: [rows with versionNumber / isCurrent] }. */
async function loadOlderVersions(client, documents) {
  const { listDocumentVersions } = await import('../services/documentVersionService.js');
  const chains = await Promise.all(documents.map(async (doc) => {
    try { return [doc.id, await listDocumentVersions(client, doc.id)]; } catch { return [doc.id, []]; }
  }));
  const olderIds = [];
  for (const [currentId, chain] of chains) for (const v of chain) if (v.id !== currentId && !v.isCurrent) olderIds.push(v.id);
  if (!olderIds.length) return {};
  const { data } = await client.from('documents')
    .select('id, name, file_path, sheet_number, sheet_revision')
    .in('id', olderIds);
  const rows = new Map((data || []).map((row) => [row.id, row]));
  const out = {};
  for (const [currentId, chain] of chains) {
    out[currentId] = chain
      .filter((v) => v.id !== currentId && !v.isCurrent)
      .map((v) => ({ ...(rows.get(v.id) || { id: v.id, name: v.name, file_path: null }), versionNumber: v.versionNumber, isCurrent: false }));
  }
  return out;
}

/** The page sizes the viewer measures (pdf.js at scale 1: crop box, turned with /Rotate). */
async function pageSizesOf(bytes) {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const sizes = {};
  pdf.getPages().forEach((page, i) => {
    const box = page.getCropBox();
    const turned = Math.abs(Number(page.getRotation()?.angle) || 0) % 180 === 90;
    sizes[i + 1] = turned ? { width: box.height, height: box.width } : { width: box.width, height: box.height };
  });
  return sizes;
}

/** The file with its marks, or its stored bytes when it has none. */
export async function withStoredMarks(client, documentId, bytes) {
  const [{ loadStoredAnnotationDoc }, store, { carryOverLegacyMarks }, { deriveCalloutsFromByPage }] = await Promise.all([
    import('../services/documentVersionMarks.js'),
    import('../services/annotationDocStore.js'),
    import('../services/legacyMarksCarryOver.js'),
    import('../utils/calloutAnnotationBridge.js'),
  ]);
  const doc = await loadStoredAnnotationDoc(client, documentId);
  try {
    // Marks from older builds still sit in the old map until the file is
    // reopened; the viewer carries them on open, so do the same here (this
    // copy is never written back).
    try { carryOverLegacyMarks(doc, { origin: 'project-export' }); } catch { /* read what is there */ }
    const byPage = store.docToByPage(doc);
    const count = Object.values(byPage || {}).reduce((n, page) => n + (page?.objects?.length || 0), 0);
    if (!count) return bytes;
    const { savePDFWithAnnotationsPdfLib } = await import('../utils/pdfAnnotationsPdfLib');
    const out = await savePDFWithAnnotationsPdfLib(
      new Blob([bytes], { type: 'application/pdf' }),
      byPage,
      await pageSizesOf(bytes),
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId,
        callouts: deriveCalloutsFromByPage(byPage),
        // Regular markup only, as Export PDF gives with no survey open.
        surveyMarkers: {},
        activeModuleId: null,
        spaces: [],
        deletedPdfAnnotations: store.docToDeletedPdfAnnotations(doc),
      },
    );
    return out ? new Uint8Array(out) : bytes;
  } finally {
    try { doc.destroy(); } catch { /* */ }
  }
}

async function addComments(zip, client, files, taken) {
  const [{ listCommentPeople, listMarkComments, personLabel }, { commentsCsv }] = await Promise.all([
    import('../services/markComments.js'),
    import('../utils/exportFilters.js'),
  ]);
  let added = 0;
  for (const file of files) {
    let comments = [];
    try { comments = await listMarkComments(client, file.documentId); } catch { comments = []; }
    if (!comments.some((c) => c && !c.deletedAt)) continue;
    const people = await listCommentPeople(client, file.documentId).catch(() => []);
    const csv = commentsCsv(comments, {
      documentName: String(file.doc?.name || '').replace(/\.pdf$/i, ''),
      nameOf: (id) => personLabel(people.find((p) => p.id === id) || null),
    });
    zip.file(commentsPathFor(taken, file.path), `${BOM}${csv}`, { compression: 'DEFLATE' });
    added += 1;
  }
  return added;
}

async function addRegisters(zip, client, project, documents, lookupMember) {
  const [{ ITEM_KINDS, itemsCsv, registerFileName }, { loadLatestComments }] = await Promise.all([
    import('../projectItems/projectItems.js'),
    import('../projectItems/projectItemsData.js'),
  ]);
  const { data, error } = await client.from('project_items')
    .select('id, kind, number, title, description, status, assignee_id, due_date, tags, links, created_by, created_at, updated_at, archived_at')
    .eq('project_id', project.id)
    .is('archived_at', null)
    .order('number', { ascending: true })
    .limit(5000);
  if (error || !data?.length) return 0;
  const latest = await loadLatestComments(project.id, { client }).catch(() => new Map());
  let added = 0;
  for (const kind of Object.keys(ITEM_KINDS)) {
    const list = data.filter((item) => item.kind === kind);
    if (!list.length) continue;
    const csv = itemsCsv(list, {
      memberName: (id) => lookupMember?.(id)?.name || '',
      docName: (id) => documents.find((d) => d.id === id)?.name || '',
      lastComment: (id) => latest?.get?.(id) || '',
    });
    zip.file(`Issues/${registerFileName(project.name, kind)}`, csv, { compression: 'DEFLATE' });
    added += 1;
  }
  return added;
}

/**
 * Build the zip. options: { allRevisions, withMarks, comments, issues,
 * restrict }. restrict (Nightly 'restrict-editing'): every PDF opens freely
 * but needs one password, made here and returned, to change.
 * download(filePath) -> Blob (useStorage's downloadDocument).
 * onProgress({ done, total, phase }); isCancelled() stops between files.
 * -> { bytes, fileName, count, failed: [names], skipped: [names], password } or null when cancelled.
 */
export async function buildProjectExport({
  client, project, documents = [], options = {}, download, lookupMember = null,
  onProgress = () => {}, isCancelled = () => false,
}) {
  const { default: JSZip } = await import('jszip');
  const versions = options.allRevisions ? await loadOlderVersions(client, documents) : {};
  const { files, skipped } = projectExportPlan({ documents, versions, allRevisions: Boolean(options.allRevisions) });
  const zip = new JSZip();
  const taken = new Set(files.map((f) => f.path));
  const failed = [];
  let count = 0;
  const lock = options.restrict ? await import('../utils/restrictPdfEditing.js') : null;
  const password = lock ? lock.makeEditPassword() : null;
  for (const [i, file] of files.entries()) {
    if (isCancelled()) return null;
    onProgress({ done: i, total: files.length, phase: 'files' });
    try {
      let bytes = await bytesOf(await download(file.filePath));
      if (options.withMarks !== false) {
        try {
          bytes = await withStoredMarks(client, file.documentId, bytes);
        } catch (error) {
          // The file still goes in, without marks, and the person is told.
          console.warn('[projectExport] marks not added', file.documentId, error);
          failed.push(`${file.path.slice(file.path.indexOf('/') + 1)} (without marks)`);
        }
      }
      // A file that should be locked and can't be stays out (and is listed).
      if (lock) bytes = (await lock.restrictPdfEditing(bytes, { password })).bytes;
      zip.file(file.path, bytes);
      count += 1;
    } catch (error) {
      console.warn('[projectExport] file not added', file.documentId, error);
      failed.push(file.path.slice(file.path.indexOf('/') + 1));
    }
  }
  if (isCancelled()) return null;
  onProgress({ done: files.length, total: files.length, phase: 'lists' });
  if (options.comments !== false) count += await addComments(zip, client, files.filter((f) => zip.file(f.path)), taken);
  if (options.issues !== false) count += await addRegisters(zip, client, project, documents, lookupMember);
  if (isCancelled()) return null;
  onProgress({ done: files.length, total: files.length, phase: 'zip' });
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return { bytes, fileName: projectZipName(project?.name, count), count, failed, skipped, password };
}
