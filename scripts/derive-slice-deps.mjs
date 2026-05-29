// Generalized dependency deriver for extracting a slice of App.jsx.
//
// Usage: node scripts/derive-slice-deps.mjs <startLine> <endLine>
//
// Parses App.jsx, then parses the given line slice, and classifies every free
// identifier the slice references:
//   IMPORTS  - symbols App.jsx imports -> reconstructed import statements.
//   MODULE   - App.jsx module-scope (non-import) symbols, with a flag for
//              whether they're ALSO used outside the slice (stay+export) or
//              only inside it (could move).
//   GLOBALS  - real browser/JS globals (count only).
//   UNKNOWN  - none of the above (investigate).

import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

const PLUGINS = ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'objectRestSpread', 'dynamicImport', 'topLevelAwait'];
const start = parseInt(process.argv[2], 10);
const end = parseInt(process.argv[3], 10);

const app = readFileSync('src/App.jsx', 'utf8');
const appLines = app.split('\n');
const appAst = parse(app, { sourceType: 'module', plugins: PLUGINS });

const imports = new Map();
const moduleDecls = new Map();
traverse(appAst, {
  ImportDeclaration(path) {
    const source = path.node.source.value;
    for (const spec of path.node.specifiers) {
      if (spec.type === 'ImportDefaultSpecifier') imports.set(spec.local.name, { source, kind: 'default' });
      else if (spec.type === 'ImportNamespaceSpecifier') imports.set(spec.local.name, { source, kind: 'namespace' });
      else imports.set(spec.local.name, { source, kind: 'named', imported: spec.imported.name });
    }
  },
  Program(path) {
    for (const stmt of path.node.body) {
      if (stmt.type === 'VariableDeclaration') for (const d of stmt.declarations) { if (d.id.type === 'Identifier') moduleDecls.set(d.id.name, d.id.loc?.start.line); }
      else if (stmt.type === 'FunctionDeclaration' && stmt.id) moduleDecls.set(stmt.id.name, stmt.id.loc?.start.line);
      else if (stmt.type === 'ClassDeclaration' && stmt.id) moduleDecls.set(stmt.id.name, stmt.id.loc?.start.line);
    }
  },
});

const sliceText = appLines.slice(start - 1, end).join('\n');
const sliceAst = parse(sliceText, { sourceType: 'module', plugins: PLUGINS });
let sliceGlobals = [];
traverse(sliceAst, { Program(p) { sliceGlobals = Object.keys(p.scope.globals).sort(); } });

// Determine "used outside slice" for module symbols: count word-boundary hits
// outside [start,end].
const outside = appLines.slice(0, start - 1).join('\n') + '\n' + appLines.slice(end).join('\n');
const usedOutside = (name) => new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(outside);

const importsNeeded = [], moduleNeeded = [], unknown = [];
let globalCount = 0;
for (const name of sliceGlobals) {
  if (imports.has(name)) importsNeeded.push(name);
  else if (moduleDecls.has(name)) moduleNeeded.push(name);
  else { /* real global or unknown */ }
}
// Distinguish unknowns from baseline globals using the captured baseline if present.
let baseline = new Set();
try { baseline = new Set(readFileSync('/tmp/appjsx-globals.txt', 'utf8').split('\n').filter(Boolean)); } catch {}
for (const name of sliceGlobals) {
  if (imports.has(name) || moduleDecls.has(name)) continue;
  if (baseline.has(name)) globalCount++;
  else unknown.push(name);
}

const bySource = new Map();
for (const name of importsNeeded) {
  const info = imports.get(name);
  if (!bySource.has(info.source)) bySource.set(info.source, { default: null, namespace: null, named: [] });
  const g = bySource.get(info.source);
  if (info.kind === 'default') g.default = name;
  else if (info.kind === 'namespace') g.namespace = name;
  else g.named.push(info.imported === name ? name : `${info.imported} as ${name}`);
}
const importStmts = [];
for (const [source, g] of bySource) {
  const parts = [];
  if (g.default) parts.push(g.default);
  if (g.namespace) parts.push(`* as ${g.namespace}`);
  if (g.named.length) parts.push(`{ ${g.named.sort().join(', ')} }`);
  importStmts.push(`import ${parts.join(', ')} from '${source}';`);
}

console.log(`=== slice App.jsx lines ${start}-${end} ===\n`);
console.log('--- IMPORT STATEMENTS (copy to new file) ---');
console.log(importStmts.sort().join('\n'));
console.log('\n--- MODULE-SCOPE symbols from App.jsx (need export+import or move) ---');
for (const n of moduleNeeded.sort()) console.log(`  ${n}  (App.jsx:${moduleDecls.get(n)})  ${usedOutside(n) ? 'USED-OUTSIDE → export from App.jsx' : 'slice-only → could move'}`);
console.log('\n--- UNKNOWN (not import/module/baseline-global) ---');
console.log(unknown.length ? unknown.map(u => '  ' + u).join('\n') : '  (none)');
console.log(`\n--- real globals used: ${globalCount} ---`);
