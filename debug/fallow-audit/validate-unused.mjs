// Validate fallow's "unused file" findings by scanning every source file for
// references to each flagged module (by import-specifier basename). Pure JS,
// no shelling out. Flags untracked files as WIP so we never delete active work.
import fs from 'node:fs';
import cp from 'node:child_process';
import path from 'node:path';

const d = JSON.parse(fs.readFileSync('debug/fallow-audit/dead-code3.json', 'utf8'));
const flagged = d.unused_files.map((x) => x.path).filter((p) => p.startsWith('src/'));

const untracked = new Set(
  cp.execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' })
    .split('\n').filter(Boolean)
);

// Gather all source files we care about as potential importers.
const SCAN_DIRS = ['src', 'tests', 'agent-cli', 'debug', 'supabase', 'scripts'];
const exts = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.html']);
function walk(dir, acc) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules') continue; walk(fp, acc); }
    else if (exts.has(path.extname(e.name))) acc.push(fp);
  }
  return acc;
}
const allFiles = [];
for (const root of ['index.html', ...SCAN_DIRS]) {
  if (fs.existsSync(root) && fs.statSync(root).isFile()) allFiles.push(root);
  else walk(root, allFiles);
}
const contents = new Map(allFiles.map((f) => [f, fs.readFileSync(f, 'utf8')]));

function importersOf(file) {
  const base = path.basename(file).replace(/\.(jsx?|tsx?|css)$/, '');
  // Word-boundary match of the basename inside any import/require/url string.
  const re = new RegExp(`['"\`/]${base.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?:\\.(?:jsx?|tsx?|css))?['"\`]`);
  const refs = [];
  for (const [f, c] of contents) {
    if (f === file) continue;
    if (re.test(c)) refs.push(f);
  }
  return refs;
}

const result = { dead: [], used: [], wip: [] };
for (const f of flagged) {
  const refs = importersOf(f);
  const entry = { file: f, refs };
  if (untracked.has(f)) result.wip.push(entry);
  else if (refs.length === 0) result.dead.push(entry);
  else result.used.push(entry);
}

console.log(`\n=== DEAD (tracked, zero importers): ${result.dead.length} ===`);
for (const e of result.dead) console.log('  ' + e.file);
console.log(`\n=== WIP (untracked / active work): ${result.wip.length} ===`);
for (const e of result.wip) console.log('  ' + e.file + (e.refs.length ? `  (refs: ${e.refs.length})` : ''));
console.log(`\n=== USED (has importers — fallow false positive?): ${result.used.length} ===`);
for (const e of result.used) {
  console.log('  ' + e.file);
  e.refs.slice(0, 5).forEach((r) => console.log('        <- ' + r));
}
fs.writeFileSync('debug/fallow-audit/validate-result.json', JSON.stringify(result, null, 2));
