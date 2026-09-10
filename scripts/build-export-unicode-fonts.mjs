#!/usr/bin/env node
/**
 * Rebuild the two Unicode fallback fonts the PDF export embeds
 * (src/assets/fonts/). Run this only when the fonts need refreshing — the
 * built .ttf files are committed, so a normal checkout never needs it.
 *
 *   node scripts/build-export-unicode-fonts.mjs
 *
 * Requires: network access and python3 with fonttools on PATH
 * (`pip install fonttools` / `brew install fonttools`).
 *
 * WHY these fonts (see src/assets/fonts/README.md for the full rationale):
 *   - Droid Sans Fallback (Apache-2.0) is the compact broad-CJK fallback:
 *     ~33k code points (Han for SC/TC/JP, kana, Hangul) in ~3.4 MB. It carries
 *     NO Latin — the standard-14 WinAnsi fonts already cover that, so nothing
 *     is duplicated.
 *   - Noto Emoji (OFL-1.1) is the MONOCHROME emoji font — outlines, not the
 *     10 MB colour bitmap build — so an emoji in a text box prints as a real
 *     glyph instead of tofu.
 *
 * WHY the pipeline is not just "download the .ttf":
 *   1. Variable fonts are instanced at wght=400. pdf-lib embeds a static
 *      instance; shipping the variable original would be dead weight.
 *   2. Layout tables (GSUB/GPOS/GDEF/kern/morx), hinting and DSIG are dropped.
 *      pdf-lib draws glyph by glyph and never runs shaping, so they are bytes
 *      nobody reads.
 *   3. THE IMPORTANT ONE — every glyph's `glyf` entry is padded to an even
 *      length. @pdf-lib/fontkit@1.1.1 subsets a TrueType font by copying raw
 *      glyf entries and then choosing the SHORT `loca` format whenever the
 *      subset is under 64 KB (fontkit dist, `loca.preEncode`: it does
 *      `offset >>>= 1` with no evenness check). One odd-length glyph therefore
 *      truncates its own end offset and every later glyph in the subset
 *      decodes one byte out of phase — the classic "only some of the CJK
 *      renders" corruption. Padding every source glyph to an even length keeps
 *      every accumulated subset offset even, so the short `loca` round-trips
 *      losslessly. Costs ~9 KB on Droid Sans Fallback.
 */

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OUT_DIR = fileURLToPath(new URL('../src/assets/fonts/', import.meta.url));

const SOURCES = [
  {
    out: 'DroidSansFallback.ttf',
    url: 'https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/data/fonts/DroidSansFallback.ttf',
    licenseOut: 'DroidSansFallback-LICENSE.txt',
    licenseUrl: 'https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/data/fonts/NOTICE',
    instanceAt: null,
  },
  {
    out: 'NotoEmoji-Regular.ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf',
    licenseOut: 'NotoEmoji-LICENSE.txt',
    licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoemoji/OFL.txt',
    instanceAt: 'wght=400',
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

// Pad every glyf entry to an even length — see the header comment. fontTools
// exposes this as the glyf table's `padding` attribute.
const PAD_GLYF_PY = `
import sys
from fontTools.ttLib import TTFont
src, dst = sys.argv[1], sys.argv[2]
font = TTFont(src)
font['glyf'].padding = 2
font.save(dst)
check = TTFont(dst)
loca = check['loca']
odd = sum(1 for i in range(len(loca) - 1) if (loca[i + 1] - loca[i]) % 2)
if odd:
    raise SystemExit(f'{odd} glyph entries are still odd-length in {dst}')
print(f'padded {len(loca) - 1} glyphs, 0 odd-length entries')
`;

const work = await mkdtemp(path.join(tmpdir(), 'survey-fonts-'));
await mkdir(OUT_DIR, { recursive: true });
try {
  for (const source of SOURCES) {
    const raw = path.join(work, 'raw.ttf');
    const original = await download(source.url, raw);
    let staged = raw;

    if (source.instanceAt) {
      const instanced = path.join(work, 'instance.ttf');
      await run('fonttools', ['varLib.instancer', '-o', instanced, staged, source.instanceAt]);
      staged = instanced;
    }

    const stripped = path.join(work, 'stripped.ttf');
    await run('pyftsubset', [
      staged,
      '--unicodes=*',
      '--layout-features=',
      '--drop-tables+=GSUB,GPOS,GDEF,DSIG,morx,kern',
      '--no-hinting',
      `--output-file=${stripped}`,
    ]);

    const padded = path.join(OUT_DIR, source.out);
    const padLog = await run('python3', ['-c', PAD_GLYF_PY, stripped, padded]);

    const finalBytes = await readFile(padded);
    await download(source.licenseUrl, path.join(OUT_DIR, source.licenseOut));
    console.log(
      `${source.out}: source ${original.length} B (sha256 ${sha256(original)}) → shipped ${finalBytes.length} B`,
    );
    console.log(`  ${padLog.trim()}`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
