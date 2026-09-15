#!/usr/bin/env node
/**
 * Rebuild the Unicode fallback fonts the PDF export embeds
 * (src/assets/fonts/). Run this only when the fonts need refreshing — the
 * built .ttf files are committed, so a normal checkout never needs it.
 *
 *   node scripts/build-export-unicode-fonts.mjs            # all fonts
 *   node scripts/build-export-unicode-fonts.mjs symbols2   # one or more ids
 *
 * Requires: network access and python3 with fonttools on PATH
 * (`pip install fonttools` / `brew install fonttools`).
 *
 * WHY these fonts (see src/assets/fonts/README.md for the full rationale):
 *   - Noto Sans (OFL-1.1) closes Latin-ext, Greek, Cyrillic, Vietnamese and
 *     typographic punctuation in one file.
 *   - Noto Sans Symbols 2 (OFL-1.1) carries the survey/punch-list vocabulary —
 *     ☑ ✓ ✗ ★ ● ■ ⚠ ☐ — which silently vanished before.
 *   - Noto Sans Symbols (OFL-1.1) adds arrows, ⌀ and circled numbers.
 *   - Noto Sans Hebrew / Thai / Arabic / Devanagari (OFL-1.1) are the
 *     per-script tiers; the last three need SHAPING (see needsShaping).
 *   - Droid Sans Fallback (Apache-2.0) is the compact broad-CJK fallback:
 *     ~33k code points (Han for SC/TC/JP, kana, Hangul) in ~3.4 MB. It carries
 *     NO Latin — the standard-14 WinAnsi fonts already cover that, so nothing
 *     is duplicated. It MUST stay a glyf (TrueType) font: pdf-lib emits
 *     CIDFontType0/FontFile3 for a CFF face and Chrome's PDFium renders that
 *     as nothing at all while still extracting the text, so every Noto Sans
 *     CJK .otf is disqualified.
 *   - Noto Emoji (OFL-1.1) is the MONOCHROME emoji font, kept only as the
 *     Node / no-canvas fallback; browsers rasterise colour emoji instead.
 *
 * WHY the pipeline is not just "download the .ttf":
 *   1. Variable fonts are instanced at wght=400. pdf-lib embeds a static
 *      instance; shipping the variable original would be dead weight.
 *   2. For fonts that need NO shaping, layout tables (GSUB/GPOS/GDEF/kern/
 *      morx), hinting and DSIG are dropped — pdf-lib draws those glyph by
 *      glyph, so they are bytes nobody reads. For fonts that DO need shaping
 *      (`needsShaping: true`), the layout tables are KEPT: stripping GSUB from
 *      Noto Sans Arabic makes it render literally NOTHING (fontkit's shaper
 *      produces no glyphs without the joining/ligature substitutions), and
 *      Devanagari and Thai lose their conjuncts and mark positioning.
 *   3. THE IMPORTANT ONE — every glyph's `glyf` entry is padded to an even
 *      length. @pdf-lib/fontkit@1.1.1 subsets a TrueType font by copying raw
 *      glyf entries and then choosing the SHORT `loca` format whenever the
 *      subset is under 64 KB (fontkit dist, `loca.preEncode`: it does
 *      `offset >>>= 1` with no evenness check). One odd-length glyph therefore
 *      truncates its own end offset and every later glyph in the subset
 *      decodes one byte out of phase — the classic "only some of the glyphs
 *      render" corruption. Noto Sans Symbols 2 ships 1,321 odd-length glyphs
 *      of 2,654 and loses ✓ ✗ ★ ⚠ ☐ without this pass (visually confirmed).
 *      Padding every source glyph to an even length keeps every accumulated
 *      subset offset even, so the short `loca` round-trips losslessly.
 *
 * THE GATES (a hand-downloaded replacement can never slip past them):
 *   - `odd-length glyf entries === 0` on every shipped file.
 *   - `needsShaping ⇒ GSUB present` on every shipped file.
 *   - glyf/loca present (i.e. the face is TrueType, never CFF) on every file.
 * A failure exits non-zero and leaves the previous committed font in place.
 *
 * The script also rewrites src/assets/fonts/fontCoverage.js — the EXACT cmap
 * of every shipped file, as merged code-point ranges, plus its byte length and
 * SHA-256. src/utils/pdfUnicodeText.js imports it, so the "is this font worth
 * downloading?" pre-filter is no longer a hand-written guess that can fetch
 * 777 KB for a character the font does not have: it is the font's own cmap.
 * The hashes back the optional VITE_UNICODE_FONT_BASE_URL mirror check.
 *
 *   node scripts/build-export-unicode-fonts.mjs --coverage-only
 *
 * regenerates that module from the already-committed .ttf files without
 * touching the network, which is how the two pre-existing fonts (the CJK and
 * emoji files, whose bytes are deliberately frozen) get their entries.
 */

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OUT_DIR = fileURLToPath(new URL('../src/assets/fonts/', import.meta.url));
const COVERAGE = path.join(OUT_DIR, 'fontCoverage.js');

const NOTO = (family) => `https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/${family}/hinted/ttf/${family}-Regular.ttf`;
const OFL = (dir) => `https://raw.githubusercontent.com/google/fonts/main/ofl/${dir}/OFL.txt`;

const SOURCES = [
  {
    id: 'latin',
    out: 'NotoSans-Regular.ttf',
    url: NOTO('NotoSans'),
    licenseOut: 'NotoSans-LICENSE.txt',
    licenseUrl: OFL('notosans'),
    instanceAt: null,
    // Latin/Greek/Cyrillic need no shaping for the way pdf-lib draws: every
    // code point maps to one glyph through the cmap. Kerning is a nicety the
    // export has never had.
    needsShaping: false,
  },
  {
    id: 'symbols2',
    out: 'NotoSansSymbols2-Regular.ttf',
    url: NOTO('NotoSansSymbols2'),
    licenseOut: 'NotoSansSymbols2-LICENSE.txt',
    licenseUrl: OFL('notosanssymbols2'),
    instanceAt: null,
    needsShaping: false,
  },
  {
    id: 'symbols',
    out: 'NotoSansSymbols-Regular.ttf',
    url: NOTO('NotoSansSymbols'),
    licenseOut: 'NotoSansSymbols-LICENSE.txt',
    licenseUrl: OFL('notosanssymbols'),
    instanceAt: null,
    needsShaping: false,
  },
  {
    id: 'hebrew',
    out: 'NotoSansHebrew-Regular.ttf',
    url: NOTO('NotoSansHebrew'),
    licenseOut: 'NotoSansHebrew-LICENSE.txt',
    licenseUrl: OFL('notosanshebrew'),
    instanceAt: null,
    // Hebrew points and the final-form ligatures ride on GSUB/GPOS.
    needsShaping: true,
  },
  {
    id: 'thai',
    out: 'NotoSansThai-Regular.ttf',
    url: NOTO('NotoSansThai'),
    licenseOut: 'NotoSansThai-LICENSE.txt',
    licenseUrl: OFL('notosansthai'),
    instanceAt: null,
    // Thai stacks tone marks above vowels above the base letter; that is all
    // GPOS mark positioning.
    needsShaping: true,
  },
  {
    id: 'arabic',
    out: 'NotoSansArabic-Regular.ttf',
    url: NOTO('NotoSansArabic'),
    licenseOut: 'NotoSansArabic-LICENSE.txt',
    licenseUrl: OFL('notosansarabic'),
    instanceAt: null,
    // PROVEN: without GSUB, Arabic renders NOTHING. The cursive joining forms
    // (init/medi/fina) are substitutions, and fontkit's Arabic shaper emits
    // the joined forms or nothing at all.
    needsShaping: true,
  },
  {
    id: 'devanagari',
    out: 'NotoSansDevanagari-Regular.ttf',
    url: NOTO('NotoSansDevanagari'),
    licenseOut: 'NotoSansDevanagari-LICENSE.txt',
    licenseUrl: OFL('notosansdevanagari'),
    instanceAt: null,
    // Conjuncts, reordering and matra placement are all GSUB/GPOS.
    needsShaping: true,
  },
  {
    id: 'cjk',
    out: 'DroidSansFallback.ttf',
    url: 'https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/data/fonts/DroidSansFallback.ttf',
    licenseOut: 'DroidSansFallback-LICENSE.txt',
    licenseUrl: 'https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/data/fonts/NOTICE',
    instanceAt: null,
    needsShaping: false,
  },
  {
    id: 'emoji',
    out: 'NotoEmoji-Regular.ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf',
    licenseOut: 'NotoEmoji-LICENSE.txt',
    licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoemoji/OFL.txt',
    instanceAt: 'wght=400',
    // Deliberately false: the browser paths rasterise colour emoji from the
    // system font and never reach this file, and the Node fallback draws the
    // single-code-point outlines it does cover. Keeping GSUB would let
    // fontkit split 👷🏽‍♀️ into four unrelated glyphs, which is worse output
    // than one tofu.
    needsShaping: false,
  },
];

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => (
    code === 0 ? resolve(stdout) : reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${stderr}`))
  ));
});

const download = async (url, destination) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(destination, bytes);
  return bytes;
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Pad every glyf entry to an even length, then GATE the result — see the
// header. fontTools exposes the padding as the glyf table's `padding`
// attribute; everything after `font.save` is the assertion suite.
const PAD_AND_GATE_PY = `
import json, sys
from fontTools.ttLib import TTFont
src, dst, needs_shaping = sys.argv[1], sys.argv[2], sys.argv[3] == 'true'
font = TTFont(src)
if 'glyf' not in font or 'loca' not in font:
    raise SystemExit(f'{src} has no glyf/loca table — it is a CFF face, which pdf-lib embeds as '
                     f'CIDFontType0/FontFile3 and Chrome/PDFium renders as nothing. Ship TrueType only.')
font['glyf'].padding = 2
font.save(dst)
check = TTFont(dst)
loca = check['loca']
odd = sum(1 for i in range(len(loca) - 1) if (loca[i + 1] - loca[i]) % 2)
if odd:
    raise SystemExit(f'GATE FAILED: {odd} glyph entries are still odd-length in {dst} — '
                     f'fontkit short-loca subsetting would silently blank every glyph after the first one.')
if needs_shaping and 'GSUB' not in check:
    raise SystemExit(f'GATE FAILED: {dst} is flagged needsShaping but carries no GSUB table — '
                     f'a shaped script with its layout tables stripped renders NOTHING AT ALL.')
if 'CFF ' in check or 'CFF2' in check:
    raise SystemExit(f'GATE FAILED: {dst} carries a CFF outline table.')
print(json.dumps({
    'glyphs': len(loca) - 1,
    'odd': odd,
    'gsub': 'GSUB' in check,
    'gpos': 'GPOS' in check,
    'gdef': 'GDEF' in check,
    'unicodes': len(check.getBestCmap()),
}))
`;

const args = process.argv.slice(2);
const coverageOnly = args.includes('--coverage-only');
const only = new Set(args.filter((value) => !value.startsWith('--')).map((value) => value.toLowerCase()));
const selected = only.size ? SOURCES.filter((source) => only.has(source.id)) : SOURCES;
if (!selected.length) {
  throw new Error(`no font ids matched ${[...only].join(', ')}; known ids: ${SOURCES.map((s) => s.id).join(', ')}`);
}

/**
 * Regenerate src/assets/fonts/fontCoverage.js from whatever .ttf files are
 * currently committed. The ranges are the font's EXACT cmap (adjacent code
 * points merged, nothing widened), so `mayCover` in pdfUnicodeText.js answers
 * with the same authority the font itself would after the download.
 */
const writeCoverageModule = async () => {
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const entries = [];
  for (const source of SOURCES) {
    const file = path.join(OUT_DIR, source.out);
    let bytes;
    try { bytes = await readFile(file); } catch {
      console.warn(`  (skipping ${source.out} — not built yet)`);
      continue;
    }
    const face = fontkit.create(new Uint8Array(bytes));
    const points = [...face.characterSet].sort((a, b) => a - b);
    const ranges = [];
    for (const point of points) {
      const last = ranges[ranges.length - 1];
      if (last && point - last[1] === 1) last[1] = point;
      else ranges.push([point, point]);
    }
    entries.push({
      id: source.id,
      file: source.out,
      bytes: bytes.length,
      sha256: sha256(bytes),
      needsShaping: !!source.needsShaping,
      codePoints: points.length,
      ranges,
    });
  }
  const hex = (value) => `0x${value.toString(16)}`;
  const body = entries.map((entry) => [
    `  {`,
    `    id: '${entry.id}',`,
    `    file: '${entry.file}',`,
    `    bytes: ${entry.bytes},`,
    `    sha256: '${entry.sha256}',`,
    `    needsShaping: ${entry.needsShaping},`,
    `    codePoints: ${entry.codePoints},`,
    `    // ${entry.ranges.length} ranges, ${entry.codePoints} code points`,
    `    ranges: [${entry.ranges.map(([low, high]) => (low === high ? `[${hex(low)},${hex(low)}]` : `[${hex(low)},${hex(high)}]`)).join(',')}],`,
    `  },`,
  ].join('\n')).join('\n');
  const module = [
    '// GENERATED by scripts/build-export-unicode-fonts.mjs — do not hand-edit.',
    '//',
    "// Each entry is one shipped fallback font's EXACT cmap, as merged code-point",
    '// ranges. src/utils/pdfUnicodeText.js uses it as the "is this font worth',
    '// downloading for this character?" pre-filter, so the answer is the font\'s own',
    '// coverage rather than a hand-written guess — a guess is how a plain "→" came',
    '// to trigger a 777 KB emoji-font download that then did not have the glyph.',
    '//',
    '// `bytes` and `sha256` describe the committed file. They are what the optional',
    '// VITE_UNICODE_FONT_BASE_URL mirror is checked against before its bytes are',
    '// trusted; a mismatch falls back to the bundled asset.',
    '',
    'export const FONT_COVERAGE = [',
    body,
    '];',
    '',
    'export const FONT_COVERAGE_BY_ID = new Map(FONT_COVERAGE.map((entry) => [entry.id, entry]));',
    '',
  ].join('\n');
  await writeFile(COVERAGE, module);
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(`\ncoverage → ${path.relative(process.cwd(), COVERAGE)} (${entries.length} fonts, ${total} B shipped)`);
};

if (coverageOnly) {
  await writeCoverageModule();
} else {
  const work = await mkdtemp(path.join(tmpdir(), 'survey-fonts-'));
  await mkdir(OUT_DIR, { recursive: true });
  try {
    for (const source of selected) {
      const raw = path.join(work, 'raw.ttf');
      const original = await download(source.url, raw);
      let staged = raw;

      if (source.instanceAt) {
        const instanced = path.join(work, 'instance.ttf');
        await run('fonttools', ['varLib.instancer', '-o', instanced, staged, source.instanceAt]);
        staged = instanced;
      }

      const stripped = path.join(work, 'stripped.ttf');
      // The ONLY difference between a shaped and an unshaped build: whether the
      // layout tables survive. Getting this wrong on Arabic ships a font that
      // passes every size and no-throw check and draws nothing.
      const layoutArgs = source.needsShaping
        ? ['--layout-features=*', '--drop-tables+=DSIG,morx']
        : ['--layout-features=', '--drop-tables+=GSUB,GPOS,GDEF,DSIG,morx,kern'];
      await run('pyftsubset', [
        staged,
        '--unicodes=*',
        ...layoutArgs,
        '--no-hinting',
        `--output-file=${stripped}`,
      ]);

      const padded = path.join(OUT_DIR, source.out);
      const gateLog = await run('python3', [
        '-c', PAD_AND_GATE_PY, stripped, padded, source.needsShaping ? 'true' : 'false',
      ]);
      const gate = JSON.parse(gateLog.trim().split('\n').pop());

      const finalBytes = await readFile(padded);
      await download(source.licenseUrl, path.join(OUT_DIR, source.licenseOut));
      console.log(
        `${source.out}: source ${original.length} B (sha256 ${sha256(original)}) → shipped ${finalBytes.length} B`,
      );
      console.log(
        `  ${gate.glyphs} glyphs, ${gate.unicodes} code points, 0 odd-length entries`
        + `, GSUB ${gate.gsub ? 'kept' : 'dropped'}, GPOS ${gate.gpos ? 'kept' : 'dropped'}`,
      );
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  await writeCoverageModule();
}
