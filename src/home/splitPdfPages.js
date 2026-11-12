// Upload review's "One document per page" (Nightly flag 'upload-review'):
// one page of a picked PDF as its own PDF file. pdf-lib loads only when a
// split upload runs.

const loaded = new WeakMap(); // File -> Promise<PDFDocument>, one parse per file

async function sourceOf(file) {
  if (!loaded.has(file)) {
    loaded.set(file, (async () => {
      const { PDFDocument } = await import('pdf-lib');
      const bytes = new Uint8Array(await file.arrayBuffer());
      return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    })());
  }
  return loaded.get(file);
}

/** Page `page` (1-based) of `file` as a new File called `name`. */
export async function pdfPageFile(file, page, name) {
  const { PDFDocument } = await import('pdf-lib');
  const source = await sourceOf(file);
  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(source, [page - 1]);
  out.addPage(copied);
  const bytes = await out.save({ useObjectStreams: true });
  const next = new File([bytes], name, { type: 'application/pdf', lastModified: file.lastModified || Date.now() });
  if (file.user_id) next.user_id = file.user_id;
  return next;
}
