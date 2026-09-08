// Cloud document IDs own identity. Names, byte sizes and storage paths may
// change without changing the document; equal bytes in two projects may also
// have separate document IDs and independent annotations.
export function getDocumentOpenKey(file, filePath = null) {
  if (file?.id) return JSON.stringify(['document', String(file.id)]);
  if (file?.storageMode === 'local' && file?.localId) return JSON.stringify(['managed-local', file.localId]);
  if (filePath) return JSON.stringify(['path', filePath]);
  if (file?._surveyPdfId) return JSON.stringify(['local', file._surveyPdfId]);
  return JSON.stringify(['file', file?.name, file?.size, file?.lastModified ?? null]);
}

export function isSameDocumentTab(tab, file, filePath = null) {
  if (tab?.isHome || !tab?.file || !file) return false;
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
