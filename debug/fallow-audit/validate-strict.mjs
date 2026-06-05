// Stricter validation: for each flagged file, find importers by RESOLVING each
// import/require/export-from specifier to an absolute path and comparing to the
// candidate. Eliminates shared-basename false matches. Also reports git last-
// commit date (legacy vs recently-touched) and untracked (WIP) status.
import fs from 'node:fs';
import cp from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const d = JSON.parse(fs.readFileSync('debug/fallow-audit/dead-code3.json', 'utf8'));
const flagged = d.unused_files.map((x) => x.path).filter((p) => p.startsWith('src/'));
const flaggedAbs = new Set(flagged.map((p) => path.resolve(ROOT, p)));

const untracked = new Set(
  cp.execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' })
    .split('\n').filter(Boolean).map((p) => path.resolve(ROOT, p))
);

const SCAN_DIRS = ['src', 'tests', 'agent-cli', 'debug', 'supabase', 'scripts'];
const exts = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css'];
const extSet = new Set([...exts, '.html', '.json']);
function walk(dir, acc) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules') continue; walk(fp, acc); }
    else if (extSet.has(path.extname(e.name))) acc.push(fp);
  }
  return acc;
}
const allFiles = [];
for (const root of ['index.html', ...SCAN_DIRS]) {
  if (fs.existsSync(root) && fs.statSync(root).isFile()) allFiles.push(root);
  else walk(root, allFiles);
}

// resolve a relative specifier from an importing file to a real file path
function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // bare pkg
  const baseDir = path.dirname(path.resolve(ROOT, fromFile));
  let target = path.resolve(baseDir, spec);
  const cands = [target];
  for (const e of exts) cands.push(target + e);
  for (const e of exts) cands.push(path.join(target, 'index' + e));
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch {} }
  return null;
}

const specRe = /(?:import|export)[^'"`]*?from\s*['"`]([^'"`]+)['"`]|import\s*['"`]([^'"`]+)['"`]|require\(\s*['"`]([^'"`]+)['"`]\s*\)|import\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

const importerMap = new Map(); // candidateAbs -> Set(importerFile)
for (const f of allFiles) {
  const c = fs.readFileSync(f, 'utf8');
  let m;
  specRe.lastIndex = 0;
  while ((m = specRe.exec(c))) {
    const spec = m[1] || m[2] || m[3] || m[4];
    if (!spec) continue;
    const resolved = resolveSpec(f, spec);
    if (resolved && flaggedAbs.has(resolved) && resolved !== path.resolve(ROOT, f)) {
      if (!importerMap.has(resolved)) importerMap.set(resolved, new Set());
      importerMap.get(resolved).add(f);
    }
  }
}

function lastCommit(f) {
  try { return cp.execSync(`git log -1 --format=%cs -- "${f}"`, { encoding: 'utf8' }).trim() || 'untracked'; }
  catch { return '?'; }
}

const rows = flagged.map((f) => {
  const abs = path.resolve(ROOT, f);
  const importers = [...(importerMap.get(abs) || [])];
  return { file: f, importers, wip: untracked.has(abs), last: lastCommit(f) };
});

const dead = rows.filter((r) => !r.wip && r.importers.length === 0);
const onlyDead = []; // imported only by other dead files (cascade)
const deadSet = new Set(dead.map((r) => path.resolve(ROOT, r.file)));
const used = rows.filter((r) => !r.wip && r.importers.length > 0);
for (const r of used) {
  const liveImporters = r.importers.filter((imp) => !deadSet.has(path.resolve(ROOT, imp)));
  if (liveImporters.length === 0) onlyDead.push(r);
}
const wip = rows.filter((r) => r.wip);

console.log(`\n### DEAD — zero importers (${dead.length})`);
for (const r of dead) console.log(`  ${r.last}  ${r.file}`);
console.log(`\n### CASCADE — imported only by dead files (${onlyDead.length})`);
for (const r of onlyDead) console.log(`  ${r.last}  ${r.file}   <- ${r.importers.map((i)=>path.relative(ROOT,i)).join(', ')}`);
console.log(`\n### TRULY USED — live importers, fallow false positive (${used.length - onlyDead.length})`);
for (const r of used.filter((r)=>!onlyDead.includes(r))) console.log(`  ${r.file}   <- ${r.importers.map((i)=>path.relative(ROOT,i)).join(', ')}`);
console.log(`\n### WIP — untracked (${wip.length})`);
for (const r of wip) console.log(`  ${r.file}`);

fs.writeFileSync('debug/fallow-audit/validate-strict.json', JSON.stringify({ dead, onlyDead, used, wip }, null, 2));
