# Unicode fallback fonts for PDF export

These fonts exist for one job: a text box (or callout, or form field) whose text
the standard PDF fonts cannot encode must still **print** and still **export**
with real glyphs. Before they existed, a note containing an emoji or any CJK
character was dropped from the flattened print entirely (`WinAnsi cannot encode
"屋" (0x5c4b)` thrown out of pdf-lib's text drawer) and exported as a bare
`/FreeText` with no appearance stream.

Rebuild them with `node scripts/build-export-unicode-fonts.mjs` (network +
`fonttools` required; pass font ids to rebuild a subset, or `--coverage-only` to
regenerate `fontCoverage.js` from the committed files without touching the
network). The built `.ttf` files are committed, so a normal checkout never runs
that script.

| file | covers | license | shipped size | shaping |
| --- | --- | --- | --- | --- |
| `NotoSans-Regular.ttf` | Latin Extended A/B, Greek, Cyrillic, Vietnamese, typographic punctuation (— “ ” • € ° ±) | OFL-1.1 | 244 KB | no |
| `NotoSansSymbols2-Regular.ttf` | the survey/punch-list vocabulary — ☑ ✓ ✗ ★ ● ■ ⚠ ☐ — plus box drawing and misc symbols | OFL-1.1 | 627 KB | no |
| `NotoSansSymbols-Regular.ttf` | arrows, ⌀, circled numbers | OFL-1.1 | 130 KB | no |
| `NotoSansHebrew-Regular.ttf` | Hebrew | OFL-1.1 | 14 KB | **yes** |
| `NotoSansThai-Regular.ttf` | Thai | OFL-1.1 | 18 KB | **yes** |
| `NotoSansArabic-Regular.ttf` | Arabic | OFL-1.1 | 122 KB | **yes** |
| `NotoSansDevanagari-Regular.ttf` | Devanagari | OFL-1.1 | 163 KB | **yes** |
| `DroidSansFallback.ttf` | ~33,000 CJK code points — Han (SC/TC/JP), kana, Hangul, CJK punctuation | Apache-2.0 | 3.46 MB | no |
| `NotoEmoji-Regular.ttf` | ~1,489 emoji code points, **monochrome outlines**, last resort only | OFL-1.1 | 778 KB | no |

Each font's licence sits beside it as `<Font>-LICENSE.txt`. `fontCoverage.js` is
**generated** — it holds every font's exact cmap as merged code-point ranges,
plus its byte length and SHA-256.

## Delivery: bundled, not CDN

Nothing here is in the JS bundle. `src/utils/pdfUnicodeText.js` reaches each file
through `new URL('…ttf', import.meta.url)`, which Vite rewrites into the hashed
**static asset** it emits, so a runtime fetches one only at the moment an export
actually needs that script (verified in an Electron `file://` renderer with
`webSecurity` on, the strictest of the four runtimes):

* a text box whose characters all fit WinAnsi (the overwhelming majority)
  downloads **0 bytes** and embeds **0 bytes** — that path is byte-for-byte what
  it was before;
* the first Greek, Cyrillic, Latin-ext or Vietnamese character costs one 244 KB
  fetch; the first ✓ or ☐ costs 627 KB; the first CJK character costs 3.46 MB.
  The tiers are independent — CJK text never pulls the Arabic font.

**Bundled is deliberate, and a CDN is deliberately not the default.** Electron
production loads via `loadFile` → `file://` and must work offline. Both Capacitor
runtimes ship a fixed webview bundle. And the enterprise M365/SharePoint buyers
this product targets routinely block outbound CDN egress by policy — a font fetch
that silently fails and drops glyphs out of a signed survey document is the worst
available failure mode. Setting `VITE_UNICODE_FONT_BASE_URL` opts into a mirror:
it is tried first, the bundled asset stays the fallback, and the bytes are only
trusted when their SHA-256 matches `fontCoverage.js`.

WOFF2 is **not an option**: `@pdf-lib/fontkit@1.1.1` ships pako (zlib) only, with
no brotli decoder, so it cannot decode a WOFF2 file at all. Ship raw `.ttf`.

## Inside the exported PDF the cost is tiny

pdf-lib subsets every embedded font. A page carrying Latin-ext, Greek, Cyrillic,
symbols, Hebrew, Arabic, Devanagari, Thai and CJK across eight embedded subsets
adds tens of KB, not megabytes — DroidSansFallback alone is 1.8 MB unsubset and
~3 KB subset for a few characters. Rule of thumb per export: ~5 KB per script
actually used, plus ~3–7 KB per DISTINCT colour emoji at 64 px (deduplicated
document-wide).

## Emoji are rasterised, not embedded as a font

No PDF viewer supports any OpenType colour table (SVG, COLR, CBDT, sbix) and
pdf-lib cannot embed one, so `NotoColorEmoji.ttf` (10.7 MB of CBDT bitmaps) is
useless here. In a **browser** — web, the Electron renderer, both Capacitor
webviews, i.e. every runtime a real user exports or prints from — each emoji
grapheme is painted with the **system** emoji font onto an offscreen canvas at
~300 dpi and embedded as a colour PNG image XObject, deduplicated per document.
In **Node** (unit tests, the fidelity harnesses) there is no canvas, so the
monochrome `NotoEmoji-Regular.ttf` outlines are used instead and the harnesses
stay deterministic. Either way the emoji is written verbatim into `/Contents`, so
search and copy/paste return the real character.

That is also why emoji pixels are **not** reproducible across machines: macOS
paints Apple Color Emoji, Windows Segoe UI Emoji, Android Noto Color Emoji. Any
pixel-diff fidelity gate must exclude emoji regions or force the Node path.

## Why these files, and what they still do not cover

*Droid Sans Fallback* is the compact broad-CJK answer: ~104 bytes per glyph, and
it carries **no Latin**, so nothing is duplicated. It must stay a **glyf
(TrueType)** face: pdf-lib branches on `isCFF()` and emits
CIDFontType0/FontFile3 for a CFF font, which Chrome's built-in PDFium viewer
renders as **nothing at all** while still extracting the text. Every Noto Sans
CJK alternative is either `.otf`/CFF (NotoSansJP-Regular.otf 4.5 MB,
NotoSansCJKjp-Regular.otf 16.5 MB) or a 9.6 MB variable TTF, and
`notofonts/noto-cjk` ships zero static `.ttf`. Do not "upgrade" it.

Still uncovered: Korean Hanja beyond Droid's set, Armenian, Georgian, Ethiopic,
Khmer, Myanmar, Tibetan and the other complex scripts. Text in those is written
verbatim into `/Contents` (UTF-16BE, so a reader shows and copies it correctly)
and left out of the drawn glyph run rather than printed as tofu; the export logs
the code points it dropped. Adding a script is one entry in
`UNICODE_FALLBACK_FONTS` in `src/utils/pdfUnicodeText.js`, one in the build
script's `SOURCES`, and the font file here — but **throw-test the shaper first**:
@pdf-lib/fontkit@1.1.1 is a stale partially-transpiled build and its
USE/Indic-style shapers can throw rather than degrade (see below).

**RTL renders single-direction only.** fontkit reverses a pure Hebrew or Arabic
run correctly, so a line in one direction is right. A line that MIXES directions
(a Latin label beside Hebrew, European digits inside Arabic) comes out in the
wrong visual order, because run splitting is per code point in logical order and
the drawer advances left to right. The fix is a real Unicode Bidi Algorithm pass
before the font split. Do not claim RTL support beyond this.

**Line wrapping is per character in logical order.** That is wrong for Thai,
which has no inter-word spaces and needs dictionary or ICU line breaking, so a
long Thai paragraph wraps mid-syllable.

## The three traps the build script exists to prevent

1. **Odd-length `glyf` entries silently blank glyphs.**
   `@pdf-lib/fontkit@1.1.1` subsets a TrueType font by copying raw `glyf`
   entries and then picks the SHORT `loca` format whenever the subset is under
   64 KB (`loca.preEncode` does `offset >>>= 1` with no evenness check). One
   odd-length glyph truncates its own end offset and every later glyph in the
   subset decodes a byte out of phase and renders blank. Noto Sans Symbols 2
   ships **1,321 odd-length glyphs of 2,654** and loses ✓ ✗ ★ ⚠ ☐ without the
   padding pass (`glyf.padding = 2`). A plain `pyftsubset` re-write does not fix
   it. The build script pads every source glyph and then **asserts zero** odd
   entries; `tests/exportUnicodeScripts.test.mjs` re-runs that assertion against
   whatever is committed, so a hand-downloaded replacement cannot slip in.

2. **Stripping GSUB/GPOS makes a complex script render NOTHING.** The build
   drops the layout tables for fonts that do not need shaping (pdf-lib draws
   those glyph by glyph, so they are bytes nobody reads) — but Arabic's cursive
   joining forms are GSUB substitutions, and fontkit's shaper emits the joined
   forms or no glyphs at all. Hebrew, Thai, Arabic and Devanagari are flagged
   `needsShaping: true` and keep their layout tables; the build asserts GSUB is
   present on every one of them.

3. **Devanagari throws `regeneratorRuntime is not defined`.** fontkit's Indic
   syllable state machine is regenerator-compiled and the runtime was never
   bundled, so the first Devanagari layout call throws — taking the whole export
   down rather than degrading one glyph. `pdfUnicodeText.js` lazily imports
   `regenerator-runtime/runtime.js` alongside any shaped font, and
   `regenerator-runtime` is pinned as a direct dependency so a transitive
   removal cannot break it. Note the explicit `.js`: the package declares no
   `exports` map, so the bare specifier does not resolve under Node's ESM loader.
