// Repair PDF: ways to save a damaged file, tried in order.
//   1. qpdf rewrites the whole file. It fixes mild damage (bad stream lengths,
//      a missing end marker) with warnings. Its own index (xref) rebuild needs
//      C++ exceptions, which this wasm build can't catch, so a broken xref
//      fails here and falls through.
//   2. pdf-lib, which ignores the xref and reads the objects one by one,
//      saves the whole document again: bookmarks, forms and links stay.
//   3. pdf-lib copies each page that still opens into a new file, skipping
//      the ones that don't.
//   4. A picture of each page (drawn by pdf.js, which forgives a lot) goes into
//      a new file. Looks the same, but text is no longer text.
// No DOM here: the qpdf runner and the page drawer are passed in, so Node
// tests can run all of it.
import { PDFDocument } from 'pdf-lib';
import { ToolError } from './errors.js';

const HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

// Where "%PDF-" starts, or -1. Junk in front of it (an email header, a
// download that got a few stray bytes) stops many readers from opening it.
export function findHeader(bytes, limit = 1024 * 1024) {
  const end = Math.min(bytes.length - HEADER.length, limit);
  for (let i = bytes.indexOf(HEADER[0]); i !== -1 && i <= end; i = bytes.indexOf(HEADER[0], i + 1)) {
    let k = 1;
    while (k < HEADER.length && bytes[i + k] === HEADER[k]) k += 1;
    if (k === HEADER.length) return i;
  }
  return -1;
}

const loadLoose = (bytes) => PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });

async function countPages(bytes) {
  try {
    return (await loadLoose(bytes)).getPageCount();
  } catch {
    return 0;
  }
}

async function byQpdf(run, bytes) {
  let r;
  try {
    r = await run(bytes, []);
  } catch {
    return null;
  }
  if (!r?.out) return null;
  const pages = await countPages(r.out);
  return pages ? { bytes: r.out, pages, how: r.code === 0 ? 'clean' : 'qpdf' } : null;
}

async function byRebuild(bytes) {
  try {
    const doc = await loadLoose(bytes);
    const out = await doc.save({ useObjectStreams: true });
    // The saved file must read back with every page, or the page copy does better.
    const pages = await countPages(out);
    return pages && pages === doc.getPageCount() ? { bytes: out, pages, how: 'rebuild' } : null;
  } catch {
    return null;
  }
}

export async function copyReadablePages(bytes, progress) {
  let src;
  let total;
  try {
    src = await loadLoose(bytes);
    total = src.getPageCount();
  } catch {
    return null;
  }
  const out = await PDFDocument.create();
  let pages = 0;
  // One page at a time, so a single broken page doesn't sink the rest.
  for (let i = 0; i < total; i += 1) {
    progress?.(`Page ${i + 1} of ${total}`);
    try {
      const [page] = await out.copyPages(src, [i]);
      out.addPage(page);
      pages += 1;
    } catch { /* this page can't be read; leave it out */ }
  }
  if (!pages) return null;
  return { bytes: await out.save({ useObjectStreams: true }), pages, how: 'copy' };
}

// draw(bytes, onPage) -> [{ bytes, type: 'jpg' | 'png', width, height }] with
// width and height in points (1/72 inch).
async function byImages(draw, bytes, progress) {
  let images;
  try {
    images = await draw(bytes, (i, n) => progress?.(`Drawing page ${i + 1} of ${n}`));
  } catch (err) {
    if (err instanceof ToolError) throw err;
    return null;
  }
  if (!images?.length) return null;
  const out = await PDFDocument.create();
  for (let i = 0; i < images.length; i += 1) {
    const im = images[i];
    progress?.(`Adding page ${i + 1} of ${images.length}`);
    const pic = im.type === 'png' ? await out.embedPng(im.bytes) : await out.embedJpg(im.bytes);
    out.addPage([im.width, im.height]).drawImage(pic, { x: 0, y: 0, width: im.width, height: im.height });
    images[i] = null;
  }
  return { bytes: await out.save({ useObjectStreams: true }), pages: images.length, how: 'images' };
}

// mode: 'auto' tries the steps above in order; 'images' goes straight to
// pictures. expected: the page count another reader (pdf.js) saw, if any, so
// a fix that drops pages isn't taken while a better one may exist.
export async function repairPdf(bytes, { run, draw, mode = 'auto', expected = 0, progress } = {}) {
  const start = findHeader(bytes);
  if (start === -1) throw new ToolError('This file doesn\'t look like a PDF at all, so there is nothing to repair.');
  const input = start > 0 ? bytes.subarray(start) : bytes;
  const tries = [];
  const good = (r) => r && (!expected || r.pages >= expected);
  if (mode !== 'images') {
    progress?.('Rebuilding the file');
    const q = run ? await byQpdf(run, input) : null;
    if (q && start > 0) q.how = 'qpdf';
    if (good(q)) return finish(q, expected, start);
    progress?.('Reading what is left of the file');
    const b = await byRebuild(input);
    if (good(b)) return finish(b, expected, start);
    progress?.('Copying the pages that can be read');
    const c = await copyReadablePages(input, progress);
    if (good(c)) return finish(c, expected, start);
    tries.push(q, b, c);
  }
  if (draw) {
    progress?.('Drawing each page');
    tries.push(await byImages(draw, input, progress));
  }
  // Nothing saved every page: keep whichever saved the most.
  const best = tries.filter(Boolean).sort((a, b) => b.pages - a.pages)[0];
  if (!best) throw new ToolError('This PDF is too damaged to repair. None of its pages could be read.');
  return finish(best, expected, start);
}

function finish(r, expected, start) {
  let saved;
  if (expected && r.pages < expected) saved = `${r.pages} of ${expected} pages could be saved.`;
  else saved = r.pages === 1 ? 'The page was saved.' : `All ${r.pages} pages were saved.`;
  const junk = start > 0 ? ' Stray data in front of the PDF was removed.' : '';
  const note = {
    clean: 'We found no damage in this file. Here is a freshly rebuilt copy.',
    qpdf: `Fixed. ${saved}${junk}`,
    rebuild: `Fixed. The file was rebuilt from the parts that could be read. ${saved}${junk}`,
    copy: `Fixed by copying the pages that could still be read into a new file. ${saved}${junk}`,
    images: `Rebuilt from pictures of each page. ${saved} They look the same, but text can't be selected or searched any more.`,
  }[r.how];
  return { bytes: r.bytes, pages: r.pages, how: r.how, note };
}
