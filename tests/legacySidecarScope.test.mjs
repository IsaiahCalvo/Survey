import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const start = source.indexOf('const loadSurveyDataFromSupabase = useCallback(');
const end = source.indexOf('\n  }, [', start);
assert.ok(start >= 0 && end > start);
const callbackSource = source.slice(start + 'const loadSurveyDataFromSupabase = useCallback('.length, end + '\n  }'.length);

function harness({ download, doc = { id: 'doc-a', projectId: 'project-a', name: 'a.pdf', size: 42 } } = {}) {
  const state = { writes: [], downloads: 0 };
  const scope = { file: doc, actorUserId: 'actor-a' };
  const scopeRef = { current: scope };
  const values = {
    legacySidecarScope: scope, legacySidecarScopeRef: scopeRef,
    pdfFile: doc, numPages: 10, getPDFId: (file) => `${file.name}-${file.size}`,
    surveyDefinition: { mode: 'legacy' },
    downloadFromStorage: async (...args) => { state.downloads++; return download(...args); },
    console: { warn() {} },
    surveyMarkersRef: { current: {} }, savedAnnotationsByPageRef: { current: {} },
    resolveSafeSnapshot: ({ incoming }) => ({ value: incoming }),
    coercePageNumber: (value, max) => Math.min(Number(value), max),
    ...Object.fromEntries(['SurveyMarkers', 'AnnotationsByPage', 'Callouts', 'Spaces', 'Entities', 'Scale', 'PageNum']
      .map((name) => [`set${name}`, (value) => state.writes.push([name, value])])),
  };
  const load = new Function(...Object.keys(values), `return (${callbackSource});`)(...Object.values(values));
  return { load, doc, state, scopeRef, values };
}

const sidecar = { entities: [{ id: 'entity-a' }], zoomLevel: 1.5, currentPage: 4,
  annotationsByPage: { 1: { objects: [{ id: 'old' }] } }, annotations: { old: {} }, callouts: [{ id: 'old' }], spaces: [{ id: 'old' }] };
const blob = () => ({ text: async () => JSON.stringify(sidecar) });

test('a sidecar download that finishes after an account switch cannot change viewer state', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const h = harness({ download: () => pending });
  const loading = h.load(h.doc);
  h.scopeRef.current = { file: h.doc, actorUserId: 'actor-b' };
  finish(blob());
  await loading;
  assert.deepEqual(h.state.writes, []);
});

test('a sidecar body that finishes after a document change cannot restore old view state', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const h = harness({ download: async () => ({ text: () => pending }) });
  const loading = h.load(h.doc);
  await Promise.resolve();
  h.scopeRef.current = { file: { ...h.doc, id: 'doc-b' }, actorUserId: 'actor-a' };
  finish(JSON.stringify(sidecar));
  await loading;
  assert.deepEqual(h.state.writes, []);
});

test('same-document retry cancellation rejects the old pending sidecar', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  let cancelled = false;
  let bodyReads = 0;
  const h = harness({ download: () => pending });
  const loading = h.load(h.doc, () => cancelled);
  cancelled = true;
  finish({ text: async () => { bodyReads++; return JSON.stringify(sidecar); } });
  await loading;
  assert.equal(bodyReads, 0);
  assert.deepEqual(h.state.writes, []);
});

test('an old callback cannot start a new download after switching away and back', async () => {
  const h = harness({ download: async () => blob() });
  h.scopeRef.current = { file: h.doc, actorUserId: 'actor-a' };
  await h.load(h.doc);
  assert.equal(h.state.downloads, 0);
  assert.deepEqual(h.state.writes, []);
});

test('current cloud sidecar restores entities and view but never old annotations', async () => {
  const h = harness({ download: async () => blob() });
  await h.load(h.doc);
  assert.deepEqual(h.state.writes, [
    ['Entities', sidecar.entities], ['Scale', 1.5], ['PageNum', 4],
  ]);
  assert.deepEqual(h.values.savedAnnotationsByPageRef.current, {});
});

test('current local sidecar preserves legacy restoration and rejects a queued stale spaces update', async () => {
  const h = harness({ download: async () => blob(),
    doc: { name: 'local.pdf', size: 42, projectId: 'project-a' },
  });
  await h.load(h.doc);
  assert.deepEqual(h.state.writes.map(([name]) => name), [
    'SurveyMarkers', 'AnnotationsByPage', 'Callouts', 'Spaces', 'Entities', 'Scale', 'PageNum',
  ]);
  assert.deepEqual(h.values.savedAnnotationsByPageRef.current, sidecar.annotationsByPage);
  const updateSpaces = h.state.writes.find(([name]) => name === 'Spaces')[1];
  assert.deepEqual(updateSpaces([]), sidecar.spaces);
  const currentSpaces = [{ id: 'new-doc-space' }];
  h.scopeRef.current = { file: { ...h.doc }, actorUserId: 'actor-a' };
  assert.equal(updateSpaces(currentSpaces), currentSpaces);
});

test('missing and malformed sidecars preserve existing state without failing the PDF load', async () => {
  for (const download of [
    async () => null,
    async () => { throw new Error('not found'); },
    async () => ({ text: async () => '{broken' }),
  ]) {
    const h = harness({ download });
    await h.load(h.doc);
    assert.deepEqual(h.state.writes, []);
  }
});

test('first-page path still awaits initial restoration and passes its cancellation guard', () => {
  assert.match(source, /await loadSurveyDataFromSupabase\(pdfFile, \(\) => !isCurrentLoad\(\)\)/);
});
