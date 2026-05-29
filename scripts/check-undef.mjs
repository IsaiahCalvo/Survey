// Scope-aware "unresolved identifier" checker.
//
// Parses a JS/JSX file and reports every identifier that is referenced but has
// no binding anywhere in the file (Babel's scope.globals). Used to verify
// component extractions: a freshly-extracted module must not reference any
// identifier that isn't imported or declared locally.
//
// Usage: node scripts/check-undef.mjs <file.jsx>
//
// The known-good monolith (src/App.jsx) defines the baseline set of acceptable
// globals (real browser/JS globals + intentional ambient refs). An extracted
// file should produce NO globals outside that baseline.

import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-undef.mjs <file>');
  process.exit(2);
}

const code = readFileSync(file, 'utf8');

const ast = parse(code, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'objectRestSpread', 'dynamicImport', 'topLevelAwait'],
});

let globals = [];
traverse(ast, {
  Program(path) {
    globals = Object.keys(path.scope.globals).sort();
  },
});

console.log(globals.join('\n'));
