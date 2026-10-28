// Deleting a document or project purges this device's copy of its marks, but
// Home must not carry the whole mark sync engine (annotationDocSync and the
// geometry it needs) on its first load just for that. The engine is fetched
// when a delete runs. If it was never loaded, no document is open in it, and
// the purge still clears the stored copies it finds on the device.
export async function purgeAnnotationDoc(documentId) {
  if (!documentId) return;
  const sync = await import('./annotationDocSync.js');
  await sync.purgeAnnotationDoc(documentId);
}
