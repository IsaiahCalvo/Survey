// PDF to PDF/A without a server: every page is redrawn as a picture, and the
// page's words go on top as invisible text so the file can still be searched.
// The result is PDF/A-2b: XMP metadata that says so, an sRGB output intent, a
// file ID, no transparency, forms, scripts or links. Pure pdf-lib, no DOM; the
// browser side (rendering, reading text) lives in defs/pdf-to-pdfa.js.
import {
  PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, TextRenderingMode, beginText, endText,
  popGraphicsState, pushGraphicsState, setCharacterSqueeze, setFontAndSize, setTextMatrix, setTextRenderingMode, showText,
} from 'pdf-lib';
import { addTextLayer, safeText } from './ocr.js';

const CREATOR = 'Survey free PDF tools (surveytool.app/tools)';

// "sRGB-v2-micro.icc" from github.com/saucecontrol/Compact-ICC-Profiles,
// released under CC0 (public domain). 456 bytes, ICC v2, so every PDF/A reader
// takes it.
const SRGB_ICC = 'AAAByGxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5knZEAPUCAsD1AdCyBnqUijgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAABgZ1RSQwAAAWgAAABgYlRSQwAAAWgAAABgZGVzYwAAAAAAAAAFdVJHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAAqAAAAfAD4AZwCdQODBMkGTggSChgMYg70Ec8U9hhqHC4gQySsKWoufjPrObM/1kZXTTZUdlwXZB1shnVWfo2ILJI2nKunjLLbvpnKx9dl5Hfx+f//';

const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

// a after b, both PDF matrices [a b c d e f].
export function mulMatrix(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

// pdf.js text items -> words for the new page. `viewport` is the page's
// pdf.js viewport transform at scale 1 (PDF space to the page as seen, y
// down) and `height` the seen page's height, so the words land where they
// were on a page whose size is the seen page. Each word is { text, m, width }:
// its text matrix at font size 1 and how wide it is in that space.
export function pdfjsWords(items, viewport, height) {
  const toPage = mulMatrix([1, 0, 0, -1, 0, height], viewport);
  const words = [];
  for (const item of items || []) {
    const text = typeof item?.str === 'string' ? item.str : '';
    if (!text.trim() || !Array.isArray(item.transform)) continue;
    const size = Math.hypot(item.transform[0], item.transform[1]);
    if (!(size > 0) || !(item.width > 0)) continue;
    words.push({ text, m: mulMatrix(toPage, item.transform), width: item.width / size, eol: !!item.hasEOL });
  }
  return words;
}

function fontKey(page, font, keys) {
  if (!keys.has(page)) keys.set(page, new Map());
  const names = keys.get(page);
  if (!names.has(font)) names.set(font, page.node.newFontDictionary(font.name, font.ref));
  return names.get(font);
}

// Draw words from pdfjsWords as invisible text (render mode 3).
// fonts: [{ font, has(codePoint) }] in order of choice; each word uses the
// first that has all its letters (else the first), so no letter is drawn
// with the empty glyph 0, which PDF/A forbids.
function addWords(page, words, fonts, keys) {
  const r = (n) => Math.round(n * 1e4) / 1e4;
  const ops = [];
  for (const w of words) {
    const cps = [...w.text].filter((ch) => !/\s/.test(ch)).map((ch) => ch.codePointAt(0));
    const pick = fonts.find((f) => cps.every(f.has)) || fonts[0];
    const { font } = pick;
    const text = safeText(w.text, pick.has);
    const natural = font.widthOfTextAtSize(text, 1);
    if (!(natural > 0)) continue;
    // A space after each piece keeps words apart when the text is copied.
    const shown = /\s$/.test(text) ? text : `${text} `;
    ops.push(
      setFontAndSize(fontKey(page, font, keys), 1),
      setCharacterSqueeze(Math.min(1000, Math.max(1, (w.width / natural) * 100))),
      setTextMatrix(...w.m.map(r)),
      showText(font.encodeText(shown)),
    );
  }
  if (!ops.length) return 0;
  const layer = page.createContentStream(pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible), ...ops, endText(), popGraphicsState());
  page.node.addContentStream(page.doc.context.register(layer));
  return ops.length / 4;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// XMP wants 2026-10-21T08:05:09Z; the info dictionary gets the same second.
const xmpDate = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function pdfaXmp({ title, date, documentId, instanceId }) {
  const when = xmpDate(date);
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">
   <pdfaid:part>2</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(title)}</rdf:li></rdf:Alt></dc:title>
   <xmp:CreatorTool>${xml(CREATOR)}</xmp:CreatorTool>
   <xmp:CreateDate>${when}</xmp:CreateDate>
   <xmp:ModifyDate>${when}</xmp:ModifyDate>
   <xmp:MetadataDate>${when}</xmp:MetadataDate>
   <pdf:Producer>${xml(CREATOR)}</pdf:Producer>
   <xmpMM:DocumentID>uuid:${documentId}</xmpMM:DocumentID>
   <xmpMM:InstanceID>uuid:${instanceId}</xmpMM:InstanceID>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

const uuid = () => {
  const b = hex(randomBytes(16));
  return `${b.slice(0, 8)}-${b.slice(8, 12)}-4${b.slice(13, 16)}-a${b.slice(17, 20)}-${b.slice(20, 32)}`;
};

// Builds the PDF/A one page at a time, so a long set never holds more than
// one page's picture outside the file being made.
// addPage({ jpeg, width, height, words?, ocr? }): width/height in points (the
// page as seen); words from pdfjsWords; ocr is { lines, image } from the OCR
// reader. finish() returns the bytes.
// loadFont(kind) -> font file bytes and loadFontkit() -> fontkit are only used
// when a page has letters Helvetica lacks (Greek, Cyrillic, CJK...), so the
// hidden text keeps the real letters instead of question marks.
export async function startPdfA({ title = 'Document', date = new Date(), loadFont, loadFontkit } = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const latin = new Set(font.getCharacterSet());
  const extra = new Map();
  const embedExtra = async (kind) => {
    if (!extra.has(kind)) {
      extra.set(kind, (async () => {
        doc.registerFontkit(await loadFontkit());
        return doc.embedFont(await loadFont(kind), { subset: true });
      })());
    }
    return extra.get(kind);
  };
  // The fonts one page's words may need: Helvetica, plus Noto Sans (Greek,
  // Cyrillic...) and the CJK fallback when some word has letters Helvetica lacks.
  const withSet = (font) => { const set = new Set(font.getCharacterSet()); return { font, has: (c) => set.has(c) }; };
  const base = withSet(font);
  const fontsFor = async (words) => {
    const missing = words.some((w) => [...w.text].some((ch) => !/\s/.test(ch) && !latin.has(ch.codePointAt(0))));
    if (!missing || !loadFont || !loadFontkit) return [base];
    try {
      return [base, withSet(await embedExtra('noto')), withSet(await embedExtra('cjk'))];
    } catch {
      return [base]; // the fonts didn't load: keep going with what Helvetica can show
    }
  };
  const keys = new Map();
  const stats = { pages: 0, textPages: 0, ocrPages: 0, searchable: 0, words: 0 };
  const when = new Date(Math.floor(date.getTime() / 1000) * 1000);
  return {
    stats,
    async addPage({ jpeg, width, height, words, ocr }) {
      const page = doc.addPage([width, height]);
      const image = await doc.embedJpg(jpeg);
      page.drawImage(image, { x: 0, y: 0, width, height });
      stats.pages += 1;
      let n = words?.length ? addWords(page, words, await fontsFor(words), keys) : 0;
      if (n) stats.textPages += 1;
      if (ocr?.lines?.length) {
        const read = addTextLayer(page, ocr.lines, ocr.image, font);
        if (read) stats.ocrPages += 1;
        n += read;
      }
      stats.words += n;
      if (n) stats.searchable += 1;
    },
    async finish() {
      const { context, catalog } = doc;
      doc.setTitle(title);
      doc.setCreator(CREATOR);
      doc.setProducer(CREATOR);
      doc.setCreationDate(when);
      doc.setModificationDate(when);
      // Not compressed, and UTF-8: PDF/A wants the metadata readable as is.
      const xmp = context.stream(new TextEncoder().encode(pdfaXmp({ title, date: when, documentId: uuid(), instanceId: uuid() })), { Type: 'Metadata', Subtype: 'XML' });
      catalog.set(PDFName.of('Metadata'), context.register(xmp));
      const icc = context.register(context.flateStream(fromBase64(SRGB_ICC), { N: 3 }));
      catalog.set(PDFName.of('OutputIntents'), context.obj([context.obj({
        Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
        Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: icc,
      })]));
      const id = PDFHexString.of(hex(randomBytes(16)));
      context.trailerInfo.ID = context.obj([id, id]);
      return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    },
  };
}
