// OCR PDF, the part with no DOM: where each recognised word goes on the page,
// and drawing the words as invisible text with pdf-lib. The browser side
// (rendering pages, running Tesseract) lives in ocr-browser.js and is passed in
// as `readPage`, so all of this runs and is tested in Node.
import {
  StandardFonts, TextRenderingMode, beginText, endText, popGraphicsState, pushGraphicsState,
  setCharacterSqueeze, setFontAndSize, setTextMatrix, setTextRenderingMode, showText,
} from 'pdf-lib';
import { ToolError, loadPdf } from './ops.js';

const CREATOR = 'Survey free PDF tools (surveytool.app/tools)';

// Helvetica's ascender and descender, as a share of the font size. A line of
// mixed text is about this tall, so it turns a line height into a font size.
const ASCENT = 0.718;
const DESCENT = 0.207;

// Render scale for OCR: about `dpi`, but never more than `maxPixels` in all.
// Tesseract gets slow and phones run out of memory past ~10M pixels.
export function ocrScale(width, height, { dpi = 300, maxPixels = 10_000_000 } = {}) {
  const want = dpi / 72;
  const cap = Math.sqrt(maxPixels / Math.max(1, width * height));
  return Math.min(want, cap);
}

// True when pdf.js text content has real text on it (not just a stray mark),
// so OCR can skip the page.
export function hasRealText(textContent, minChars = 10) {
  let n = 0;
  for (const item of textContent?.items || []) {
    n += String(item?.str || '').replace(/\s/g, '').length;
    if (n >= minChars) return true;
  }
  return false;
}

// The standard fonts only cover Latin-1 (WinAnsi). Keep what the font has,
// try the plain letter for accented ones (NFKD also splits ligatures like ﬁ),
// and put '?' for the rest so pdf-lib never throws.
export function safeText(text, hasChar) {
  let out = '';
  for (const ch of String(text)) {
    if (hasChar(ch.codePointAt(0))) { out += ch; continue; }
    const plain = ch.normalize('NFKD').replace(/\p{M}/gu, '');
    out += plain && [...plain].every((c) => hasChar(c.codePointAt(0))) ? plain : '?';
  }
  return out;
}

// Flatten Tesseract's blocks > paragraphs > lines > words into lines of
// { text, box, baseline?, rowHeight?, descenders? }, boxes as {x0,y0,x1,y1}
// in image pixels.
export function tesseractLines(data) {
  const lines = [];
  for (const block of data?.blocks || []) {
    for (const para of block?.paragraphs || []) {
      for (const line of para?.lines || []) {
        const words = (line?.words || [])
          .filter((w) => w?.text?.trim() && w.bbox)
          .map((w) => ({ text: w.text.trim(), box: w.bbox }));
        if (!words.length) continue;
        lines.push({
          words,
          box: line.bbox,
          baseline: line.baseline,
          rowHeight: line.rowAttributes?.rowHeight,
          descenders: line.rowAttributes?.descenders,
        });
      }
    }
  }
  return lines;
}

// Font size in image pixels for a line: from Tesseract's row metrics when they
// look sane, else from the line box.
function lineSizePx(line) {
  const boxH = line.box ? line.box.y1 - line.box.y0 : 0;
  const rowH = Number(line.rowHeight) + Math.abs(Number(line.descenders) || 0);
  if (rowH > 0 && (!boxH || (rowH > boxH * 0.5 && rowH < boxH * 1.5))) return rowH / (ASCENT + DESCENT);
  return boxH / (ASCENT + DESCENT);
}

// Baseline y (image pixels) at image x, and the baseline's slope.
function baselineAt(line, x, fallbackBottom, sizePx) {
  const b = line.baseline;
  if (b && Number.isFinite(b.x0) && Number.isFinite(b.y0) && Number.isFinite(b.x1) && Number.isFinite(b.y1) && b.x1 > b.x0) {
    const slope = (b.y1 - b.y0) / (b.x1 - b.x0);
    // A wild slope means Tesseract guessed wrong; lie flat instead.
    if (Math.abs(slope) < 0.27) return { y: b.y0 + slope * (x - b.x0), slope };
  }
  return { y: fallbackBottom - DESCENT * sizePx, slope: 0 };
}

// Where a word goes, in the page's visual space (points, origin at the bottom
// left of the page as seen, y up): the left end of its baseline, its angle,
// font size and the width it must span. `image` is the rendered page size in
// pixels; `frame` is pageFrame(page).
export function placeWord(word, line, image, frame) {
  const sx = frame.width / image.width;
  const sy = frame.height / image.height;
  const sizePx = lineSizePx(line) || (word.box.y1 - word.box.y0) / (ASCENT + DESCENT);
  const lineBottom = line.box ? line.box.y1 : word.box.y1;
  const base = baselineAt(line, word.box.x0, lineBottom, sizePx);
  const angle = base.slope ? (-Math.atan2(base.slope * sy, sx) * 180) / Math.PI : 0;
  const lengthPx = word.box.x1 - word.box.x0;
  return {
    x: word.box.x0 * sx,
    y: frame.height - base.y * sy,
    size: sizePx * sy,
    width: Math.hypot(lengthPx * sx, lengthPx * base.slope * sy),
    angle,
  };
}

// Text matrix in page space for a placed word. Visual angles add the page's
// /Rotate, the same way ops.js turns visual drawings onto rotated pages.
export function textMatrix(place, frame) {
  const p = frame.toPage(place.x, place.y);
  const a = ((place.angle + frame.rotation) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const r = (n) => Math.round(n * 1e4) / 1e4;
  return [r(c), r(s), r(-s), r(c), r(p.x), r(p.y)];
}

// Horizontal stretch (percent) so `text` at `size` spans `width` exactly.
export function squeezeFor(font, text, size, width) {
  const natural = font.widthOfTextAtSize(text, size);
  if (!(natural > 0) || !(width > 0)) return 100;
  return Math.min(1000, Math.max(1, (width / natural) * 100));
}

// The page as pdf.js draws it: the crop box clipped to the media box (a crop
// box that spills past the page is common in odd PDFs), turned by /Rotate.
// Same mapping as visualFrame in ops.js, which uses the crop box as is.
export function pageFrame(page) {
  const crop = page.getCropBox();
  const media = page.getMediaBox();
  const x0 = Math.max(crop.x, media.x);
  const y0 = Math.max(crop.y, media.y);
  const x1 = Math.min(crop.x + crop.width, media.x + media.width);
  const y1 = Math.min(crop.y + crop.height, media.y + media.height);
  const box = x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : media;
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const sideways = r === 90 || r === 270;
  const toPage = (vx, vy) => {
    if (r === 90) return { x: box.x + box.width - vy, y: box.y + vx };
    if (r === 180) return { x: box.x + box.width - vx, y: box.y + box.height - vy };
    if (r === 270) return { x: box.x + vy, y: box.y + box.height - vx };
    return { x: box.x + vx, y: box.y + vy };
  };
  return { width: sideways ? box.height : box.width, height: sideways ? box.width : box.height, rotation: r, toPage };
}

// Wrap the page's own content in q/Q so a scan that leaves its graphics state
// changed can't move our text.
function isolateContent(page) {
  const start = page.doc.context.register(page.createContentStream(pushGraphicsState()));
  const end = page.doc.context.register(page.createContentStream(popGraphicsState()));
  page.node.wrapContentStreams(start, end);
}

// Draw OCR lines on a pdf-lib page as invisible text (render mode 3), so the
// page looks exactly the same but its words can be searched and copied.
// Returns how many words were drawn.
export function addTextLayer(page, lines, image, font) {
  const frame = pageFrame(page);
  const charset = new Set(font.getCharacterSet());
  const hasChar = (cp) => charset.has(cp);
  const ops = [];
  let count = 0;
  for (const line of lines) {
    line.words.forEach((word, i) => {
      const text = safeText(word.text, hasChar);
      if (!text.trim()) return;
      const place = placeWord(word, line, image, frame);
      if (!(place.size > 0.5) || !(place.width > 0)) return;
      // A trailing space keeps words apart when the text is copied.
      const shown = i < line.words.length - 1 ? `${text} ` : text;
      ops.push(
        setFontAndSize(fontKey(page, font), place.size),
        setCharacterSqueeze(squeezeFor(font, text, place.size, place.width)),
        setTextMatrix(...textMatrix(place, frame)),
        showText(font.encodeText(shown)),
      );
      count += 1;
    });
  }
  if (!count) return 0;
  isolateContent(page);
  // A stream of its own, after the wrapped content (pushOperators could add to
  // a stream that is already inside the q/Q).
  const layer = page.createContentStream(pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible), ...ops, endText(), popGraphicsState());
  page.node.addContentStream(page.doc.context.register(layer));
  return count;
}

const fontKeys = new WeakMap();
function fontKey(page, font) {
  let byFont = fontKeys.get(page.node);
  if (!byFont) fontKeys.set(page.node, (byFont = new Map()));
  if (!byFont.has(font)) byFont.set(font, page.node.newFontDictionary(font.name, font.ref));
  return byFont.get(font);
}

// Make a scanned PDF searchable. `readPage(index)` renders and reads one page
// and resolves to { image: { width, height }, lines } or null to leave the page
// alone (it already has text). Pages are read one at a time to keep memory low.
export async function ocrPdf(bytes, readPage, progress = () => {}) {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const stats = { pages: pages.length, read: 0, skipped: 0, words: 0 };
  for (let i = 0; i < pages.length; i += 1) {
    progress(i, pages.length);
    const result = await readPage(i);
    if (!result) { stats.skipped += 1; continue; }
    stats.read += 1;
    stats.words += addTextLayer(pages[i], result.lines, result.image, font);
  }
  if (!stats.read) throw new ToolError('Every page already has text you can search, so there was nothing to do.');
  if (!stats.words) throw new ToolError('No words were found. The scan may be blank, too faint or too small to read.');
  doc.setProducer(CREATOR);
  return { bytes: await doc.save({ useObjectStreams: true }), ...stats };
}
