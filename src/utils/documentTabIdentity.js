// Cloud document IDs own identity. Names, byte sizes and storage paths may
// change without changing the document; equal bytes in two projects may also
// have separate document IDs and independent annotations.
function resolveDocumentId(value) {
  const raw = value?.id ?? value?.documentId ?? value?.document_id ?? null;
  return raw != null && String(raw) !== '' ? String(raw) : null;
}

function resolveProjectId(value) {
  const raw = value?.projectId ?? value?.project_id ?? null;
  return raw != null && String(raw) !== '' ? String(raw) : null;
}

export function getDocumentOpenKey(file, filePath = null) {
  const docId = resolveDocumentId(file);
  if (docId) return JSON.stringify(['document', docId]);
  if (filePath) return JSON.stringify(['path', filePath]);
  if (file?._surveyPdfId) return JSON.stringify(['local', file._surveyPdfId]);
  const projectId = resolveProjectId(file);
  return JSON.stringify(['file', projectId, file?.name, file?.size, file?.lastModified ?? null]);
}

function resolveTabDocumentId(tab) {
  const fileId = resolveDocumentId(tab?.file);
  if (fileId) return fileId;
  const tabDocId = tab?.documentId ?? tab?.document_id ?? null;
  return tabDocId != null && String(tabDocId) !== '' ? String(tabDocId) : null;
}

export function isSameDocumentTab(tab, file, filePath = null) {
  if (tab?.isHome || !tab?.file || !file) return false;
  const existingId = resolveTabDocumentId(tab);
  const incomingId = resolveDocumentId(file);
  if (existingId || incomingId) {
    return !!existingId && !!incomingId && existingId === incomingId;
  }
  const existingProjectId = resolveProjectId(tab.file) ?? resolveProjectId(tab);
  const incomingProjectId = resolveProjectId(file);
  if (existingProjectId || incomingProjectId) {
    if (existingProjectId !== incomingProjectId) return false;
  }
  if (tab.file === file) return true;
  if (tab.filePath || filePath) {
    return !!tab.filePath && !!filePath && tab.filePath === filePath;
  }
  return getDocumentOpenKey(tab.file) === getDocumentOpenKey(file);
}
