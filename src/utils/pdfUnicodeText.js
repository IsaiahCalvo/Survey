/**
 * Unicode text for exported PDFs — three jobs, all of which the export used to
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
 *      "Привет" with Helvetica and it throws `WinAnsi cannot encode …` from
 *      inside the text drawer. This module owns the fallback chain: standard-14
 *      first (zero embedded bytes, unchanged output), then, on demand, one
 *      lazily-fetched font per script. Text is split into runs by which font
 *      can actually draw it, and each run is measured and drawn with its own
 *      font. The chain covers Latin-ext / Greek / Cyrillic / Vietnamese, the
 *      survey symbol set (☑ ✓ ✗ ★ ● ■ ⚠ ☐), arrows and circled numbers,
 *      Hebrew, Thai, Arabic, Devanagari and CJK.
 *
 *   3. EMOJI. No PDF viewer supports ANY OpenType colour table (SVG, COLR,
 *      CBDT, sbix), and pdf-lib cannot embed one either, so a colour emoji
 *      font is not an option — Acrobat, Bluebeam and Foxit all rasterise
 *      instead. This module does the same: in a browser (web, the Electron
 *      renderer, both Capacitor webviews — every runtime a real user exports
 *      or prints from) each emoji grapheme is painted with the SYSTEM emoji
 *      font onto an offscreen canvas and embedded as a PNG image XObject, in
 *      colour, deduplicated document-wide. In Node (unit tests, the fidelity
 *      harnesses) there is no canvas, so the committed MONOCHROME Noto Emoji
 *      outlines are used instead and the output stays byte-stable. Either way
 *      the emoji is also written verbatim into /Contents, so search and
 *      copy/paste return the real character.
 *
 * The font files, their licences, their size and what they deliberately do NOT
 * cover are documented in src/assets/fonts/README.md. Their exact coverage is
 * machine-generated into src/assets/fonts/fontCoverage.js.
 */

import { PDFHexString, PDFString } from 'pdf-lib';
import { FONT_COVERAGE_BY_ID } from '../assets/fonts/fontCoverage.js';

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

// The pre-filter that decides whether a font is worth DOWNLOADING for a given
// code point is the font's OWN cmap, generated into fontCoverage.js by
// scripts/build-export-unicode-fonts.mjs. It used to be a hand-written range
// list, and the guesses cost real bytes: the old EMOJI_RANGES claimed the
// arrow and geometric-shape blocks, so a plain "→" triggered a 777 KB emoji
// download that then did not have the glyph and dropped it anyway. Reading the
// real coverage makes a wrong-font fetch impossible by construction.
const coverageRanges = (id) => FONT_COVERAGE_BY_ID.get(id)?.ranges || [];

// Binary search: the lists are sorted, and the longest (the emoji font's) is
// 163 ranges.
const coversCodePoint = (ranges, codePoint) => {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = ranges[mid];
    if (codePoint < range[0]) high = mid - 1;
    else if (codePoint > range[1]) low = mid + 1;
    else return true;
  }
  return false;
};

const makeMayCover = (id) => {
  const ranges = coverageRanges(id);
  return (codePoint) => coversCodePoint(ranges, codePoint);
};

/**
 * The registered fallback fonts, in the order the chain tries them — first
 * match wins, and a tier is only downloaded when a code point actually needs
 * it. Adding a script is one entry here, one entry in the build script's
 * SOURCES, and the font file under src/assets/fonts/.
 *
 * ORDER RATIONALE. Cheap-and-broad first: Noto Sans (250 KB) closes
 * Latin-ext / Greek / Cyrillic / Vietnamese in one file, so those scripts
 * never reach a second fetch. The symbol tiers come next because a punch
 * list's ticks and ballot boxes are core survey vocabulary. The per-script
 * tiers are tiny. CJK is last of the real fonts because it is by far the
 * biggest (3.46 MB), and the monochrome emoji font is last of all — in a
 * browser it is not fetched at all (see the raster path below).
 */
// `assetUrl` is deliberately a literal `new URL(<relative path>, import.meta.url)`:
// Vite rewrites that at build time into the hashed asset it emits (so the font
// ships as a static file the browser fetches on demand, never as part of a JS
// chunk), and Node leaves it as the file:// URL of the committed .ttf, which is
// what the unit tests and the fidelity harnesses read. One expression, both
// runtimes, no bundler-only import syntax anywhere in the module graph.
export const UNICODE_FALLBACK_FONTS = [
  {
    id: 'latin',
    label: 'Noto Sans',
    file: 'NotoSans-Regular.ttf',
    mayCover: makeMayCover('latin'),
    assetUrl: () => new URL('../assets/fonts/NotoSans-Regular.ttf', import.meta.url),
  },
  {
    id: 'symbols2',
    label: 'Noto Sans Symbols 2',
    file: 'NotoSansSymbols2-Regular.ttf',
    mayCover: makeMayCover('symbols2'),
    assetUrl: () => new URL('../assets/fonts/NotoSansSymbols2-Regular.ttf', import.meta.url),
  },
  {
    id: 'symbols',
    label: 'Noto Sans Symbols',
    file: 'NotoSansSymbols-Regular.ttf',
    mayCover: makeMayCover('symbols'),
    assetUrl: () => new URL('../assets/fonts/NotoSansSymbols-Regular.ttf', import.meta.url),
  },
  {
    id: 'hebrew',
    label: 'Noto Sans Hebrew',
    file: 'NotoSansHebrew-Regular.ttf',
    needsShaping: true,
    mayCover: makeMayCover('hebrew'),
    assetUrl: () => new URL('../assets/fonts/NotoSansHebrew-Regular.ttf', import.meta.url),
  },
  {
    id: 'thai',
    label: 'Noto Sans Thai',
    file: 'NotoSansThai-Regular.ttf',
    needsShaping: true,
    mayCover: makeMayCover('thai'),
    assetUrl: () => new URL('../assets/fonts/NotoSansThai-Regular.ttf', import.meta.url),
  },
  {
    id: 'arabic',
    label: 'Noto Sans Arabic',
    file: 'NotoSansArabic-Regular.ttf',
    needsShaping: true,
    mayCover: makeMayCover('arabic'),
    assetUrl: () => new URL('../assets/fonts/NotoSansArabic-Regular.ttf', import.meta.url),
  },
  {
    id: 'devanagari',
    label: 'Noto Sans Devanagari',
    file: 'NotoSansDevanagari-Regular.ttf',
    needsShaping: true,
    mayCover: makeMayCover('devanagari'),
    assetUrl: () => new URL('../assets/fonts/NotoSansDevanagari-Regular.ttf', import.meta.url),
  },
  {
    id: 'cjk',
    label: 'Droid Sans Fallback',
    file: 'DroidSansFallback.ttf',
    mayCover: makeMayCover('cjk'),
    assetUrl: () => new URL('../assets/fonts/DroidSansFallback.ttf', import.meta.url),
  },
  {
    id: 'emoji',
    label: 'Noto Emoji',
    file: 'NotoEmoji-Regular.ttf',
    // The monochrome outlines are the LAST RESORT, used only where the colour
    // rasteriser cannot run (Node harnesses, a webview with no canvas). They
    // are demonstrably worse than the raster: fontkit shaping splits 👷🏽‍♀️
    // into four unrelated glyphs and 🇯🇵 into two regional-indicator letters.
    lastResortEmoji: true,
    mayCover: makeMayCover('emoji'),
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

// @pdf-lib/fontkit@1.1.1 is a stale, partially-transpiled build: its Indic
// syllable state machine (StateMachine.match → setupSyllables) is compiled to
// regenerator generators but the runtime was never bundled, so the FIRST
// Devanagari layout call throws `regeneratorRuntime is not defined` — which
// would take the whole export down rather than degrade one glyph. The runtime
// is a one-line, side-effect-only import that defines the global, loaded lazily
// alongside fontkit so nothing pays for it until a shaped font is embedded.
// NOTE the explicit `.js`: regenerator-runtime declares no `exports` map, so a
// bare `regenerator-runtime/runtime` does not resolve under Node's ESM loader.
let shapingRuntimePromise = null;
const loadShapingRuntime = () => {
  if (!shapingRuntimePromise) {
    shapingRuntimePromise = import('regenerator-runtime/runtime.js').catch((error) => {
      console.warn('regenerator-runtime could not be loaded; Indic shaping will fail:', error);
      return null;
    });
  }
  return shapingRuntimePromise;
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

/**
 * OPT-IN MIRROR. Delivery is BUNDLED by default and that is the right default
 * for this product: Electron production loads via `loadFile` → `file://` and
 * must work offline, both Capacitor runtimes ship a fixed webview bundle, and
 * the enterprise M365/SharePoint buyers this app targets routinely block
 * outbound CDN egress — a font fetch that silently fails and drops glyphs from
 * a signed survey document is the worst available failure mode.
 *
 * A team that would rather not grow the installer can set
 * VITE_UNICODE_FONT_BASE_URL to a mirror. It is tried FIRST, the bundled asset
 * remains the fallback, and its bytes are only trusted when their SHA-256
 * matches the generated manifest — so a mirror can never substitute a
 * different font.
 */
const mirrorBaseUrl = () => {
  try {
    const value = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_UNICODE_FONT_BASE_URL : undefined;
    return typeof value === 'string' && value ? `${value.replace(/\/+$/, '')}/` : null;
  } catch {
    return null;
  }
};

const sha256Hex = async (bytes) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const readFontBytesFromMirror = async (descriptor) => {
  const base = mirrorBaseUrl();
  const expected = FONT_COVERAGE_BY_ID.get(descriptor.id)?.sha256;
  if (!base || !expected) return null;
  const response = await fetch(`${base}${descriptor.file}`);
  if (!response.ok) throw new Error(`mirror ${descriptor.file} → HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await sha256Hex(bytes);
  if (digest && digest !== expected) {
    throw new Error(`mirror ${descriptor.file} sha256 ${digest} does not match the manifest`);
  }
  return bytes;
};

const readFontBytes = async (descriptor) => {
  const fromMirror = await readFontBytesFromMirror(descriptor).catch((error) => {
    console.warn(`Unicode font mirror rejected for "${descriptor.label}"; using the bundled asset:`, error);
    return null;
  });
  if (fromMirror) return fromMirror;
  const url = descriptor.assetUrl();
  const fromDisk = await readFontBytesFromDisk(url).catch(() => null);
  return fromDisk || readFontBytesFromNetwork(url, descriptor.file);
};

const loadFallbackFont = (descriptor) => {
  if (!fontBytesCache.has(descriptor.id)) {
    fontBytesCache.set(descriptor.id, (async () => {
      const [bytes, fontkit] = await Promise.all([
        readFontBytes(descriptor),
        loadFontkit(),
        // A shaped script must never be the call that discovers the runtime is
        // missing — by then fontkit is already inside the state machine.
        descriptor.needsShaping ? loadShapingRuntime() : null,
      ]);
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

// ---------------------------------------------------------------------------
// 3. Emoji: grapheme clusters, and the colour raster
// ---------------------------------------------------------------------------

// Grapheme-cluster segmentation lives in textGraphemes.js so the Canvas2D
// annotation painter (and its Web Worker) can share ONE splitter without
// pulling pdf-lib in with it. Re-exported here because this module's public
// surface has always carried it.
export { segmentGraphemes } from './textGraphemes.js';
import { segmentGraphemes } from './textGraphemes.js';

// U+FE0F asks for the colour/emoji presentation, U+FE0E asks for the plain
// text one. Everything else falls back to the character's OWN default, which
// is what `Emoji_Presentation` means — and that is exactly the line this app
// wants: 🙂 👷 🇯🇵 are default-emoji and get rasterised in colour, while
// ⚠ ☑ ✓ ✗ ★ ● ■ are default-TEXT and stay real, searchable, scalable vector
// glyphs drawn from Noto Sans Symbols 2. A user who types ⚠️ with the
// variation selector asked for the emoji and gets it.
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;

export function isEmojiGrapheme(grapheme) {
  const value = String(grapheme ?? '');
  if (!value) return false;
  if (value.includes('︎')) return false;
  if (value.includes('️')) return true;
  try { return EMOJI_PRESENTATION.test(value); } catch { return false; }
}

// ~300 dpi at the point size the emoji is drawn, clamped so a 6pt note does
// not embed a postage stamp and a 72pt one does not embed a poster.
export const emojiRasterPixels = (fontSize) => (
  Math.max(48, Math.min(128, Math.round((Number(fontSize) || 12) * 4)))
);

// An emoji occupies one em. Advancing by exactly the em keeps wrapping,
// alignment and the /AP /BBox agreeing with what is painted.
export const EMOJI_ADVANCE_EM = 1;

// How far the one-em raster square hangs BELOW the baseline, as a fraction of
// the drawn size. A colour emoji is optically centred on the x-height band
// rather than sitting on the baseline like a letter, so a square placed with
// its bottom exactly on the baseline reads as floating. An eighth of the em is
// what the platform emoji faces themselves use, and it puts the square's
// vertical centre near the middle of a lowercase run.
export const EMOJI_BASELINE_DROP_EM = 0.125;

const createRasterCanvas = (size) => {
  try {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(size, size);
  } catch { /* fall through to the DOM canvas */ }
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      return canvas;
    }
  } catch { /* no canvas in this runtime */ }
  return null;
};

const canvasToPngBytes = async (canvas) => {
  if (typeof canvas.convertToBlob === 'function') {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof canvas.toDataURL === 'function') {
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  return null;
};

// The project's single-name font rule is about Fabric Textbox metrics and PDF
// /DA names; this is neither. It is a CANVAS font string, the three platform
// emoji faces genuinely have different names, and a stack is the only way to
// say "whatever this machine's colour emoji font is".
const EMOJI_CANVAS_FONT_STACK = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

/**
 * Paint one emoji grapheme with the system emoji font and return PNG bytes.
 * Null when this runtime has no canvas (Node) or the paint produced nothing.
 */
export async function rasterizeEmojiGrapheme(grapheme, pixels) {
  const canvas = createRasterCanvas(pixels);
  if (!canvas) return null;
  let context = null;
  try { context = canvas.getContext('2d'); } catch { context = null; }
  if (!context) return null;
  try {
    context.clearRect(0, 0, pixels, pixels);
    // 0.86 em keeps the tallest emoji (and a flag's full-width box) inside the
    // square instead of clipping its top.
    context.font = `${Math.round(pixels * 0.86)}px ${EMOJI_CANVAS_FONT_STACK}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(grapheme, pixels / 2, pixels / 2);
  } catch {
    return null;
  }
  return canvasToPngBytes(canvas).catch(() => null);
}

const emojiStoresByDoc = new WeakMap(); // PDFDocument -> Map<`${cluster}@${px}`, PDFImage|null>

/**
 * Rasterise and embed every emoji grapheme this export will draw.
 *
 * Returns a lookup, or null when this runtime cannot rasterise at all (Node) —
 * which is the signal for the caller to embed the monochrome emoji font
 * instead. Every (grapheme, pixel size) pair is embedded ONCE per document and
 * every later use reuses that one image XObject.
 */
export async function embedEmojiRasters(pdfDoc, { samples = [] } = {}) {
  if (!pdfDoc) return null;
  if (!createRasterCanvas(8)) return null;
  let store = emojiStoresByDoc.get(pdfDoc);
  if (!store) {
    store = new Map();
    emojiStoresByDoc.set(pdfDoc, store);
  }
  const wanted = new Map(); // key -> { grapheme, pixels }
  for (const sample of samples) {
    const text = typeof sample === 'string' ? sample : String(sample?.text ?? '');
    const pixels = emojiRasterPixels(typeof sample === 'string' ? 12 : sample?.fontSize);
    for (const grapheme of segmentGraphemes(text)) {
      if (!isEmojiGrapheme(grapheme)) continue;
      const key = `${grapheme}@${pixels}`;
      if (!store.has(key) && !wanted.has(key)) wanted.set(key, { grapheme, pixels });
    }
  }
  for (const [key, { grapheme, pixels }] of wanted) {
    let image = null;
    try {
      const png = await rasterizeEmojiGrapheme(grapheme, pixels);
      if (png) image = await pdfDoc.embedPng(png);
    } catch (error) {
      console.warn('Emoji could not be rasterised; falling back to the monochrome font:', grapheme, error);
      image = null;
    }
    store.set(key, image);
  }
  // Did EVERY emoji this export needs actually rasterise? If even one did not,
  // the caller embeds the monochrome font after all — otherwise that grapheme
  // would be dropped entirely, because the run splitter's fall-through has no
  // font to fall through TO.
  const complete = [...store.values()].every(Boolean);
  // An export with no emoji at all still reports "the rasteriser is here", so
  // the 777 KB monochrome font is never fetched in a browser.
  return {
    complete,
    // The exact raster for this size when the pre-pass saw this size — and
    // otherwise the biggest one this grapheme has. The pre-pass reads the size
    // off the annotation, and a draw can still happen at a size it did not
    // see: an AcroForm field autosizes its text to the widget height, a
    // callout can carry its font size somewhere collectDrawnTextSamples does
    // not reach. Reusing a raster at a slightly different resolution is
    // invisible; DROPPING the emoji (which is what a strict miss would do,
    // because the monochrome font is deliberately not embedded when a
    // rasteriser exists) is not.
    lookup: (grapheme, fontSize) => {
      const exact = store.get(`${grapheme}@${emojiRasterPixels(fontSize)}`);
      if (exact) return exact;
      let best = null;
      let bestPixels = 0;
      for (const [key, image] of store) {
        if (!image) continue;
        const at = key.lastIndexOf('@');
        if (at < 0 || key.slice(0, at) !== grapheme) continue;
        const pixels = Number(key.slice(at + 1));
        if (pixels > bestPixels) { best = image; bestPixels = pixels; }
      }
      return best;
    },
    size: store.size,
  };
}

// ---------------------------------------------------------------------------
// 4. Embedding, run splitting, measuring
// ---------------------------------------------------------------------------

const sampleText = (sample) => (typeof sample === 'string' ? sample : String(sample?.text ?? ''));

/**
 * Embed whatever fallback fonts the given texts actually need into `pdfDoc`.
 *
 * `probeFont` is the standard font the text would normally be drawn with — a
 * code point it can encode never triggers a download. `hasEmojiRaster` says the
 * caller already holds colour rasters for the emoji graphemes, which retires
 * the monochrome emoji tier entirely. Returns the embedded records in chain
 * order; an empty array means every character was WinAnsi and the export is
 * exactly what it always was.
 */
export async function embedUnicodeFallbackFonts(pdfDoc, {
  texts = [],
  probeFont = null,
  hasEmojiRaster = false,
} = {}) {
  if (!pdfDoc) return [];
  const unencodable = new Set();
  for (const sample of texts) {
    const text = sampleText(sample);
    // An emoji grapheme the rasteriser will paint must not drag the monochrome
    // font in behind it.
    const units = hasEmojiRaster ? segmentGraphemes(text) : [text];
    for (const unit of units) {
      if (hasEmojiRaster && isEmojiGrapheme(unit)) continue;
      for (const character of unit) {
        const codePoint = character.codePointAt(0);
        if (isFormatCodePoint(codePoint)) continue;
        if (probeFont && fontCoversCodePoint(probeFont, codePoint)) continue;
        if (!probeFont && codePoint < 0x80) continue;
        unencodable.add(codePoint);
      }
    }
  }
  if (unencodable.size === 0) return [];

  const wanted = UNICODE_FALLBACK_FONTS.filter((descriptor) => (
    !(hasEmojiRaster && descriptor.lastResortEmoji)
    && [...unencodable].some((codePoint) => descriptor.mayCover(codePoint))
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
 * Split `text` into the longest possible runs a single font can draw, with
 * emoji graphemes carved out as their own IMAGE runs when the caller has
 * rasters for them.
 *
 * The primary font wins wherever it can encode the character, so an all-Latin
 * line comes back as one run drawn with the standard font exactly as before.
 * A character no font in the chain covers is dropped from the drawn run (it
 * still ships verbatim in /Contents) and reported in `dropped`.
 *
 * A run is either
 *   { text, font }                  — glyphs, drawn with `font`
 *   { text, font, emojiImage, … }   — one colour emoji, drawn as an image
 */
export function buildTextFontRuns(text, primaryFont, fallbacks = [], options = {}) {
  const source = String(text ?? '');
  const runs = [];
  const dropped = [];
  if (!source || !primaryFont) return { runs, dropped };
  const emojiStore = options.emojiStore || null;
  const fontSize = Number(options.fontSize) || 12;
  let current = null;
  const pushCharacter = (character, font) => {
    if (current && current.font === font && !current.emojiImage) current.text += character;
    else {
      current = { text: character, font };
      runs.push(current);
    }
  };
  // Only pay for grapheme segmentation when there is a raster store to use it.
  const units = emojiStore ? segmentGraphemes(source) : source;
  for (const unit of units) {
    if (emojiStore && isEmojiGrapheme(unit)) {
      const image = emojiStore.lookup(unit, fontSize);
      if (image) {
        current = {
          text: unit,
          font: primaryFont,
          emojiImage: image,
          emojiAdvanceEm: EMOJI_ADVANCE_EM,
        };
        runs.push(current);
        continue;
      }
      // No raster for this grapheme (the canvas refused it): fall through and
      // let the ordinary chain try the monochrome outlines code point by code
      // point, which still beats dropping it.
    }
    for (const character of unit) {
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
      pushCharacter(character, font);
    }
  }
  return { runs, dropped };
}

/** Width of a run list at a size, with each run measured in its own font. */
export function widthOfTextRunsAtSize(runs, size) {
  let width = 0;
  for (const run of runs) {
    if (run.emojiImage) {
      width += (run.emojiAdvanceEm || EMOJI_ADVANCE_EM) * size;
      continue;
    }
    try { width += run.font.widthOfTextAtSize(run.text, size); } catch { /* unmeasurable run */ }
  }
  return width;
}

/**
 * Every string in an export that will be DRAWN as glyphs, with the size it is
 * drawn at, so the caller knows which fallback fonts to embed and at what
 * resolution to rasterise emoji before any drawing starts (embedding is async,
 * drawing is not).
 *
 * Returns `{ text, fontSize }` entries. `embedUnicodeFallbackFonts` and
 * `embedEmojiRasters` both accept either these or bare strings.
 */
export function collectDrawnTextSamples(items) {
  const samples = [];
  const take = (holder) => {
    if (!holder || typeof holder !== 'object') return;
    const fontSize = Number(holder.fontSize) || undefined;
    if (typeof holder.text === 'string' && holder.text) samples.push({ text: holder.text, fontSize });
    if (typeof holder.noteText === 'string' && holder.noteText) samples.push({ text: holder.noteText, fontSize });
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
