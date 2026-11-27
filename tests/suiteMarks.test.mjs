// KAL-663: Survey's marks and public pages wear the suite's coral, not the old
// gold. Checks the text files; scripts keep the pictures in step by hand.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const OLD_GOLD = /#(d8a84e|edc26d|b6904a|654500)/i;

function htmlUnder(dir) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) out.push(...htmlUnder(path));
    else if (/\.(html|css|svg|json)$/.test(name)) out.push(path);
  }
  return out;
}

test('suite marks: the tab icon is coral in both tab-strip modes', () => {
  const svg = read('public/favicon.svg');
  assert.ok(svg.includes('.m { stroke: #ba4f2c; }'), 'deep coral on a light tab strip');
  assert.ok(svg.includes('{ .m { stroke: #e07a5e; } }'), 'bright coral on a dark tab strip');
  assert.doesNotMatch(svg, OLD_GOLD);
});

test('suite marks: no public page, style sheet or manifest holds the old gold', () => {
  // The Nightly mark keeps its own violet (public/nightly) and is not checked.
  // public/brand-gold holds the gold icons that wait for the look to leave
  // Nightly (docs/suite/survey-gold-flip.md); that switch removes this test.
  // The Kal Voe suite site (public/kal-voe) shows each app in its own accent from
  // SUITE-RULES "One colour set", so Survey is gold there already.
  const files = [...htmlUnder('public'), ...htmlUnder('tools')]
    .filter((f) => !f.startsWith(join('public', 'nightly')) && !f.startsWith(join('public', 'brand-gold')) && !f.startsWith(join('public', 'kal-voe')));
  assert.ok(files.length > 50, 'found the public pages');
  for (const file of files) assert.doesNotMatch(read(file), OLD_GOLD, file);
});

test('suite marks: the installed app opens on the suite ground', () => {
  const manifest = JSON.parse(read('public/manifest.json'));
  assert.equal(manifest.theme_color, '#131315');
  assert.equal(manifest.background_color, '#131315');
  assert.match(read('android/app/src/main/res/values/ic_launcher_background.xml'), /#131315/);
});

test('suite marks: a filled button on the public pages has words that pass 4.5:1', () => {
  const css = read('public/welcome/site.css');
  // Light: white on the deep coral. Dark: dark words on the bright coral.
  assert.ok(css.includes('--accent-fill:#ba4f2c;--accent-ink:#ffffff'), 'light pair');
  assert.ok(css.includes('--accent-fill:#e07a5e;--accent-ink:#131315'), 'dark pair');
});
