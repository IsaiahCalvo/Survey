// w53 (2026-09-28) — copying Survey items between spaces crashed.
//
// The "copy items" branch of the space-picker in PDFViewer used
// `sourceSpaceId`, a name that was never declared anywhere, so every copy of
// selected Survey items threw a ReferenceError the moment the user picked the
// destination space. The fix binds it to the source module the picker already
// resolves (`sourceModuleId`) and switches the destination with
// setSelectedModuleId (the Survey module) instead of setSelectedSpaceId (the
// REGION selection).
//
// Test 1 is the class guard: parse PDFViewer.jsx with Babel and fail on any
// identifier that has no binding in the file and is not a real browser/JS
// global — the exact kind of bug this was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;
const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

// Real runtime globals PDFViewer legitimately uses (browser + JS builtins).
const KNOWN_GLOBALS = new Set([
  'AbortController', 'Array', 'ArrayBuffer', 'Blob', 'Boolean', 'CSS', 'CustomEvent', 'Date',
  'DOMParser', 'DOMRect', 'Element', 'Error', 'Event', 'File', 'FileReader', 'Float32Array', 'FormData',
  'HTMLElement', 'Image', 'Infinity', 'IntersectionObserver', 'JSON', 'KeyboardEvent', 'Map', 'Math',
  'MouseEvent', 'MutationObserver', 'NaN', 'Number', 'Object', 'Path2D', 'PerformanceObserver',
  'PointerEvent', 'Promise', 'Proxy', 'Reflect', 'RegExp', 'ResizeObserver', 'Set', 'String', 'Symbol',
  'TextDecoder', 'TextEncoder', 'TypeError', 'Uint8Array', 'Uint8ClampedArray', 'URL', 'URLSearchParams',
  'WeakMap', 'WeakRef', 'WeakSet', 'WheelEvent', 'Worker', 'alert', 'atob', 'btoa',
  'cancelAnimationFrame', 'cancelIdleCallback', 'clearInterval', 'clearTimeout', 'confirm', 'console',
  'crypto', 'decodeURIComponent', 'document', 'encodeURIComponent', 'fetch', 'getComputedStyle',
  'globalThis', 'import', 'isFinite', 'isNaN', 'localStorage', 'location', 'navigator', 'parseFloat',
  'parseInt', 'performance', 'process', 'queueMicrotask', 'requestAnimationFrame',
  'requestIdleCallback', 'sessionStorage', 'setInterval', 'setTimeout', 'structuredClone', 'undefined',
  'window',
]);

test('PDFViewer references no identifier that is never defined', () => {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator',
      'objectRestSpread', 'dynamicImport', 'topLevelAwait'],
  });
  let globals = [];
  traverse(ast, { Program(path) { globals = Object.keys(path.scope.globals); } });
  const unknown = globals.filter((name) => !KNOWN_GLOBALS.has(name)).sort();
  assert.deepEqual(unknown, [], `never-defined names in PDFViewer.jsx: ${unknown.join(', ')}`);
});

test('the copy-items branch binds its source space to the resolved source module', () => {
  const branchStart = source.indexOf("// We're copying items - get the itemIds from the selected surveyMarkers");
  assert.ok(branchStart > 0, 'copy-items branch found');
  const branch = source.slice(branchStart, branchStart + 1500);
  assert.match(branch, /const sourceSpaceId = sourceModuleId;/);
  // sourceModuleId is resolved from the first copied Survey Marker's module
  const resolverStart = source.lastIndexOf('let sourceModuleId = null;', branchStart);
  assert.ok(resolverStart > 0 && branchStart - resolverStart < 20000, 'resolver precedes the branch');
  assert.match(
    source.slice(resolverStart, resolverStart + 600),
    /sourceModuleId = surveyMarkerModuleId \|\| selectedModuleId;/,
  );
});

test('after a copy the destination Survey module opens (not the region selection)', () => {
  const pickerStart = source.indexOf('// Determine source module ID if we\'re copying items');
  const pickerEnd = source.indexOf("console.warn('No items selected for copy. Closing modal.');", pickerStart);
  assert.ok(pickerStart > 0 && pickerEnd > pickerStart);
  const picker = source.slice(pickerStart, pickerEnd);
  assert.doesNotMatch(picker, /setSelectedSpaceId\(space\.id\)/);
  assert.ok(picker.split('setSelectedModuleId(space.id)').length - 1 >= 2);
  // module-or-legacy-spaces lookups only (templates may carry either key)
  assert.doesNotMatch(picker, /template\.spaces\.find\(/);
});
