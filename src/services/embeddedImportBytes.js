// The embedded-annotation import needs the original PDF bytes (appearance
// streams for rotated FreeText etc.). A streamed open hands the viewer row
// metadata, not a File, so read the bytes from the loaded pdf.js document
// instead. Throws when neither source exists, so the once-only import marker
// is never written from a byte-less parse; the caller retries next open.
export async function readOriginalPdfBytes(pdfFile, pdfDoc) {
  if (typeof pdfFile?.arrayBuffer === 'function') return pdfFile.arrayBuffer();
  if (typeof pdfDoc?.getData === 'function') {
    const data = await pdfDoc.getData();
    if (data && data.byteLength > 0) return data;
  }
  throw new Error('original PDF bytes unavailable for embedded import');
}
