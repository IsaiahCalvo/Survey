import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  useEffect(() => {', source.indexOf('// Poll for Excel changes when live sync is active'));
const end = source.indexOf('\n  }, [liveSyncEnabled, excelSessionId, useFallbackSync', start);
assert.ok(start >= 0 && end > start, 'exercise the real viewer polling effect');
const effectBody = source.slice(start + '  useEffect(() => {'.length, end);
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness(t) {
  const state = { cell: 'before', imports: [], reads: 0, gate: null };
  const timers = new Map();
  let timerId = 0;
  const refs = {
    liveSyncPollRef: { current: null },
    lastPollDataRef: { current: null },
    excelPollScopeRef: { current: null },
    lastKnownETagRef: { current: null },
  };
  let props = {
    liveSyncEnabled: true, oneDriveFileId: 'book-a', graphClient: {}, liveSyncStatus: 'connected',
    excelSessionId: 'session-a', useFallbackSync: false, selectedTemplate: { sharePointDriveId: 'drive-a' },
  };
  let cleanup;
  const render = (next = {}) => {
    cleanup?.();
    props = { ...props, ...next };
    const sourceWorkbook = props.oneDriveFileId;
    const scope = {
      ...refs, ...props,
      isInteractionPerfWindowActive: () => false,
      emitPdfDebugEvent() {},
      getWorksheets: async () => [{ name: 'Sheet1' }],
      getUsedRange: async () => {
        state.reads += 1;
        const value = state.cell;
        if (state.gate) await state.gate;
        return { values: [[value]] };
      },
      getFileETag: async () => ({ eTag: state.cell }),
      handleAutoSyncFromExcel: () => state.imports.push(sourceWorkbook),
      setInterval: (callback) => { timers.set(++timerId, callback); return timerId; },
      clearInterval: (id) => timers.delete(id),
      console: { warn() {}, error() {} },
    };
    cleanup = new Function(...Object.keys(scope), effectBody)(...Object.values(scope));
  };
  t.after(() => cleanup?.());
  return { state, refs, timers, render, tick: () => { for (const callback of timers.values()) callback(); } };
}

test('same-workbook callback rerender keeps its baseline and detects the next Excel edit', async (t) => {
  const h = harness(t);
  h.render();
  await settle();
  assert.deepEqual(h.refs.lastPollDataRef.current, { Sheet1: '[["before"]]' });
  h.state.cell = 'changed-in-excel';
  h.render();
  await settle();
  assert.deepEqual(h.state.imports, ['book-a']);
  assert.equal(h.timers.size, 1);
});

for (const [label, change] of [
  ['account/client', () => ({ graphClient: {} })],
  ['drive', () => ({ selectedTemplate: { sharePointDriveId: 'drive-b' } })],
  ['workbook', () => ({ oneDriveFileId: 'book-b' })],
  ['session', () => ({ excelSessionId: 'session-b' })],
]) {
  test(`${label} switch establishes a fresh baseline instead of importing another scope's change`, async (t) => {
    const h = harness(t);
    h.render();
    await settle();
    h.state.cell = 'other-scope';
    h.render(change());
    await settle();
    assert.deepEqual(h.state.imports, []);
    assert.deepEqual(h.refs.lastPollDataRef.current, { Sheet1: '[["other-scope"]]' });
    h.state.cell = 'next-edit';
    h.tick();
    await settle();
    assert.equal(h.state.imports.length, 1);
  });
}

test('poll ticks do not overlap and a cancelled read cannot replace the new workbook baseline', async (t) => {
  const h = harness(t);
  let release;
  h.state.gate = new Promise((resolve) => { release = resolve; });
  h.render();
  await settle();
  h.tick(); h.tick();
  await settle();
  assert.equal(h.state.reads, 1, 'in-flight guard survives scope fix');
  h.state.gate = null;
  h.state.cell = 'new-workbook';
  h.render({ oneDriveFileId: 'book-b' });
  await settle();
  release();
  await settle();
  assert.deepEqual(h.refs.lastPollDataRef.current, { Sheet1: '[["new-workbook"]]' });
  assert.deepEqual(h.state.imports, []);
});
