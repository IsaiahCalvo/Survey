// Cloud document IDs own identity. Names, byte sizes and storage paths may
// change without changing the document; equal bytes in two projects may also
// have separate document IDs and independent annotations.
import { readCheckedGenerationPdf } from '../services/documentGenerationReader.js';

const checkedMode = (file, checkedBundle) => checkedBundle != null || file?.pdfGenerationId != null;
function checkedKey(file, checkedBundle) {
  try {
    const { actorUserId, pdfGenerationId } = checkedBundle;
    if (file?.pdfGenerationId != null && file.pdfGenerationId !== pdfGenerationId) throw new Error();
    // Identity helpers never need annotation bytes. Only a reader-issued
    // bundle may identify a checked tab; matching fields alone are not proof.
    readCheckedGenerationPdf(checkedBundle, { documentId: file?.id, actorUserId, pdfGenerationId });
    return JSON.stringify(['checked-document', actorUserId, file.id, pdfGenerationId]);
  } catch {
    throw Object.assign(new Error('The checked document identity could not be verified.'), { code: 'DOCUMENT_OPEN_INPUT' });
  }
}

export function getDocumentOpenKey(file, filePath = null, checkedBundle = null) {
  if (checkedMode(file, checkedBundle)) return checkedKey(file, checkedBundle);
  if (file?.id) return JSON.stringify(['document', String(file.id)]);
  if (file?.storageMode === 'local' && file?.localId) return JSON.stringify(['managed-local', file.localId]);
  if (filePath) return JSON.stringify(['path', filePath]);
  if (file?._surveyPdfId) return JSON.stringify(['local', file._surveyPdfId]);
  return JSON.stringify(['file', file?.name, file?.size, file?.lastModified ?? null]);
}

export function isSameDocumentTab(tab, file, filePath = null, checkedBundle = null) {
  if (tab?.isHome || !tab?.file || !file) return false;
  const existingChecked = checkedMode(tab.file, tab.checkedBundle);
  const incomingChecked = checkedMode(file, checkedBundle);
  if (existingChecked || incomingChecked) {
    if (!existingChecked || !incomingChecked) return false;
    try {
      if (tab.actorUserId !== tab.checkedBundle?.actorUserId
        || (tab.pdfGenerationId != null && tab.pdfGenerationId !== tab.checkedBundle?.pdfGenerationId)) return false;
      return checkedKey(tab.file, tab.checkedBundle) === checkedKey(file, checkedBundle);
    } catch { return false; }
  }
  const existingId = tab.file.id;
  const incomingId = file.id;
  if (existingId || incomingId) {
    return !!existingId && !!incomingId && String(existingId) === String(incomingId);
  }
  if (tab.file.localId || file.localId) {
    return tab.file.storageMode === 'local' && file.storageMode === 'local'
      && !!tab.file.localId && tab.file.localId === file.localId;
  }
  if (tab.file === file) return true;
  if (tab.filePath || filePath) {
    return !!tab.filePath && !!filePath && tab.filePath === filePath;
  }
  return getDocumentOpenKey(tab.file) === getDocumentOpenKey(file);
}
