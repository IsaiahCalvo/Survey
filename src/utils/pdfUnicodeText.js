/**
 * Unicode text for exported PDFs — two jobs, both of which the export used to
 * get wrong:
 *
 *   1. STRINGS. A PDF text string (`/Contents`, `/T`, `/Subj`, `/RC`, and the
 *      app's own JSON metadata blobs) is either a literal string in
 *      PDFDocEncoding or a hex string in UTF-16BE with a leading BOM
 *      (PDF 32000-1 §7.9.2.2). pdf-lib's `PDFString.of()` writes the JS string
 *      RAW — one byte per UTF-16 code unit, truncated to 8 bits, with no
 *      escaping. So an em dash (U+2014) landed in the file as 0x14, curly
 *      quotes as 0x1C/0x1D, CJK and emoji as arbitrary garbage, and a text box
 *      containing an unbalanced "(" could corrupt the object outright.
 *      `pdfTextString()` keeps the cheap literal form for plain ASCII and
 *      switches to `PDFHexString.fromText()` (UTF-16BE + BOM) for everything
 *      else, so readers show and copy exactly what the user typed.
 *
 *   2. GLYPHS. The standard-14 fonts are WinAnsi — ask pdf-lib to draw "屋" or
 *      "🙂" with Helvetica and it throws `WinAnsi cannot encode …` from inside
 *      the text drawer. The print flattener fenced that throw by SKIPPING the
 *      whole annotation, so a note with one emoji simply vanished from the
 *      printed sheet (and its /AP never got built, so the exported /FreeText
 *      had no appearance either). This module owns a small fallback chain:
 *      standard-14 first (zero embedded bytes, unchanged output), then a
 *      lazily-fetched CJK font, then a lazily-fetched monochrome emoji font.
 *      Text is split into runs by which font can actually draw it, and each
 *      run is measured and drawn with its own font.
 *
 * The font files, their licences, their size and what they deliberately do NOT
 * cover are documented in src/assets/fonts/README.md.
 */

import { PDFHexString, PDFString } from 'pdf-lib';

// ---------------------------------------------------------------------------
// 1. PDF text strings
// ---------------------------------------------------------------------------

// A literal string is only safe for characters that mean the same thing in
// PDFDocEncoding as in ASCII AND need no escaping. "(", ")" and "\" are
// excluded because pdf-lib does not escape them; CR is excluded because a raw
// CR inside a literal string is normalised to LF by conforming readers and so
// would not round-trip.
const isPdfLiteralSafeCharCode = (code) => (
  code === 0x09 || code === 0x0a || (code >= 0x20 && code <= 0x7e
    && code !== 0x28 /* ( */ && code !== 0x29 /* ) */ && code !== 0x5c /* \ */)
);

/**
 * Does this string need the UTF-16BE hex form to survive a round trip?
 */
export function needsUtf16PdfString(value) {
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    if (!isPdfLiteralSafeCharCode(text.charCodeAt(index))) return true;
  }
  return false;
}

/**
 * Build the right pdf-lib string object for a PDF *text string*.
 *
 * Plain ASCII keeps the literal form — that is what every existing exported
 * file uses and it stays byte-identical. Anything else becomes a hex string
 * holding UTF-16BE with a BOM, which pdf-lib's own `decodeText()` (and every
 * conforming reader) decodes back exactly.
 */
export function pdfTextString(value) {
  const text = String(value ?? '');
  return needsUtf16PdfString(text) ? PDFHexString.fromText(text) : PDFString.of(text);
}

// ---------------------------------------------------------------------------
// 2. The glyph fallback chain
// ---------------------------------------------------------------------------

const inRange = (codePoint, ranges) => ranges.some(([low, high]) => codePoint >= low && codePoint <= high);

// Cheap pre-filter only: it decides whether a font is worth DOWNLOADING for a
// given code point. The real answer always comes from the font's own cmap
// (`hasGlyphForCodePoint`) once the bytes are here, so a too-generous range
// costs a wasted fetch and a too-narrow one costs a missing glyph.
const CJK_RANGES = [
  [0x1100, 0x11ff], // Hangul Jamo
  [0x2e80, 0x2fdf], // CJK radicals / Kangxi
  [0x3000, 0x303f], // CJK symbols and punctuation
  [0x3040, 0x30ff], // Hiragana + Katakana
  [0x3100, 0x312f], // Bopomofo
  [0x3130, 0x318f], // Hangul compatibility Jamo
  [0x31c0, 0x31ef], // CJK strokes
  [0x3200, 0x33ff], // Enclosed CJK letters, CJK compatibility
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7af], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe4f], // CJK compatibility forms
  [0xff00, 0xffef], // Halfwidth and fullwidth forms
  [0x20000, 0x2ffff], // CJK Unified Ideographs Extensions B+
];

const EMOJI_RANGES = [
  [0x200d, 0x200d], // zero-width joiner
  [0x2190, 0x21ff], // arrows
  [0x2300, 0x23ff], // misc technical (⌚, ⏰ …)
  [0x25a0, 0x27bf], // geometric shapes, misc symbols, dingbats
  [0x2900, 0x297f], // supplemental arrows
  [0x2b00, 0x2bff], // misc symbols and arrows
  [0xfe00, 0xfe0f], // variation selectors
  [0x1f000, 0x1faff], // the emoji planes
];

/**
 * The registered fallback fonts, in the order the chain tries them. Adding a
 * script is one entry here plus the font file under src/assets/fonts/.
 */
// `assetUrl` is deliberately a literal `new URL(<relative path>, import.meta.url)`:
// Vite rewrites that at build time into the hashed asset it emits (so the font
// ships as a static file the browser fetches on demand, never as part of a JS
// chunk), and Node leaves it as the file:// URL of the committed .ttf, which is
// what the unit tests and the fidelity harnesses read. One expression, both
// runtimes, no bundler-only import syntax anywhere in the module graph.
export const UNICODE_FALLBACK_FONTS = [
  {
    id: 'cjk',
    label: 'Droid Sans Fallback',
    file: 'DroidSansFallback.ttf',
    mayCover: (codePoint) => inRange(codePoint, CJK_RANGES),
    assetUrl: () => new URL('../assets/fonts/DroidSansFallback.ttf', import.meta.url),
  },
  {
    id: 'emoji',
    label: 'Noto Emoji',
    file: 'NotoEmoji-Regular.ttf',
    mayCover: (codePoint) => inRange(codePoint, EMOJI_RANGES),
    assetUrl: () => new URL('../assets/fonts/NotoEmoji-Regular.ttf', import.meta.url),
  },
];

// Zero-width formatting characters. They carry no glyph of their own, so a
// font that lacks them must not force a run split — they are simply dropped
// from the drawn run (the true text still ships in /Contents).
const FORMAT_CODE_POINTS = new Set([0x200b, 0x200c, 0x200d, 0xfeff]);
const isFormatCodePoint = (codePoint) => (
  FORMAT_CODE_POINTS.has(codePoint) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
);

// Deliberately NOT a `typeof window` check: the export tests run in Node with a
// stub `window` in place, and an Electron renderer with contextIsolation has no
// `process` at all. `process.versions.node` is the honest signal, and the disk
// read is still guarded so any surprise falls through to the asset fetch.
const isNodeRuntime = () => typeof process !== 'undefined' && !!process.versions?.node;

const fontBytesCache = new Map(); // id -> Promise<{ bytes, kit } | null>
const embeddedFontsByDoc = new WeakMap(); // PDFDocument -> Map<id, PDFFont|null>
const encodableCache = new WeakMap(); // PDFFont -> Map<codePoint, boolean>

let fontkitModulePromise = null;
const loadFontkit = () => {
  if (!fontkitModulePromise) {
    fontkitModulePromise = import('@pdf-lib/fontkit').then((module) => module?.default || module);
  }
  return fontkitModulePromise;
};

// Node (unit tests, the fidelity harnesses, any CLI): read the committed font
// straight off disk. The `node:fs/promises` specifier is assembled at runtime so
// no bundler ever tries to resolve it for the browser.
const readFontBytesFromDisk = async (url) => {
  if (!isNodeRuntime() || url.protocol !== 'file:') return null;
  const specifier = 'node:fs/promises';
  const { readFile } = await import(/* @vite-ignore */ specifier);
  return new Uint8Array(await readFile(url));
};

// Browser, Electron (file://, verified: an Electron renderer with
// webSecurity ON and loadFile() can fetch a file:// asset) and Capacitor.
const readFontBytesFromNetwork = async (url, label) => {
  const response = await fetch(url.href);
  if (!response.ok) throw new Error(`font asset ${label} → HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

const readFontBytes = async (descriptor) => {
  const url = descriptor.assetUrl();
  const fromDisk = await readFontBytesFromDisk(url).catch(() => null);
  return fromDisk || readFontBytesFromNetwork(url, descriptor.file);
};

const loadFallbackFont = (descriptor) => {
  if (!fontBytesCache.has(descriptor.id)) {
    fontBytesCache.set(descriptor.id, (async () => {
      const [bytes, fontkit] = await Promise.all([readFontBytes(descriptor), loadFontkit()]);
      return { bytes, kit: fontkit.create(bytes), fontkit };
    })().catch((error) => {
      console.warn(`Unicode fallback font "${descriptor.label}" could not be loaded:`, error);
      // Drop the failure from the cache: a font that could not be fetched once
      // (offline, a cold cache mid-flight) must not stay broken for the rest of
      // the session — the next export tries again.
      fontBytesCache.delete(descriptor.id);
      fontkitModulePromise = null;
      return null;
    }));
  }
  return fontBytesCache.get(descriptor.id);
};

/**
 * Can this pdf-lib font actually draw this code point?
 *
 * Standard-14 fonts answer by throwing out of `encodeText` ("WinAnsi cannot
 * encode …"); embedded fallbacks answer from their own cmap. Both are memoised
 * per font because a text box asks the same question for every character.
 */
export function fontCoversCodePoint(fontRecord, codePoint) {
  if (!fontRecord) return false;
  const { pdfFont, kit } = fontRecord.pdfFont ? fontRecord : { pdfFont: fontRecord, kit: null };
  if (!pdfFont) return false;
  if (kit) {
    try { return kit.hasGlyphForCodePoint(codePoint); } catch { return false; }
  }
  let cache = encodableCache.get(pdfFont);
  if (!cache) {
    cache = new Map();
    encodableCache.set(pdfFont, cache);
  }
  if (cache.has(codePoint)) return cache.get(codePoint);
  let covered = false;
  try {
    pdfFont.encodeText(String.fromCodePoint(codePoint));
    covered = true;
  } catch {
    covered = false;
  }
  cache.set(codePoint, covered);
  return covered;
}

/**
 * Embed whatever fallback fonts the given texts actually need into `pdfDoc`.
 *
 * `probeFont` is the standard font the text would normally be drawn with — a
 * code point it can encode never triggers a download. Returns the embedded
 * records in chain order; an empty array means every character was WinAnsi and
 * the export is exactly what it always was.
 */
export async function embedUnicodeFallbackFonts(pdfDoc, { texts = [], probeFont = null } = {}) {
  if (!pdfDoc) return [];
  const unencodable = new Set();
  for (const text of texts) {
    for (const character of String(text ?? '')) {
      const codePoint = character.codePointAt(0);
      if (isFormatCodePoint(codePoint)) continue;
      if (probeFont && fontCoversCodePoint(probeFont, codePoint)) continue;
      if (!probeFont && codePoint < 0x80) continue;
      unencodable.add(codePoint);
    }
  }
  if (unencodable.size === 0) return [];

  const wanted = UNICODE_FALLBACK_FONTS.filter((descriptor) => (
    [...unencodable].some((codePoint) => descriptor.mayCover(codePoint))
  ));
  if (wanted.length === 0) return [];

  let perDoc = embeddedFontsByDoc.get(pdfDoc);
  if (!perDoc) {
    perDoc = new Map();
    embeddedFontsByDoc.set(pdfDoc, perDoc);
  }

  const records = [];
  for (const descriptor of wanted) {
    if (perDoc.has(descriptor.id)) {
      const cached = perDoc.get(descriptor.id);
      if (cached) records.push(cached);
      continue;
    }
    let record = null;
    try {
      const loaded = await loadFallbackFont(descriptor);
      if (loaded) {
        pdfDoc.registerFontkit(loaded.fontkit);
        record = {
          id: descriptor.id,
          label: descriptor.label,
          kit: loaded.kit,
          pdfFont: await pdfDoc.embedFont(loaded.bytes, { subset: true }),
        };
      }
    } catch (error) {
      console.warn(`Unicode fallback font "${descriptor.label}" could not be embedded:`, error);
      record = null;
    }
    perDoc.set(descriptor.id, record);
    if (record) records.push(record);
  }
  return records;
}

/**
 * Split `text` into the longest possible runs that a single font can draw.
 *
 * The primary font wins wherever it can encode the character, so an all-Latin
 * line comes back as one run drawn with the standard font exactly as before.
 * A character no font in the chain covers is dropped from the drawn run (it
 * still ships verbatim in /Contents) and reported in `dropped`.
 */
export function buildTextFontRuns(text, primaryFont, fallbacks = []) {
  const source = String(text ?? '');
  const runs = [];
  const dropped = [];
  if (!source || !primaryFont) return { runs, dropped };
  let current = null;
  for (const character of source) {
    const codePoint = character.codePointAt(0);
    let font = fontCoversCodePoint(primaryFont, codePoint) ? primaryFont : null;
    if (!font) {
      for (const fallback of fallbacks) {
        if (fontCoversCodePoint(fallback, codePoint)) { font = fallback.pdfFont; break; }
      }
    }
    if (!font) {
      // Zero-width formatting characters carry no glyph anywhere; dropping one
      // is not a loss and must not break the run around it.
      if (!isFormatCodePoint(codePoint)) dropped.push(codePoint);
      continue;
    }
    if (current && current.font === font) current.text += character;
    else {
      current = { text: character, font };
      runs.push(current);
    }
  }
  return { runs, dropped };
}

/** Width of a run list at a size, with each run measured in its own font. */
export function widthOfTextRunsAtSize(runs, size) {
  let width = 0;
  for (const run of runs) {
    try { width += run.font.widthOfTextAtSize(run.text, size); } catch { /* unmeasurable run */ }
  }
  return width;
}

/**
 * Every string in an export that will be DRAWN as glyphs, so the caller knows
 * which fallback fonts to embed before any drawing starts (embedding is async,
 * drawing is not).
 */
export function collectDrawnTextSamples(items) {
  const samples = [];
  const take = (holder) => {
    if (!holder || typeof holder !== 'object') return;
    if (typeof holder.text === 'string' && holder.text) samples.push(holder.text);
    if (typeof holder.noteText === 'string' && holder.noteText) samples.push(holder.noteText);
  };
  for (const entry of Array.isArray(items) ? items : []) {
    if (!entry || typeof entry !== 'object') continue;
    // Export plans carry `{ object }` / `{ callout }`; the print payload carries
    // the fabric objects directly. Sticky-note bodies live on `data.noteText`.
    take(entry);
    take(entry.data);
    take(entry.object);
    take(entry.object?.data);
    take(entry.callout);
  }
  return samples;
}
