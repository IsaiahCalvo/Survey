#!/usr/bin/env node
// check-unused-imports.mjs — report unused and duplicate imports in JS/JSX files.
//
// A read-only companion to scripts/check-undef.mjs. Where check-undef finds
// identifiers a file leaves UNRESOLVED (missing imports), this finds the
// opposite: imports a file does not need. For each file it reports:
//   - DUPLICATE local names: the same binding imported more than once.
//   - DUPLICATE module specifiers: the same source imported on multiple lines.
//   - UNUSED imports: an imported binding (default / named / namespace) whose
//     local name is never referenced anywhere else in the file.
//   - local-module imports: the relative-path modules this file pulls (the real
//     import-graph edges), so architecture can be documented from fact.
//
// Uses @babel/parser + @babel/traverse (already a dev dependency). Read-only.
// Exit code is always 0 — this is an advisory report, not a CI gate. Before
// REMOVING anything it flags, re-verify with `npm run build` + `npm test`: a
// binding can be referenced in ways static analysis misses (rare, but verify).
//
// Usage:
//   node scripts/check-unused-imports.mjs src/viewerShared.js src/PDFViewer.jsx
//   node scripts/check-unused-imports.mjs --json src/viewerShared.js     (machine output)

import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const files = argv.filter((a) => a !== '--json');
if (files.length === 0) {
  console.error('usage: node scripts/check-unused-imports.mjs [--json] <file> [<file> ...]');
  process.exit(1);
}

const jsonReport = [];

for (const file of files) {
  const abs = path.resolve(file);
  let code;
  try {
    code = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    if (!jsonMode) console.log(`\n### ${file}\n  (could not read: ${e.message})`);
    continue;
  }

  let ast;
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });
  } catch (e) {
    if (!jsonMode) console.log(`\n### ${file}\n  (parse error: ${e.message})`);
    continue;
  }

  const imports = new Map();      // localName -> { line, source }
  const localNameCounts = new Map();
  const sourceLines = new Map();  // source -> [lines]
  const localModules = new Set();

  traverse(ast, {
    ImportDeclaration(p) {
      const source = p.node.source.value;
      const line = p.node.loc ? p.node.loc.start.line : 0;
      if (!sourceLines.has(source)) sourceLines.set(source, []);
      sourceLines.get(source).push(line);
      if (source.startsWith('.') || source.startsWith('/')) localModules.add(source);
      for (const spec of p.node.specifiers) {
        const local = spec.local.name;
        localNameCounts.set(local, (localNameCounts.get(local) || 0) + 1);
        imports.set(local, { line, source });
      }
    },
  });

  const refCounts = new Map();
  for (const name of imports.keys()) refCounts.set(name, 0);
  traverse(ast, {
    Identifier(p) {
      const name = p.node.name;
      if (!refCounts.has(name)) return;
      const parent = p.parent;
      if (
        parent &&
        (parent.type === 'ImportDefaultSpecifier' ||
          parent.type === 'ImportNamespaceSpecifier' ||
          parent.type === 'ImportSpecifier')
      ) {
        return; // skip the import declaration site itself
      }
      refCounts.set(name, refCounts.get(name) + 1);
    },
    JSXIdentifier(p) {
      const name = p.node.name;
      if (refCounts.has(name)) refCounts.set(name, refCounts.get(name) + 1);
    },
  });

  const duplicateNames = [...localNameCounts.entries()].filter(([, c]) => c > 1);
  const duplicateSources = [...sourceLines.entries()].filter(([, ls]) => ls.length > 1);
  const unused = [...refCounts.entries()].filter(([, c]) => c === 0);

  if (jsonMode) {
    jsonReport.push({
      file,
      localModules: [...localModules].sort(),
      duplicateNames: duplicateNames.map(([n, c]) => ({ name: n, count: c })),
      duplicateSources: duplicateSources.map(([s, ls]) => ({ source: s, lines: ls })),
      unused: unused.map(([n]) => ({ name: n, line: imports.get(n).line, source: imports.get(n).source })),
    });
    continue;
  }

  console.log(`\n### ${file}`);
  console.log(`  local-module imports: ${[...localModules].sort().join(', ') || '(none)'}`);
  if (duplicateNames.length) {
    console.log('  DUPLICATE local names:');
    for (const [n, c] of duplicateNames) console.log(`    - ${n} (imported ${c}x)`);
  }
  if (duplicateSources.length) {
    console.log('  DUPLICATE module specifiers (same source on multiple lines):');
    for (const [s, ls] of duplicateSources) console.log(`    - "${s}" on lines ${ls.join(', ')}`);
  }
  if (unused.length) {
    console.log('  UNUSED imports (local name never referenced):');
    for (const [n] of unused) console.log(`    - ${n}  (line ${imports.get(n).line}, from "${imports.get(n).source}")`);
  }
  if (!duplicateNames.length && !duplicateSources.length && !unused.length) {
    console.log('  clean: no duplicate or unused imports detected.');
  }
}

if (jsonMode) console.log(JSON.stringify(jsonReport));
