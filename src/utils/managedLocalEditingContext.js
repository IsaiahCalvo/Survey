// Device/profile-local editing is not an authenticated cloud identity. Keep
// this capability separate from users, subscription features and author IDs.
const issued = new WeakMap();
const localIdPattern = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validFile(file) {
  return typeof File === 'function' && file instanceof File && file.id == null
    && file.storageMode === 'local' && typeof file.localId === 'string'
    && localIdPattern.test(file.localId) && file._surveyPdfId === file.localId;
}

export function createManagedLocalEditingContext(file) {
  if (!validFile(file)) return null;
  const context = Object.freeze({ kind: 'managed-local', localId: file.localId });
  issued.set(context, { file, localId: file.localId });
  return context;
}

export function isManagedLocalEditingContext(context) {
  const saved = context && issued.get(context);
  return !!saved && validFile(saved.file) && saved.file.localId === saved.localId;
}
