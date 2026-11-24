// A page image for text recognition when the page is not on screen (the
// Survey agent reading a scanned sheet it was asked about). pdf.js draws it
// off screen at up to 3x, kept under maxPixels so a large sheet stays light.
// Recognition itself is the same on-device Tesseract as Text Select, with
// its language data bundled, so it works with no signal.
export async function renderPageForOcr(pdfDoc, pageNumber, { maxPixels = 6_000_000, maxScale = 3 } = {}) {
  const pdfPage = await pdfDoc.getPage(pageNumber);
  const base = pdfPage.getViewport({ scale: 1 });
  const scale = Math.max(1, Math.min(maxScale, Math.sqrt(maxPixels / Math.max(1, base.width * base.height))));
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return { canvas, pageSize: { width: base.width, height: base.height } };
}
