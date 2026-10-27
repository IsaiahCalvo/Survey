import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
// Execute the actual small request/commit guards with controlled viewport/source
// state. Browser cases cover loading, first activation, and later manual zoom.
// isInTabBehind (utils/tabBehind.js) is stubbed: these cases are a front tab.
const requestStart = source.indexOf("    const isFit = target === 'fit' || target === 'fitw' || target === 'fith';");
const requestEnd = source.indexOf('    // RULED 2026-09-23', requestStart);
assert.ok(requestStart > 0 && requestEnd > requestStart);
const request = new Function('target', 'options', 'el', 'pendingViewportFitRef', 'latestActiveSourceRef', 'isInTabBehind = () => false', source.slice(requestStart, requestEnd));
const resumeMatch = source.match(/useLayoutEffect\(\(\) => \{\n    const pending = pendingViewportFitRef\.current;([\s\S]*?)\n  \}, \[activeSource, containerW, containerH, pageSizes, viewportFitRevision, zoomToScale\]\);/);
assert.ok(resumeMatch, 'pending fit commit hook exists');
const resume = new Function('pendingViewportFitRef', 'scrollerRef', 'activeSource', 'pageSizes', 'zoomToScale', 'isInTabBehind = () => false', `const pending = pendingViewportFitRef.current;${resumeMatch[1]}`);

test('hidden fit waits for both viewport axes and loaded page sizes', () => {
  const document = {};
  const pending = { current: null };
  request('fit', {}, { clientWidth: 0, clientHeight: 0 }, pending, { current: document });
  assert.equal(pending.current.source, document);
  const calls = [];
  for (const [width, height, sizes] of [[0, 600, [{}]], [800, 0, [{}]], [800, 600, []]]) {
    resume(pending, { current: { clientWidth: width, clientHeight: height } }, document, sizes, (...args) => calls.push(args));
  }
  assert.deepEqual(calls, []);
  resume(pending, { current: { clientWidth: 800, clientHeight: 600 } }, document, [{}], (...args) => calls.push(args));
  assert.deepEqual(calls, [['fit', {}]]);
});

test('a pending fit cannot apply after a different source replaces the hidden document', () => {
  const oldSource = {};
  const replacement = {};
  const pending = { current: null };
  request('fitw', {}, { clientWidth: 0, clientHeight: 0 }, pending, { current: oldSource });
  const calls = [];
  resume(pending, { current: { clientWidth: 800, clientHeight: 600 } }, replacement, [{}], (...args) => calls.push(args));
  assert.deepEqual(calls, []);
});

test('saved manual zoom supersedes an initial fit even before the viewport is shown', () => {
  const pending = { current: { source: {}, target: 'fit' } };
  request(1.5, {}, { clientWidth: 0, clientHeight: 0 }, pending, { current: {} });
  assert.equal(pending.current, null);
});

test('resuming an automatic fit keeps its anchoring options', () => {
  const document = {};
  const options = { auto: true };
  const pending = { current: null };
  request('fitw', options, { clientWidth: 0, clientHeight: 0 }, pending, { current: document });
  const calls = [];
  resume(pending, { current: { clientWidth: 800, clientHeight: 600 } }, document, [{}], (...args) => calls.push(args));
  assert.deepEqual(calls, [['fitw', options]]);
  assert.equal(calls[0][1], options);
});

test('a fit asked for while the tab is behind waits until it comes to the front', () => {
  // A tab behind keeps its real size (utils/tabBehind.js), so size alone
  // cannot tell it is hidden.
  const document = {};
  const pending = { current: null };
  const shown = { clientWidth: 800, clientHeight: 600 };
  request('fit', {}, shown, pending, { current: document }, () => true);
  assert.equal(pending.current?.target, 'fit');
  const calls = [];
  resume(pending, { current: shown }, document, [{}], (...args) => calls.push(args), () => true);
  assert.deepEqual(calls, []);
  resume(pending, { current: shown }, document, [{}], (...args) => calls.push(args), () => false);
  assert.deepEqual(calls, [['fit', {}]]);
});
