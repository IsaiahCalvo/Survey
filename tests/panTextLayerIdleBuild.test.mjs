// Open speed: under Pan the text layer only serves the hover-to-select
// (utils/panTextSelect.js), yet each mounted page built it during the open:
// pdf.js measures every glyph run (~130 ms of measureText on the 240-sheet set,
// inside the open's busiest stretch) and again on every zoom. Under Pan alone it
// is now built when the browser is idle; Text Select still builds at once, and
// switching to Text Select starts a waiting build at once. See
// /mnt/project-files/perf/speed-round-3.md, Round 29.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../src/components/PdfjsTextLayer.jsx', import.meta.url), 'utf8');
const START = '  useEffect(() => {\n    let cancelled = false;';
const END = '\n  }, [pdf, pageNumber, scale, rotation, onTextAvailability]);';

function buildEffect() {
  const at = SOURCE.indexOf(START);
  assert.ok(at > 0, 'the text layer build effect is in PdfjsTextLayer.jsx');
  const body = SOURCE.slice(at + '  useEffect(() => {'.length, SOURCE.indexOf(END, at));
  // eslint-disable-next-line no-new-func
  return new Function(
    'ref', 'pdf', 'pageNumber', 'scale', 'rotation', 'onTextAvailability',
    'readPdfjsTextContent', 'pdfjsLib', 'idleOnlyRef', 'buildNowRef',
    'requestIdleCallback', 'cancelIdleCallback',
    body,
  );
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness({ idleOnly, withIdle = true }) {
  const log = [];
  const idle = new Map();
  let nextId = 1;
  const requestIdle = (fn, options) => { const id = nextId; nextId += 1; idle.set(id, fn); log.push(`idle-requested:${options?.timeout}`); return id; };
  const cancelIdle = (id) => { if (idle.delete(id)) log.push('idle-cancelled'); };
  const runIdle = () => { const calls = [...idle.values()]; idle.clear(); calls.forEach((fn) => fn()); };
  const el = { innerHTML: 'old', style: { setProperty() {} } };
  const page = { rotate: 0, getViewport: () => ({ width: 100, height: 200 }) };
  const pdf = { getPage: async (n) => { log.push(`getPage:${n}`); return page; } };
  const pdfjsLib = {
    TextLayer: class { constructor() { log.push('textlayer'); } async render() { log.push('render'); } cancel() { log.push('cancel'); } },
  };
  const buildNowRef = { current: null };
  const cleanup = buildEffect()(
    { current: el }, pdf, 3, 1, 0, () => log.push('availability'),
    async () => ({ items: [] }), pdfjsLib, { current: idleOnly }, buildNowRef,
    withIdle ? requestIdle : undefined, withIdle ? cancelIdle : undefined,
  );
  return { log, runIdle, buildNowRef, cleanup };
}

test('under Pan alone nothing is built until the browser is idle', async () => {
  const h = harness({ idleOnly: true });
  await flush();
  assert.deepEqual(h.log, ['idle-requested:2000'], 'no page read or text measuring during the open');
  h.runIdle();
  await flush(); await flush();
  assert.deepEqual(h.log, ['idle-requested:2000', 'getPage:3', 'availability', 'textlayer', 'render']);
});

test('Text Select builds at once, as before', async () => {
  const h = harness({ idleOnly: false });
  await flush(); await flush();
  assert.deepEqual(h.log, ['getPage:3', 'availability', 'textlayer', 'render']);
});

test('switching to Text Select starts a waiting build at once', async () => {
  const h = harness({ idleOnly: true });
  assert.equal(typeof h.buildNowRef.current, 'function');
  h.buildNowRef.current();
  await flush(); await flush();
  assert.deepEqual(h.log, ['idle-requested:2000', 'idle-cancelled', 'getPage:3', 'availability', 'textlayer', 'render']);
  assert.equal(h.buildNowRef.current, null);
  h.runIdle();
  await flush();
  assert.equal(h.log.filter((entry) => entry === 'getPage:3').length, 1, 'built once');
});

test('a page that leaves (or a zoom) before idle drops the waiting build', async () => {
  const h = harness({ idleOnly: true });
  h.cleanup();
  assert.deepEqual(h.log, ['idle-requested:2000', 'idle-cancelled']);
  assert.equal(h.buildNowRef.current, null);
  h.runIdle();
  await flush();
  assert.ok(!h.log.includes('getPage:3'));
});

test('without requestIdleCallback (iOS Safari) it builds at once', async () => {
  const h = harness({ idleOnly: true, withIdle: false });
  await flush(); await flush();
  assert.deepEqual(h.log, ['getPage:3', 'availability', 'textlayer', 'render']);
});

test('the idle-only flag is Pan without Text Select, and Text Select kicks a waiting build', () => {
  assert.match(SOURCE, /idleOnlyRef\.current = panHover && !interactive;/);
  assert.match(SOURCE, /useEffect\(\(\) => \{ if \(interactive\) buildNowRef\.current\?\.\(\); \}, \[interactive\]\);/);
});
