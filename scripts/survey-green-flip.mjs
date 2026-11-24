#!/usr/bin/env node
// Turn Survey's public face from coral to its own green in one step, for the
// day the suite look leaves Nightly (docs/suite/survey-green-flip.md).
//
// Until then Survey wears green only under the Nightly flag 'one-look'. The
// tab icon, the public pages, the free tools and the emails are seen by
// everyone and can't sit behind a flag, so they stay coral. This script holds
// the whole change so nobody has to hunt for it later:
//
//   node scripts/survey-green-flip.mjs           list what would change
//   node scripts/survey-green-flip.mjs --apply   change it, rebuild, check
//
// --apply swaps each coral tone for the matching green one (the accents table
// in docs/suite/SUITE-RULES.md) in the source files below, copies the green
// icons from public/brand-green/ over the coral ones, rebuilds the public
// pages, the free tools and the email templates, then fails if any coral is
// left in what visitors see.
import { readFileSync, writeFileSync, copyFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Coral (Walkthru's accent, worn by Survey since KAL-663) to Survey green.
export const CORAL_TO_GREEN = Object.freeze({
  // dark mode: accent, hover, pressed
  '#e07a5e': '#3dc98a',
  '#e89179': '#5ad49d',
  '#c7634a': '#2bb077',
  // light mode: accent, hover, pressed
  '#ba4f2c': '#157f55',
  '#a64525': '#116d49',
  '#8f3a1e': '#0d5a3c',
});

// Hand-written sources. Built pages come from public/welcome/site.css.
export const SOURCES = Object.freeze([
  'public/welcome/site.css',
  'public/google-connected.html',
  'public/privacy.html',
  'public/terms.html',
  'public/delete-account/index.html',
  'public/status/index.html',
  'public/404.html',
  'supabase/functions/_shared/emailLayout.ts',
  // the tests that pin these colours move with them
  'tests/suiteMarks.test.mjs',
  'tests/emailLayout.test.mjs',
]);

export const ICONS = Object.freeze([
  'favicon.svg', 'favicon.png', 'favicon-16x16.png', 'favicon-64x64.png',
  'favicon.ico', 'logo192.png', 'logo512.png',
]);

// Where visitors see colour. Coral left here after --apply is a miss.
const SCAN = ['public', 'tools', 'debug/email-templates-staged', 'supabase/functions/_shared'];
// Coral that is not Survey's accent: the Walkthru pages name Walkthru's own
// colour, and a template's colour choices are the user's ink.
const SCAN_SKIP = [/^public\/brand-green\//, /^public\/nightly\//];

const CORAL_RE = new RegExp(Object.keys(CORAL_TO_GREEN).map((h) => h.slice(1)).join('|'), 'gi');

export function toGreen(text) {
  return text.replace(new RegExp(`#(${CORAL_RE.source})\\b`, 'gi'), (hex) => {
    const green = CORAL_TO_GREEN[hex.toLowerCase()];
    return hex === hex.toUpperCase() ? green.toUpperCase() : green;
  });
}

export function coralIn(text) {
  return (text.match(new RegExp(`#(${CORAL_RE.source})\\b`, 'gi')) || []).length;
}

function walk(dir, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = join(dir, name);
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(html|css|svg|ts|js|mjs|json|txt)$/i.test(name)) out.push(rel);
  }
  return out;
}

function leftovers() {
  const found = [];
  for (const dir of SCAN) {
    for (const rel of walk(dir)) {
      if (SCAN_SKIP.some((re) => re.test(rel))) continue;
      const n = coralIn(readFileSync(join(ROOT, rel), 'utf8'));
      if (n) found.push(`${rel} (${n})`);
    }
  }
  return found;
}

function main() {
  const apply = process.argv.includes('--apply');
  let changed = 0;
  for (const rel of SOURCES) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) { console.log(`missing ${rel}`); continue; }
    const before = readFileSync(abs, 'utf8');
    const n = coralIn(before);
    if (!n) continue;
    changed += 1;
    console.log(`${apply ? 'green' : 'would turn green'}: ${rel} (${n})`);
    if (apply) writeFileSync(abs, toGreen(before));
  }
  for (const name of ICONS) {
    console.log(`${apply ? 'copied' : 'would copy'}: public/brand-green/${name} -> public/${name}`);
    if (apply) copyFileSync(join(ROOT, 'public/brand-green', name), join(ROOT, 'public', name));
  }
  if (!apply) {
    console.log(`\n${changed} source files and ${ICONS.length} icons. Run with --apply to make the change.`);
    return;
  }
  for (const script of ['build-marketing.mjs', 'build-free-tools.mjs', 'gen-auth-email-templates.mjs']) {
    console.log(`running scripts/${script}`);
    execFileSync(process.execPath, [join(ROOT, 'scripts', script)], { cwd: ROOT, stdio: 'inherit' });
  }
  const left = leftovers();
  if (left.length) {
    console.error(`\nCoral is still here:\n  ${left.join('\n  ')}\nAdd each file to SOURCES or SCAN_SKIP, then run again.`);
    process.exit(1);
  }
  console.log('\nNo coral left where visitors look. Next steps: docs/suite/survey-green-flip.md');
}

if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === '') main();
