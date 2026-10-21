#!/usr/bin/env node
// Size budget for the built web app. Run after `npm run build`:
//
//   node scripts/bundle-budget.mjs            check dist/ against the budget
//   node scripts/bundle-budget.mjs --update   write today's sizes as the budget
//
// "First load" is what a browser must fetch before the app can start: the entry
// chunk from dist/index.html, the chunks it preloads for the app it always
// starts (its __vite__mapDeps list; src/entry.jsx only ever loads main.jsx),
// and every chunk those import statically. JS and CSS are counted apart. "All JavaScript" is every .js file in
// dist/assets, so a heavy library added behind a lazy import still shows up.
// Sizes are gzip, which is close to what goes over the wire.
//
// A PR fails only on a big jump: more than GROWTH over the budget AND more than
// the metric's floor in bytes, so small, honest growth never blocks. When the
// growth is intended, run with --update and commit scripts/bundle-budget.json
// in the same PR, so the reviewer sees the new number.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = path.join(ROOT, 'scripts/bundle-budget.json');
export const GROWTH = 0.10;
export const FLOOR_BYTES = { firstLoadJs: 20 * 1024, firstLoadCss: 10 * 1024, allJs: 150 * 1024 };

const gzipSize = (file) => zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;

// Static imports only: `import{a}from"./x.js"`, `import"./x.js"`, `export*from"./x.js"`.
// Lazy `import("./x.js")` is left out on purpose.
const STATIC_IMPORT = /(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["'](\.\/[^"']+?\.js)["']/g;

export function staticImports(source) {
  return [...source.matchAll(STATIC_IMPORT)].map((match) => match[1]);
}

/** Files a chunk preloads for its lazy imports (Vite's __vite__mapDeps list). */
export function preloadList(source) {
  const list = source.match(/m\.f\|\|\(m\.f=\[([^\]]*)\]\)/);
  return list ? [...list[1].matchAll(/["'`](\.\/[^"'`]+)["'`]/g)].map((m) => m[1]) : [];
}

export function measure(distDir) {
  const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  const entries = refs.filter((ref) => ref.endsWith('.js'));
  const queue = [...entries];
  for (const ref of entries) {
    const file = path.join(distDir, ref);
    if (!fs.existsSync(file)) continue;
    for (const dep of preloadList(fs.readFileSync(file, 'utf8'))) {
      queue.push(path.posix.join(path.posix.dirname(ref), dep));
    }
  }
  while (queue.length) {
    const ref = queue.shift();
    if (seen.has(ref)) continue;
    seen.add(ref);
    const file = path.join(distDir, ref);
    if (!ref.endsWith('.js') || !fs.existsSync(file)) continue;
    for (const dep of staticImports(fs.readFileSync(file, 'utf8'))) {
      queue.push(path.posix.join(path.posix.dirname(ref), dep));
    }
  }
  const sum = (list) => list.reduce((total, ref) => total + gzipSize(path.join(distDir, ref)), 0);
  const assets = fs.readdirSync(path.join(distDir, 'assets'));
  const loaded = [...new Set([...seen, ...refs])].filter((ref) => fs.existsSync(path.join(distDir, ref)));
  return {
    firstLoadJs: sum(loaded.filter((ref) => ref.endsWith('.js'))),
    firstLoadCss: sum(loaded.filter((ref) => ref.endsWith('.css'))),
    allJs: sum(assets.filter((name) => name.endsWith('.js')).map((name) => `assets/${name}`)),
  };
}

/** Lines for metrics that grew past the budget, given sizes and budget. */
export function overBudget(sizes, budget) {
  const failures = [];
  for (const [key, floor] of Object.entries(FLOOR_BYTES)) {
    const limit = budget[key];
    if (typeof limit !== 'number') continue;
    const growth = sizes[key] - limit;
    if (growth > floor && growth > limit * GROWTH) {
      failures.push(`${LABELS[key]}: ${kb(sizes[key])} against a budget of ${kb(limit)} (+${kb(growth)}).`);
    }
  }
  return failures;
}

const LABELS = { firstLoadJs: 'First load, JavaScript', firstLoadCss: 'First load, styles', allJs: 'All JavaScript' };
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function main() {
  const distDir = path.join(ROOT, process.argv.find((arg) => arg.startsWith('--dist='))?.slice(7) || 'dist');
  const sizes = measure(distDir);
  if (process.argv.includes('--update')) {
    fs.writeFileSync(BUDGET_FILE, `${JSON.stringify(sizes, null, 2)}\n`);
    console.log(`Wrote ${path.relative(ROOT, BUDGET_FILE)}: ${JSON.stringify(sizes)}`);
    return;
  }
  const budget = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
  const rows = Object.keys(FLOOR_BYTES).map((key) => `| ${LABELS[key]} | ${kb(sizes[key])} | ${kb(budget[key] ?? 0)} |`);
  const report = ['### App size (gzip)', '', '| | This build | Budget |', '| --- | --- | --- |', ...rows, ''].join('\n');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  const failures = overBudget(sizes, budget);
  if (failures.length) {
    console.error(`::error::The app got much bigger:\n${failures.join('\n')}\nIf that is intended, run \`npm run build && node scripts/bundle-budget.mjs --update\` and commit scripts/bundle-budget.json.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
