import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { prepareCheckedDocumentOpen } from '../src/services/checkedDocumentOpen.js';
import { readCheckedDocumentViewState, writeCheckedDocumentViewState } from '../src/services/checkedDocumentViewStateStore.js';
import { getDocumentOpenKey, isSameDocumentTab } from '../src/utils/documentTabIdentity.js';

const shell = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const pdfjsContainer = await readFile(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
const id = value => `dd000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const actor = id(1), documentId = id(2), generationA = id(3), generationB = id(4);
const view = Object.freeze({ pageNum: 7, scale: 1.375, zoomMode: 'manual', scrollMode: 'continuous',
  scrollLeft: 41, scrollTop: 902 });
const normalizeViewState = value => value;
const areViewStatesEqual = (left, right) => left != null && right != null
  && Object.keys(view).every(key => left[key] === right[key]);

class MemoryStorage {
  constructor() { this.values = new Map(); this.failWrites = false; this.failReads = 0; }
  getItem(key) {
    if (this.failReads > 0) { this.failReads--; throw new Error('read blocked'); }
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    if (this.failWrites) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    this.values.set(key, String(value));
  }
  removeItem(key) { this.values.delete(key); }
}

async function checkedBundle(actorUserId = actor, pdfGenerationId = generationA) {
  const bytes = new TextEncoder().encode('%PDF-1.7\nview state\n');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const path = `${actorUserId}/_generations/${pdfGenerationId}.pdf`;
  const manifest = { version: 1, actor_user_id: actorUserId, document_id: documentId,
    generation_id: pdfGenerationId,
    document: { id: documentId, user_id: actorUserId, project_id: null, name: 'View.pdf',
      file_path: path, file_size: String(bytes.length) },
    pdf: { bucket_id: 'documents', path, id: id(20), version: id(21), byte_length: String(bytes.length),
      content_sha256: hash(bytes) },
    publication: { operation_id: id(22), generation_id: pdfGenerationId,
      published_at: '2026-09-15T00:00:00Z', wal_head: '0' },
    annotations: { version: 2, document_id: documentId, generation_id: pdfGenerationId, wal_head: '0',
      snapshot: { at_seq: '0', snapshot: '\\x0000', encoding_version: 1, writer_id: null, writer_epoch: '0' },
      snapshot_sha256: hash(new Uint8Array([0, 0])) } };
  const reader = createDocumentGenerationReader({ getActorUserId: () => actorUserId,
    request: async (_name, params) => {
      const data = structuredClone(manifest);
      if (!params.p_include_snapshot) { data.annotations.snapshot = null; data.annotations.snapshot_sha256 = null; }
      return { data };
    }, download: async () => new Blob([bytes]) });
  return reader.open({ documentId, actorUserId, pdfGenerationId });
}

function extract(startText, endText, ports, source = shell) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `execute ${startText}`);
  const name = startText.match(/const (\w+)/)?.[1];
  return Function(...Object.keys(ports), `${source.slice(start, end)}\nreturn ${name};`)(...Object.values(ports));
}

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

function runViewerDocumentLoad({ initialViewState = null, pendingRestore = null } = {}) {
  const calls = { page: [], scale: [], mode: [], restores: [] };
  const checkedBundleIdentity = {}, pdfFileIdentity = {};
  const checkedViewStateRenderIdentityRef = { current: {
    checkedBundle: checkedBundleIdentity,
    pdfFile: pdfFileIdentity,
  } };
  const pdfjsViewStateRestoreRef = { current: null };
  const viewerPort = { getPageCount: () => 3, getZoomValue: () => 187, getCurrentPage: () => 1,
    queueViewStateRestore: (target, onCommitted) => {
      calls.restores.push({ target, onCommitted }); return calls.restores.length;
    } };
  const ref = current => ({ current });
  const ports = {
    useCallback: callback => callback, initialViewState, normalizeViewState,
    pdfjsViewerRef: ref(viewerPort), pdfjsViewStateRestoreRef,
    checkedViewStateRenderIdentityRef,
    pendingManualZoomBeforeLoadRef: ref(null),
    pdfjsDocumentReadyRef: ref(false), pdfjsPagePdfEverReadyRef: ref(null),
    coercePageNumber: value => Number.isSafeInteger(Number(value)) && Number(value) >= 1 ? Number(value) : null,
    setNumPages: () => {}, pendingRendererRestoreRef: ref(pendingRestore), clampScale: value => value,
    scaleRef: ref(1), setScale: value => calls.scale.push(value), setManualZoomScale: () => {},
    zoomModeRef: ref('fitPage'), setZoomMode: value => calls.mode.push(value), setRenderedPages: () => {},
    pdfjsElectronFactorRef: ref(null), pendingInitialFitPageRef: ref(false), cancelInitialFitPageRef: ref(() => {}),
    initialFitPageTimersRef: ref([]), handleZoomModeSelectRef: ref(null),
    reconcilePdfjsScaleFromRenderedPage: () => null, requestAnimationFrame: callback => { callback(); return 1; },
    setTimeout: callback => { callback(); return 1; }, pdfjsZoomSourceRef: ref(null),
    setPageNum: value => calls.page.push(value), setPageInputValue: () => {}, setIsPageInputDirty: () => {},
    emitPdfDebugEvent: () => {}, debugMark: () => {}, bindPdfjsViewerRefs: () => {},
    queuePdfjsPageContainerRefresh: () => {}, ZOOM_MODES: { FIT_PAGE: 'fitPage', MANUAL: 'manual' },
  };
  const load = extract('const handlePdfjsDocumentLoad =', '\n  const handlePdfjsDocumentLoadFailed =', ports, viewer);
  load({ pageCount: 3, zoomValue: 187, currentPageNumber: 1 });
  calls.checkedViewStateRenderIdentityRef = checkedViewStateRenderIdentityRef;
  calls.pdfjsViewStateRestoreRef = pdfjsViewStateRestoreRef;
  return calls;
}

function harness({ storage = new MemoryStorage(), actorUserId = actor, initialTabs = [] } = {}) {
  const scope = { actorUserId }, scopeRef = { current: scope };
  const mount = {}, mountRef = { current: mount };
  const state = { tabs: initialTabs, selected: null, active: null, view: 'dashboard', loading: false };
  const closeViewRef = { current: { tabs: state.tabs, activeTabId: state.active } };
  const toasts = [];
  const set = key => update => {
    state[key] = typeof update === 'function' ? update(state[key]) : update;
    closeViewRef.current = { tabs: state.tabs, activeTabId: state.active };
  };
  const common = () => ({
    activeTabId: state.active, checkedDocumentViewStateStorage: storage, closeViewRef,
    documentOpenScope: scope, documentOpenScopeRef: scopeRef, documentOpenMountRef: mountRef,
    normalizeViewState, areViewStatesEqual,
    readCheckedDocumentViewState, writeCheckedDocumentViewState,
    setTabs: set('tabs'), showToast: (...args) => toasts.push(args), useCallback: callback => callback,
  });
  const makeViewHandler = () => extract('const handleViewStateChange =', '\n  // Memoized callback to track unsaved annotations', common());
  const select = bundle => {
    const handleViewStateChange = makeViewHandler();
    return extract('const handleDocumentSelect =', '  // DEV-ONLY: Auto-open test PDF', {
      ...common(), tabs: state.tabs, selectedPDF: state.selected,
      openingPdfsRef: { current: new Set() },
      prepareCheckedDocumentOpen, getDocumentOpenKey, isSameDocumentTab,
      checkedPageStructureStorage: storage,
      readLocalCheckedPageStructure: () => ({ items: {}, annotations: {}, pageNames: {}, bookmarks: [],
        pageTransformations: {}, activeSpaceId: null, regionOverlayDisabled: {} }),
      handleViewStateChange, generateTabId: () => `tab-${state.tabs.length + 1}`,
      setSelectedPDF: set('selected'), setActiveTabId: set('active'), setCurrentView: set('view'),
      setIsLoading: set('loading'), setTimeout: callback => callback(),
    })(null, null, bundle);
  };
  const activate = doc => extract('const handleActivateOpenDocument =', '\n  const handleDocumentSelect =', {
    ...common(), tabs: state.tabs, documents: [doc], dashboardRef: { current: null },
    isSameDocumentTab, returnToDevHubPreview: () => false,
    setSelectedPDF: set('selected'), setActiveTabId: set('active'), setCurrentView: set('view'),
  })(doc);
  return { state, storage, scope, scopeRef, mount, mountRef, toasts, select, activate };
}

test('checked view survives a cold AppShell route reopen with all six fields', async () => {
  const storage = new MemoryStorage(), bundle = await checkedBundle();
  const first = harness({ storage });
  first.select(bundle);
  first.state.tabs[0].viewStateChangeHandler(view, first.state.tabs[0].id);
  assert.deepEqual(first.state.tabs[0].viewState, view);

  const reopened = harness({ storage });
  reopened.select(bundle);
  assert.deepEqual(reopened.state.tabs[0].viewState, view);
});

test('checked view is private to the exact actor and PDF generation', async () => {
  const storage = new MemoryStorage();
  writeCheckedDocumentViewState({ storage, actorUserId: actor, documentId, pdfGenerationId: generationA }, view);
  const otherActor = harness({ storage, actorUserId: id(9) });
  otherActor.select(await checkedBundle(id(9), generationA));
  assert.equal(otherActor.state.tabs[0].viewState, null);
  const nextGeneration = harness({ storage });
  nextGeneration.select(await checkedBundle(actor, generationB));
  assert.equal(nextGeneration.state.tabs[0].viewState, null);
});

test('old checked callback cannot write after the tab advances to another generation', async () => {
  const storage = new MemoryStorage(), firstBundle = await checkedBundle();
  const app = harness({ storage });
  app.select(firstBundle);
  const stale = app.state.tabs[0].viewStateChangeHandler;
  const nextBundle = await checkedBundle(actor, generationB);
  const prepared = prepareCheckedDocumentOpen(nextBundle, actor);
  app.state.tabs[0] = { ...app.state.tabs[0], file: prepared.file, checkedBundle: nextBundle, viewState: null };
  stale(view, app.state.tabs[0].id);
  assert.equal(readCheckedDocumentViewState({ storage, actorUserId: actor, documentId,
    pdfGenerationId: generationA }), null);
  assert.equal(readCheckedDocumentViewState({ storage, actorUserId: actor, documentId,
    pdfGenerationId: generationB }), null);
  assert.equal(app.state.tabs[0].viewState, null);
});

test('quota failure keeps the live view and the same state retries on the next report', async () => {
  const storage = new MemoryStorage(), app = harness({ storage });
  app.select(await checkedBundle());
  const tab = app.state.tabs[0];
  storage.failWrites = true;
  tab.viewStateChangeHandler(view, tab.id);
  assert.deepEqual(app.state.tabs[0].viewState, view);
  assert.equal(app.state.tabs[0].viewStatePersistenceError, 'CHECKED_DOCUMENT_VIEW_STATE_WRITE_FAILED');
  assert.equal(app.toasts.length, 1);
  storage.failWrites = false;
  app.state.tabs[0].viewStateChangeHandler(view, tab.id);
  assert.equal(app.state.tabs[0].viewStatePersistenceError, null);
  assert.deepEqual(readCheckedDocumentViewState({ storage, actorUserId: actor, documentId,
    pdfGenerationId: generationA }), view);
});

test('retained checked handler cannot write after sign-out, actor switch, ABA, or unmount', async () => {
  const storage = new MemoryStorage(), app = harness({ storage });
  app.select(await checkedBundle());
  const tab = app.state.tabs[0], retained = tab.viewStateChangeHandler;
  const before = [...storage.values.entries()];
  for (const retired of [{ actorUserId: id(9) }, { actorUserId: actor }, null]) {
    app.scopeRef.current = retired;
    if (retired === null) app.mountRef.current = null;
    retained(view, tab.id);
    assert.equal(app.state.tabs[0].viewState, null);
    assert.deepEqual([...storage.values.entries()], before);
  }
});

test('fresh same-actor scope cannot revive an old checked tab and a new checked open binds a writable tab', async () => {
  const storage = new MemoryStorage(), original = harness({ storage });
  const bundle = await checkedBundle();
  original.select(bundle);
  const retiredTab = original.state.tabs[0], retiredHandler = retiredTab.viewStateChangeHandler;
  original.scopeRef.current = { actorUserId: id(9) };
  original.scopeRef.current = { actorUserId: actor };
  retiredHandler(view, retiredTab.id);
  assert.equal(retiredTab.viewState, null);

  const fresh = harness({ storage, initialTabs: [retiredTab] });
  assert.equal(fresh.activate({ id: documentId }), false);
  fresh.select(bundle);
  assert.equal(fresh.state.tabs.length, 2);
  assert.notEqual(fresh.state.tabs[1].documentOpenScope, retiredTab.documentOpenScope);
  fresh.state.tabs[1].viewStateChangeHandler(view, fresh.state.tabs[1].id);
  assert.deepEqual(fresh.state.tabs[1].viewState, view);
  assert.deepEqual(readCheckedDocumentViewState({ storage, actorUserId: actor, documentId,
    pdfGenerationId: generationA }), view);
});

test('a transient checked read failure cannot overwrite recovered raw with viewer defaults', async () => {
  const storage = new MemoryStorage();
  writeCheckedDocumentViewState({ storage, actorUserId: actor, documentId,
    pdfGenerationId: generationA }, view);
  const exactRaw = [...storage.values.values()][0];
  storage.failReads = 1;
  const failed = harness({ storage });
  failed.select(await checkedBundle());
  assert.equal(failed.state.tabs[0].viewStatePersistenceError, 'CHECKED_DOCUMENT_VIEW_STATE_READ_FAILED');
  const defaults = { pageNum: 1, scale: 1, zoomMode: 'fitPage', scrollMode: 'continuous',
    scrollLeft: 0, scrollTop: 0 };
  failed.state.tabs[0].viewStateChangeHandler(defaults, failed.state.tabs[0].id);
  assert.equal([...storage.values.values()][0], exactRaw);
  assert.equal(failed.state.tabs[0].viewStatePersistenceError, 'CHECKED_DOCUMENT_VIEW_STATE_READ_FAILED');
  const reopened = harness({ storage });
  reopened.select(await checkedBundle());
  assert.deepEqual(reopened.state.tabs[0].viewState, view);
});

test('actual PDF document-load callback applies the cold-reopened page, scale and zoom mode', () => {
  const calls = runViewerDocumentLoad({ initialViewState: { ...view, pageNum: 3, scale: 1.25 } });
  assert.equal(calls.page.at(-1), 3);
  assert.equal(calls.scale.at(-1), 1.25);
  assert.equal(calls.mode.at(-1), 'manual');
  assert.deepEqual(calls.restores.map(entry => entry.target), [
    { pageNum: 3, scale: 1.25, scrollLeft: 41, scrollTop: 902 },
  ]);
});

test('a delayed old renderer ack cannot unlock or mutate a replacement generation', () => {
  const calls = runViewerDocumentLoad({ initialViewState: { ...view, pageNum: 3, scale: 1.25 } });
  const oldAck = calls.restores[0].onCommitted;
  calls.checkedViewStateRenderIdentityRef.current = { checkedBundle: {}, pdfFile: {} };
  const pageCallsBeforeAck = calls.page.slice();
  oldAck({ pageNum: 3, scale: 1.25, scrollLeft: 41, scrollTop: 902 });
  assert.equal(calls.pdfjsViewStateRestoreRef.current.requestId, 1);
  assert.deepEqual(calls.page, pageCallsBeforeAck);

  const newerGate = { token: {}, requestId: 2 };
  calls.pdfjsViewStateRestoreRef.current = newerGate;
  oldAck({ pageNum: 3, scale: 1.25, scrollLeft: 41, scrollTop: 902 });
  assert.equal(calls.pdfjsViewStateRestoreRef.current, newerGate);
  assert.deepEqual(calls.page, pageCallsBeforeAck);
});

test('renderer handoff wins over saved initial state and a plain open keeps its default', () => {
  const pending = { ...view, targetMode: 'continuous', pageNum: 2, scale: 0.8, zoomMode: 'fitPage' };
  const handedOff = runViewerDocumentLoad({ initialViewState: view, pendingRestore: pending });
  assert.equal(handedOff.page.at(-1), 2);
  assert.equal(handedOff.scale.at(-1), 0.8);
  assert.equal(handedOff.mode.at(-1), 'fitPage');
  const plain = runViewerDocumentLoad();
  assert.equal(plain.page.at(-1), 1);
  assert.equal(plain.scale.at(-1), 1.87);
  assert.equal(plain.mode.at(-1), 'fitPage');
});

test('checked emitter waits for page geometry proof and cancels an unsettled close', () => {
  const tree = parse(viewer, { sourceType: 'module', plugins: ['jsx'] });
  const effect = findNode(tree, node => node.type === 'CallExpression' && node.callee?.name === 'useEffect'
    && viewer.slice(node.start, node.end).includes('getPageContainer?.(pageNum)'));
  assert.ok(effect, 'execute the checked view-state emit effect');
  const emitted = [], timers = new Map(); let timerId = 0;
  const container = new EventTarget();
  container.scrollLeft = 0; container.scrollTop = 0;
  container.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 500 });
  let pageRect = { top: 900, bottom: 1400, left: 0, right: 500 };
  const pageHost = { getBoundingClientRect: () => pageRect };
  container.querySelector = () => pageHost;
  const scope = {
    onViewStateChange: state => emitted.push(state), containerRef: { current: container },
    normalizeViewState, pageNum: 3, scale: 1.25, zoomMode: 'manual', scrollMode: 'continuous',
    skipNextViewStateEmitRef: { current: false }, lastViewStateEmittedRef: { current: null },
    pdfjsViewStateRestoreRef: { current: null },
    areViewStatesEqual, tabId: 'tab-a', checkedBundle: {}, usePdfjsRenderer: true,
    pdfjsViewerRef: { current: { getPageContainer: () => pageHost } },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const callback = Function(...Object.keys(scope), `return (${viewer.slice(
    effect.arguments[0].start, effect.arguments[0].end,
  )});`)(...Object.values(scope));
  const cleanup = callback();
  assert.deepEqual(emitted, []);
  container.dispatchEvent(new Event('scroll'));
  cleanup();
  assert.equal(timers.size, 0);

  const nextCleanup = callback();
  pageRect = { top: 25, bottom: 475, left: 0, right: 500 };
  container.scrollTop = 900;
  container.dispatchEvent(new Event('scroll'));
  for (const pending of [...timers.values()]) pending();
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].pageNum, 3);
  assert.equal(emitted[0].scrollTop, 900);
  nextCleanup();
});

test('checked emitter stays silent through all pre-ack events then resumes after exact ack', () => {
  const tree = parse(viewer, { sourceType: 'module', plugins: ['jsx'] });
  const effect = findNode(tree, node => node.type === 'CallExpression' && node.callee?.name === 'useEffect'
    && viewer.slice(node.start, node.end).includes('getPageContainer?.(pageNum)'));
  const emitted = [], timers = [];
  const container = new EventTarget();
  container.scrollLeft = 0; container.scrollTop = 0;
  container.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 500 });
  const pageHost = { getBoundingClientRect: () => ({ top: 20, bottom: 480, left: 0, right: 500 }) };
  const restoreRef = { current: { token: {}, requestId: 1 } };
  const lastEmitted = { current: null };
  const scope = {
    onViewStateChange: state => emitted.push(state), containerRef: { current: container },
    normalizeViewState, pageNum: 1, scale: 1.87, zoomMode: 'fitPage', scrollMode: 'continuous',
    skipNextViewStateEmitRef: { current: false }, lastViewStateEmittedRef: lastEmitted,
    pdfjsViewStateRestoreRef: restoreRef, areViewStatesEqual, tabId: 'tab-a',
    checkedBundle: {}, usePdfjsRenderer: true,
    pdfjsViewerRef: { current: { getPageContainer: () => pageHost } },
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout: () => {},
  };
  const callback = Function(...Object.keys(scope), `return (${viewer.slice(
    effect.arguments[0].start, effect.arguments[0].end,
  )});`)(...Object.values(scope));
  const cleanup = callback();
  container.dispatchEvent(new Event('scroll'));
  container.dispatchEvent(new Event('scroll'));
  timers.splice(0).forEach(run => run());
  assert.deepEqual(emitted, []);
  assert.equal(lastEmitted.current, null);

  const acknowledged = { pageNum: 2, scale: 1.25, zoomMode: 'manual', scrollMode: 'continuous',
    scrollLeft: 0, scrollTop: 1030 };
  cleanup();
  restoreRef.current = null;
  lastEmitted.current = acknowledged;
  scope.pageNum = 2;
  scope.scale = 1.25;
  scope.zoomMode = 'manual';
  container.scrollTop = 1030;
  const acknowledgedCallback = Function(...Object.keys(scope), `return (${viewer.slice(
    effect.arguments[0].start, effect.arguments[0].end,
  )});`)(...Object.values(scope));
  const acknowledgedCleanup = acknowledgedCallback();
  container.scrollTop = 1100;
  container.dispatchEvent(new Event('scroll'));
  timers.splice(0).forEach(run => run());
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].scrollTop, 1100);
  acknowledgedCleanup();
});

test('owned renderer waits for real target metadata then restores exact or page-safe scroll once', () => {
  const tree = parse(pdfjsContainer, { sourceType: 'module', plugins: ['jsx'] });
  const resolver = findNode(tree, node => node.type === 'FunctionDeclaration'
    && node.id?.name === 'resolvePdfjsPageAtViewport');
  const effect = findNode(tree, node => node.type === 'CallExpression' && node.callee?.name === 'useLayoutEffect'
    && pdfjsContainer.slice(node.start, node.end).includes('pendingViewStateRestoreRef.current'));
  assert.ok(resolver && effect, 'execute the renderer-owned restore path');
  const resolvePdfjsPageAtViewport = Function(`return (${pdfjsContainer.slice(resolver.start, resolver.end)})`)();
  const layout = { padTop: 0, tops: [40, 1050, 2060], dims: [
    { w: 612, h: 792 }, { w: 612, h: 792 }, { w: 612, h: 792 },
  ], totalH: 3070 };
  const scroller = { clientWidth: 800, clientHeight: 500, scrollHeight: 3070,
    scrollLeft: 0, scrollTop: 0 };
  const measuredPageNumbersRef = { current: new Set([1]) };
  const documentLoadEpochRef = { current: 7 };
  const committed = [], navigated = [];
  const pendingViewStateRestoreRef = { current: {
    documentLoadEpoch: 7,
    target: { pageNum: 2, scale: 1.25, scrollLeft: 0, scrollTop: 1030 },
    onCommitted: value => committed.push(value),
  } };
  const detectCurrentPage = () => resolvePdfjsPageAtViewport({
    scrollTop: scroller.scrollTop, clientHeight: scroller.clientHeight, padTop: layout.padTop,
    tops: layout.tops, dims: layout.dims, scale: 1.25, gap: 16,
  });
  const ports = { pendingViewStateRestoreRef, scrollerRef: { current: scroller },
    contentRef: { current: {} }, documentLoadEpochRef, numPages: 3, layout, scale: 1.25,
    measuredPageNumbersRef, getPageHorizontalScrollMax: () => 0, detectCurrentPage,
    goToPage: page => { navigated.push(page); scroller.scrollTop = layout.tops[page - 1] - 20; return true; },
    recomputeWindow: () => {},
  };
  const callback = Function(...Object.keys(ports), `return (${pdfjsContainer.slice(
    effect.arguments[0].start, effect.arguments[0].end,
  )});`)(...Object.values(ports));
  callback();
  assert.deepEqual(committed, [], 'page-1 placeholder is not page-2 readiness');
  assert.equal(scroller.scrollTop, 0);
  measuredPageNumbersRef.current.add(2);
  callback();
  assert.deepEqual(navigated, []);
  assert.deepEqual(committed, [{ pageNum: 2, scale: 1.25, scrollLeft: 0, scrollTop: 1030 }]);
  callback();
  assert.equal(committed.length, 1, 'ack consumes the queued restore');

  pendingViewStateRestoreRef.current = { documentLoadEpoch: 7,
    target: { pageNum: 2, scale: 1.25, scrollLeft: 0, scrollTop: 0 },
    onCommitted: value => committed.push(value) };
  scroller.scrollTop = 0;
  callback();
  assert.deepEqual(navigated, [2]);
  assert.equal(committed.at(-1).pageNum, 2);
  assert.equal(committed.at(-1).scrollTop, 1030);
});
