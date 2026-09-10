# Unicode fallback fonts for PDF export

These two fonts exist for one job: a text box (or callout) whose text the
standard PDF fonts cannot encode must still **print** and still **export** with
real glyphs. Before they existed, a note containing an emoji or any CJK
character was dropped from the flattened print entirely (`WinAnsi cannot encode
"屋" (0x5c4b)` thrown out of pdf-lib's text drawer) and exported as a bare
`/FreeText` with no appearance stream.

Rebuild them with `node scripts/build-export-unicode-fonts.mjs` (network +
`fonttools` required). The built `.ttf` files are committed, so a normal
checkout never runs that script.

| file | covers | license | shipped size |
| --- | --- | --- | --- |
| `DroidSansFallback.ttf` | ~33,000 CJK code points — Han (SC/TC/JP), kana, Hangul, CJK punctuation | Apache-2.0 (`DroidSansFallback-LICENSE.txt`) | 3.46 MB |
| `NotoEmoji-Regular.ttf` | ~1,489 emoji code points, **monochrome outlines** | OFL-1.1 (`NotoEmoji-LICENSE.txt`) | 0.78 MB |

## Bundle-size impact

Neither font is in the app bundle. `src/utils/pdfUnicodeText.js` reaches them
through `new URL('…ttf', import.meta.url)`, which Vite rewrites into the hashed
**static asset** it emits, so the browser fetches one only at the moment an
export actually needs it (verified in an Electron `file://` renderer with
`webSecurity` on, the strictest of the four runtimes):

* a text box whose characters all fit WinAnsi (the overwhelming majority)
  downloads **0 bytes** and embeds **0 bytes** — that path is byte-for-byte what
  it was before;
* the first CJK character in an export costs a one-time 3.46 MB fetch (cached
  by the browser/Electron thereafter);
* the first emoji costs a one-time 0.78 MB fetch. The two are independent — CJK
  text never pulls the emoji font, and vice versa.

Inside the **exported PDF** the cost is tiny, because pdf-lib subsets: a page
with a couple of lines of Japanese plus a handful of emoji adds ~3 KB, not
megabytes.

## Why these two, and what they deliberately do not cover

*Droid Sans Fallback* is the compact broad-CJK answer: ~104 bytes per glyph.
A full Noto Sans SC is ~10 MB and Noto Sans CJK ~16 MB for the same job. It
carries **no Latin**, which is a feature here — the standard-14 WinAnsi fonts
already draw Latin, so nothing is duplicated and the fallback chain only ever
reaches Droid for characters WinAnsi genuinely cannot encode.

*Noto Emoji* is the monochrome build. The colour build (`NotoColorEmoji.ttf`)
is 10.7 MB of CBDT bitmaps that pdf-lib cannot embed as a simple font, and a
black-and-white 🙂 in a printed markup is the right answer anyway.

Scripts these two do **not** cover — Greek, Cyrillic, Arabic, Hebrew, Indic,
Thai — still have no glyph source. Text in those scripts is written verbatim
into `/Contents` (UTF-16BE, so a reader shows and copies it correctly) and is
skipped in the drawn glyph run rather than printed as tofu boxes. Adding a
script is one entry in `UNICODE_FALLBACK_FONTS` in
`src/utils/pdfUnicodeText.js` plus a font file here.

## The glyf padding in the build script

`@pdf-lib/fontkit@1.1.1` corrupts a TrueType subset whenever a source glyph has
an odd-length `glyf` entry — it picks the short `loca` format and does
`offset >>>= 1` with no evenness check, so every glyph after the odd one decodes
one byte out of phase and renders blank. The build script pads every glyph to an
even length (`glyf.padding = 2`), which costs ~9 KB and makes the subset exact.
Do not replace these files with a plain download; re-run the script.
