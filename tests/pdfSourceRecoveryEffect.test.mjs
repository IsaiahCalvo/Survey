import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';
import { createDocumentPdfSource } from '../src/services/documentPdfSource.js';
import { isManagedLocalDocument } from '../src/services/localDocumentState.js';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const tree = parse(source, { sourceType: 'module', plugins: ['jsx'] });
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) for (const child of Array.isArray(value) ? value : [value]) {
    if (child && typeof child === 'object') { const result = find(child, predicate); if (result) return result; }
  }
  return null;
}
const effect = find(tree, node => node.type === 'CallExpression' && node.callee.name === 'useEffect'
  && node.arguments[1]?.elements?.some(item => item.name === 'loadRetryToken')
  && find(node.arguments[0], child => child.type === 'CallExpression'
    && child.callee.object?.name === 'pdfjsLib' && child.callee.property?.name === 'getDocument'));
assert.ok(effect, 'Exercise the actual PDF loading effect, not a duplicate implementation');
const scopeGuard = find(tree, node => node.type === 'IfStatement'
  && source.slice(node.test.start, node.test.end).includes('pdfLoadScopeRef.current.file !== pdfFile'));
assert.ok(scopeGuard, 'Exercise the actual first-render file/bundle/actor scope fence');
const actorBinding = find(tree, node => node.type === 'VariableDeclarator' && node.id.name === 'pdfLoadActorUserId');
assert.ok(actorBinding, 'Local and cloud opens must use the production account-scope rule');
const watchdog = find(tree, node => node.type === 'CallExpression' && node.callee.name === 'useEffect'
  && find(node.arguments[0], child => child.type === 'VariableDeclarator' && child.id.name === 'HANG_TIMEOUT_MS'));
assert.ok(watchdog, 'Exercise the actual stalled-load watchdog');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {}); return { promise, resolve, reject }; };
const bytes = new TextEncoder().encode('%PDF-1.7\nowned-source-bytes\n');
const derived = new TextEncoder().encode('%PDF-1.7\nowned-derived-render-bytes\n');
const id = 'ca000000-0000-4000-8000-000000000001';
const blobFile = (extra = {}) => Object.assign(new Blob([bytes], { type: 'application/pdf' }), { id, name: 'owned.pdf', ...extra });
async function issuedBundle() {
  const generation = 'ca000000-0000-4000-8000-000000000003', path = `${id}/_generations/${generation}.pdf`;
  const hash = value => createHash('sha256').update(value).digest('hex');
  const manifest = { version: 1, actor_user_id: id, document_id: id, generation_id: generation,
    document: { id, user_id: id, project_id: null, name: 'Owned checked PDF', file_path: path, file_size: String(bytes.length) },
    pdf: { bucket_id: 'documents', path, id: 'ca000000-0000-4000-8000-000000000004',
      version: 'ca000000-0000-4000-8000-000000000005', byte_length: String(bytes.length), content_sha256: hash(bytes) },
    publication: { operation_id: 'ca000000-0000-4000-8000-000000000006', generation_id: generation,
      published_at: '2026-09-09T00:00:00Z', wal_head: '0' },
    annotations: { version: 2, document_id: id, generation_id: generation, wal_head: '0',
      snapshot: { at_seq: '0', snapshot: '\\x0000', encoding_version: 1, writer_id: null, writer_epoch: '0' },
      snapshot_sha256: hash(new Uint8Array([0, 0])) } };
  const reader = createDocumentGenerationReader({ getActorUserId: () => id,
    request: async (name, params) => {
      assert.equal(name, 'read_document_generation_open');
      const data = structuredClone(manifest);
      if (!params.p_include_snapshot) { data.annotations.snapshot = null; data.annotations.snapshot_sha256 = null; }
      return { data };
    }, download: async () => new Blob([bytes]) });
  return reader.open({ documentId: id, actorUserId: id, pdfGenerationId: generation });
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let n = 0; n < 300; n++) { if (predicate()) return; await tick(); }
  assert.fail('Owned effect did not reach the expected asynchronous boundary');
}

function harness(t, options = {}) {
  let file = options.file || blobFile(), bundle = options.checkedBundle ?? null, user = { id }, currentScope;
  const scopeRef = { current: null }, events = [], downloads = [], parses = [], rewrites = [], imports = [], updates = [];
  const state = { setLoadRetryToken: 0 }, starts = [], cleanups = [];
  const setter = name => value => { events.push({ name, value }); state[name] = typeof value === 'function' ? value(state[name]) : value; };
  const pdf = ({ pageError = null, pageGate = null } = {}) => ({ numPages: 1, destroyed: 0,
    async getPage() { if (pageGate) await pageGate.promise; if (pageError) throw pageError;
      return { getViewport: () => ({ width: 612, height: 792 }) }; },
    async destroy() { this.destroyed++; },
  });
  const plans = [...(options.plans || [pdf()])];
  const pdfLibPort = { ParseSpeeds: { Fastest: 1500 }, PDFDocument: {
    async load(value, config) {
      const record = { bytes: new Uint8Array(value).slice(), config, saves: [] }; rewrites.push(record);
      if (options.rewriteLoadGate) await options.rewriteLoadGate.promise;
      return { async save(config) {
        record.saves.push(config); if (options.rewriteSaveGate) await options.rewriteSaveGate.promise;
        return new Uint8Array(derived);
      } };
    },
  } };
  const pdfjsLib = { VerbosityLevel: { ERRORS: 0 }, getDocument(config) {
    const received = config.data instanceof ArrayBuffer ? config.data : config.data.buffer;
    const input = new Uint8Array(received).slice();
    // Real transfer/detachment models the worker boundary, including failures.
    structuredClone(received, { transfer: [received] });
    const record = { config, input, detachedLength: received.byteLength, destroys: 0 };
    const plan = plans.shift(); assert.ok(plan, 'Unexpected extra parse/recovery attempt');
    const canceled = deferred();
    const attempt = Promise.resolve().then(async () => {
      if (plan instanceof Error) throw plan;
      return typeof plan === 'function' ? plan(record) : plan;
    });
    const task = { promise: Promise.race([attempt, canceled.promise]),
      async destroy() { record.destroys++; canceled.reject(new Error('Owned loading task was destroyed'));
        if (options.destroyGate) await options.destroyGate.promise; } };
    record.task = task; parses.push(record); return task;
  } };
  function renderScope(patch = {}) {
    if ('file' in patch) file = patch.file;
    if ('bundle' in patch) bundle = patch.bundle;
    if ('actor' in patch) user = { id: patch.actor };
    new Function('pdfLoadScopeRef', 'pdfFile', 'checkedBundle', 'user',
      `const pdfLoadActorUserId = ${source.slice(actorBinding.init.start, actorBinding.init.end)};\n${source.slice(scopeGuard.start, scopeGuard.end)}`)
      (scopeRef, file, bundle, user);
    currentScope = scopeRef.current; return currentScope;
  }
  renderScope();
  const armWatchdog = () => {
    let timer;
    const scope = { isLoadingPDF: true, pdfFile: file, pdfLoadScopeRef: scopeRef, pdfLoadScope: currentScope,
      loadTrace: () => {}, console: { warn() {} }, setLoadRetryToken: setter('setLoadRetryToken'),
      setIsLoadingPDF: setter('setIsLoadingPDF'), setPdfLoadError: setter('setPdfLoadError'),
      setTimeout(callback, ms) { timer = { callback, ms, canceled: false }; return timer; },
      clearTimeout(value) { value.canceled = true; },
    };
    const cleanup = new Function(...Object.keys(scope), `return (${source.slice(watchdog.arguments[0].start, watchdog.arguments[0].end)});`)
      (...Object.values(scope))();
    assert.equal(timer.ms, 20000); cleanups.push(cleanup); return { timer, cleanup };
  };
  const run = () => {
    const taskRef = { current: null };
    const scope = {
      pdfFile: file, checkedBundle: bundle, user, pdfLoadScopeRef: scopeRef, pdfLoadScope: currentScope,
      loadRetryToken: state.setLoadRetryToken || 0, createDocumentPdfSource, isManagedLocalDocument,
      firstPagePaintAnalyticsRef: { current: {} }, pageRenderCacheRef: { current: new Map() }, lastScaleRef: { current: 1 }, scale: 1,
      pdfjsLib, pdfLibPort, taskRef, getPdfjsDocumentOptions: () => ({}), loadPdfjs: async () => {},
      trackSurveyAnalyticsEvent: () => {}, perfLoad: { start() {}, mark() {}, end() {} }, loadTrace: () => {}, appDebug: () => {},
      downloadFromStorage: async path => { downloads.push(path); return options.download ? options.download(path) : new Blob([bytes]); },
      loadSurveyDataFromSupabase: async () => {}, countUnsupportedAnnotations: async () => ({}),
      extractPdfOutlineBookmarks: async () => [], prepareManagedLocalBookmarks: value => value,
      importAnnotationsFromPdf: async (_pdf, config) => { imports.push({ ...config, rawPdfBytes: new Uint8Array(config.rawPdfBytes).slice() }); return {}; },
      splitImportedCalloutsFromPage: sourceObjects => ({ remainingObjects: sourceObjects, calloutEntries: [] }), normalizePageRegions: value => value,
      onUpdatePDFFile: async (...args) => { updates.push(args); }, tabId: 'owned-tab',
      console: { error: (...args) => events.push({ name: 'error', args }), warn: (...args) => events.push({ name: 'warn', args }), log() {} },
    };
    for (const name of new Set(source.slice(effect.start, effect.end).match(/\bset[A-Z]\w*/g))) scope[name] = setter(name);
    let body = source.slice(effect.arguments[0].start, effect.arguments[0].end);
    assert.equal((body.match(/\bloadPDF\(\);/g) || []).length, 1);
    body = body.replace(/\bloadPDF\(\);/, 'taskRef.current = loadPDF();')
      .replaceAll("import('pdf-lib')", 'Promise.resolve(pdfLibPort)');
    const cleanup = new Function(...Object.keys(scope), `return (${body});`)(...Object.values(scope))();
    assert.equal(typeof cleanup, 'function'); assert.ok(taskRef.current instanceof Promise);
    cleanups.push(cleanup); starts.push(taskRef.current); return { cleanup, done: taskRef.current };
  };
  t.after(async () => { for (const cleanup of cleanups) cleanup(); await Promise.allSettled(starts); });
  const loadDependencies = () => new Function('pdfFile', 'checkedBundle', 'pdfLoadActorUserId', 'loadRetryToken',
    `return ${source.slice(effect.arguments[1].start, effect.arguments[1].end)};`)(file, bundle, currentScope.actor, state.setLoadRetryToken);
  return { run, renderScope, loadDependencies, armWatchdog, pdf, plans, events, downloads, parses, rewrites, imports, updates, state,
    get scope() { return currentScope; }, get file() { return file; } };
}

test('local-only sign-in changes keep the same source, repair bytes, and load dependencies', t => {
  const h = harness(t, { file: blobFile({ id: undefined }) });
  const localScope = h.scope, renderBlob = new Blob([derived]);
  localScope.renderBlob = renderBlob;
  localScope.watchdogRetries = 1;
  const dependencies = h.loadDependencies();
  h.renderScope({ actor: 'ca000000-0000-4000-8000-000000000009' });
  assert.equal(h.scope, localScope);
  assert.equal(h.scope.renderBlob, renderBlob);
  assert.equal(h.scope.actor, null);
  assert.equal(h.scope.watchdogRetries, 1);
  assert.deepEqual(h.loadDependencies(), dependencies, 'Sign-in cannot reload and reimport a local-only PDF');
});

test('transferred primary parse failure reuses original Blob bytes without another Storage download', async t => {
  const h = harness(t, { file: { id, name: 'owned.pdf', filePath: `${id}/owned.pdf` }, plans: [new Error('primary parse failed'), { numPages: 1,
    getPage: async () => ({ getViewport: () => ({ width: 612, height: 792 }) }), destroy: async () => {} }] });
  await h.run().done;
  assert.deepEqual(h.downloads, [`${id}/owned.pdf`]); assert.equal(h.parses.length, 2);
  assert.ok(h.parses.every(item => item.detachedLength === 0));
  assert.deepEqual(h.parses[0].input, bytes); assert.deepEqual(h.parses[1].input, bytes);
  assert.equal(h.parses[0].destroys, 1); assert.equal(h.parses[1].destroys, 0);
  assert.equal(h.state.setNumPages, 1); assert.equal(h.state.setIsLoadingPDF, false);
  assert.equal(h.state.setPdfLoadError, null); assert.equal(h.updates.length, 0);
});

test('an id-bearing Blob without a Storage path still recovers after worker transfer', async t => {
  const h = harness(t, { plans: [new Error('primary failed'), { numPages: 1,
    getPage: async () => ({ getViewport: () => ({ width: 612, height: 792 }) }), destroy: async () => {} }] });
  await h.run().done;
  assert.equal(h.downloads.length, 0); assert.equal(h.parses.length, 2);
  assert.deepEqual(h.parses.map(item => item.input), [bytes, bytes]);
  assert.equal(h.state.setPdfLoadError, null); assert.equal(h.state.setNumPages, 1);
});

test('inner rewrite gives the local importer derived bytes but leaves the source Blob unchanged', async t => {
  const original = blobFile({ id: undefined, localId: `local:${id}`, _surveyPdfId: `local:${id}`, storageMode: 'local', _localDocumentState: {} });
  const h = harness(t, { file: original, plans: [new Error('primary failed'), new Error('recovery failed'), { numPages: 1,
    getPage: async () => ({ getViewport: () => ({ width: 612, height: 792 }) }), destroy: async () => {} }] });
  await h.run().done;
  assert.equal(h.parses.length, 3); assert.deepEqual(h.parses.map(item => item.input), [bytes, bytes, derived]);
  assert.deepEqual(h.parses.map(item => item.destroys), [1, 1, 0]);
  assert.deepEqual(h.rewrites[0].bytes, bytes); assert.deepEqual(h.rewrites[0].saves, [{ useObjectStreams: false }]);
  assert.deepEqual(h.imports[0].rawPdfBytes, derived); assert.equal(h.imports[0].diagnosticsOnly, true);
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes); assert.equal(h.updates.length, 0);
  assert.equal(h.state.setPdfLoadError, null);
});

test('page xref repair retries only in memory and never calls file publication', async t => {
  const h = harness(t, { file: { id, name: 'owned.pdf', filePath: `${id}/owned.pdf` } });
  h.plans.splice(0, 1, h.pdf({ pageError: new Error('xref page lookup failed') }), h.pdf());
  const first = h.run(); await first.done;
  assert.equal(h.updates.length, 0); assert.equal(h.state.setLoadRetryToken, 1);
  assert.ok(h.scope.renderBlob instanceof Blob); assert.deepEqual(new Uint8Array(await h.scope.renderBlob.arrayBuffer()), derived);
  assert.deepEqual(h.rewrites[0].bytes, bytes); assert.equal(h.downloads.length, 1);
  first.cleanup(); await h.run().done;
  assert.deepEqual(h.parses.map(item => item.input), [bytes, derived]);
  assert.equal(h.downloads.length, 1); assert.equal(h.rewrites.length, 1); assert.equal(h.updates.length, 0);
  assert.equal(h.state.setPdfLoadError, null); assert.equal(h.state.setIsLoadingPDF, false);
  assert.equal(h.file.__rewrittenForParse, undefined, 'The original file identity is not modified');
});

test('genuine checked bundle feeds primary and recovery without reading or downloading the mutable file', async t => {
  const checkedBundle = await issuedBundle(), file = blobFile({ filePath: 'do-not-download',
    arrayBuffer() { assert.fail('Checked PDF bytes must come from the issued bundle'); } });
  const h = harness(t, { file, checkedBundle });
  h.plans.splice(0, 1, new Error('primary failed'), h.pdf());
  await h.run().done;
  assert.deepEqual(h.parses.map(item => item.input), [bytes, bytes]);
  assert.equal(h.downloads.length, 0); assert.equal(h.updates.length, 0);
  assert.equal(h.state.setPdfLoadError, null); assert.equal(h.state.setNumPages, 1);
});

test('a failed derived page retry reports an error instead of rewriting or publishing again', async t => {
  const h = harness(t);
  h.plans.splice(0, 1, h.pdf({ pageError: new Error('xref failed') }), h.pdf({ pageError: new Error('xref failed again') }));
  const first = h.run(); await first.done; first.cleanup(); await h.run().done;
  assert.equal(h.rewrites.length, 1); assert.equal(h.state.setLoadRetryToken, 1);
  assert.equal(h.state.setPdfLoadError.kind, 'parse'); assert.equal(h.state.setPdfLoadError.message, 'xref failed again');
  assert.equal(h.updates.length, 0); assert.equal(h.parses.length, 2);
});

const changeScope = (h, kind) => h.renderScope(kind === 'file' ? { file: blobFile() }
  : kind === 'bundle' ? { bundle: {} } : { actor: 'ca000000-0000-4000-8000-000000000002' });
const uiEvents = h => h.events.filter(item => item.name.startsWith('set'));

for (const kind of ['file', 'bundle', 'actor']) test(`late parse after ${kind} changes cannot publish UI or start another parse`, async t => {
  const gate = deferred(), h = harness(t, { plans: [() => gate.promise] }), run = h.run();
  try {
    await until(() => h.parses.length === 1);
    changeScope(h, kind); const events = uiEvents(h).length;
    gate.resolve(h.pdf()); await run.done;
    assert.equal(uiEvents(h).length, events); assert.equal(h.parses.length, 1);
    assert.equal(h.parses[0].destroys, 1); assert.equal(h.updates.length, 0); assert.equal(h.rewrites.length, 0);
  } finally { gate.resolve(h.pdf()); }
});

for (const kind of ['file', 'bundle', 'actor']) for (const mode of ['inner', 'outer'])
  test(`late ${mode} rewrite after ${kind} changes cannot publish repair bytes or UI`, async t => {
    const gate = deferred(), h = harness(t, { rewriteSaveGate: gate });
    h.plans.splice(0, 1, ...(mode === 'inner' ? [new Error('primary failed'), new Error('recovery failed')]
      : [h.pdf({ pageError: new Error('xref page failed') })]));
    const staleScope = h.scope, run = h.run();
    try {
      await until(() => h.rewrites[0]?.saves.length === 1);
      changeScope(h, kind); const events = uiEvents(h).length, attempts = h.parses.length;
      gate.resolve(); await run.done;
      assert.equal(uiEvents(h).length, events); assert.equal(h.parses.length, attempts);
      assert.equal(staleScope.renderBlob, null); assert.equal(h.scope.renderBlob, null);
      assert.equal(h.updates.length, 0); assert.equal(h.state.setLoadRetryToken, 0);
    } finally { gate.resolve(); }
  });

for (const stage of ['primary', 'recovery', 'rewrite']) test(`cleanup destroys a pending ${stage} loading task exactly once`, async t => {
  const gate = deferred(), failures = stage === 'primary' ? [] : stage === 'recovery'
    ? [new Error('primary failed')] : [new Error('primary failed'), new Error('recovery failed')];
  const h = harness(t, { plans: [...failures, () => gate.promise] }), run = h.run();
  try {
    await until(() => h.parses.length === failures.length + 1);
    const events = uiEvents(h).length; run.cleanup(); await run.done;
    assert.ok(h.parses.every(item => item.destroys === 1));
    assert.equal(uiEvents(h).length, events); assert.equal(h.updates.length, 0);
    run.cleanup(); assert.ok(h.parses.every(item => item.destroys === 1), 'Repeated cleanup cannot destroy twice');
  } finally { gate.resolve(h.pdf()); }
});

test('an unresolved failed-task destroy cannot hold recovery or rendering open', async t => {
  const gate = deferred(), h = harness(t, { destroyGate: gate });
  h.plans.splice(0, 1, new Error('primary failed'), h.pdf()); const run = h.run();
  try {
    await until(() => h.parses.length === 2 && h.state.setIsLoadingPDF === false);
    await run.done;
    assert.equal(h.parses[0].destroys, 1); assert.equal(h.state.setNumPages, 1);
    assert.equal(h.state.setPdfLoadError, null); assert.equal(h.updates.length, 0);
  } finally { gate.resolve(); }
});

for (const kind of ['file', 'bundle', 'actor']) test(`an old watchdog after ${kind} changes cannot retry or alter UI`, async t => {
  const h = harness(t), oldScope = h.scope, watch = h.armWatchdog();
  changeScope(h, kind); const before = uiEvents(h).length;
  watch.timer.callback();
  assert.equal(uiEvents(h).length, before); assert.equal(oldScope.watchdogRetries, 0);
  assert.equal(h.scope.watchdogRetries, 0); watch.cleanup(); assert.equal(watch.timer.canceled, true);
});

test('watchdog gives each new actor scope two retries before reporting a stalled load', t => {
  const h = harness(t);
  for (let n = 0; n < 3; n++) { const watch = h.armWatchdog(); watch.timer.callback(); watch.cleanup(); }
  assert.equal(h.scope.watchdogRetries, 2); assert.equal(h.state.setLoadRetryToken, 2);
  assert.equal(h.state.setIsLoadingPDF, false); assert.match(h.state.setPdfLoadError.message, /too long to load/);
  changeScope(h, 'actor'); assert.equal(h.scope.watchdogRetries, 0);
  const before = uiEvents(h).length;
  for (let n = 0; n < 2; n++) { const watch = h.armWatchdog(); watch.timer.callback(); watch.cleanup(); }
  assert.equal(h.scope.watchdogRetries, 2); assert.equal(h.state.setLoadRetryToken, 4);
  assert.deepEqual(uiEvents(h).slice(before).map(item => item.name), ['setLoadRetryToken', 'setLoadRetryToken']);
});
