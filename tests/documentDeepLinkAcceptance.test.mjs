import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import { getDocumentOpenKey, isSameDocumentTab } from '../src/utils/documentTabIdentity.js';
import { prepareCheckedDocumentOpen } from '../src/services/checkedDocumentOpen.js';

const source = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const result = find(child, predicate);
      if (result) return result;
    }
  }
  return null;
}
const selection = find(ast, n => n.type === 'VariableDeclarator' && n.id.name === 'handleDocumentSelect').init;
const effect = find(ast, n => n.type === 'CallExpression' && n.callee.name === 'useEffect'
  && source.slice(n.start, n.end).includes('const deepLinkDocumentId = deepLinkDocumentIdRef.current;')).arguments[0];
function compile(node, ports) {
  return Function(...Object.keys(ports), `return (${source.slice(node.start, node.end).replaceAll('import.meta.env.DEV', 'false')});`)(...Object.values(ports));
}
function harness() {
  const row = { id: 'document-a', name: 'Plan.pdf', file_path: 'owner/plan.pdf' };
  const scope = { actorUserId: 'actor-a' };
  const state = { tabs: [], selected: null, active: null, view: null, loading: false, toasts: [], history: [], timers: [] };
  const set = key => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const closeViewRef = { current: { tabs: state.tabs } };
  const ports = {
    documents: [row], tabs: state.tabs, selectedPDF: null,
    closeViewRef,
    documentOpenScope: scope, documentOpenScopeRef: { current: scope },
    deepLinkDocumentIdRef: { current: row.id }, openingPdfsRef: { current: new Set() },
    getDocumentOpenKey, isSameDocumentTab, prepareCheckedDocumentOpen,
    generateTabId: () => 'tab-a', setTabs: set('tabs'), setSelectedPDF: set('selected'),
    setActiveTabId: set('active'), setCurrentView: set('view'), setIsLoading: set('loading'),
    setTimeout: fn => state.timers.push(fn), showToast: (...args) => state.toasts.push(args),
    window: { location: { href: 'https://survey.test/app?docId=document-a&panel=notes#saved' },
      history: { state: { navigationId: 'owned-state' }, replaceState: (...args) => state.history.push(args) } },
  };
  ports.handleDocumentSelect = compile(selection, ports);
  ports.handleOpenCloudDocument = async document => {
    closeViewRef.current = { tabs: state.tabs };
    if (ports.handleDocumentSelect(document, document.file_path) !== true) throw new Error('busy');
    return true;
  };
  return { row, state, ports, run: async () => {
    const cleanup = compile(effect, ports)();
    await new Promise(setImmediate); await new Promise(setImmediate);
    return cleanup;
  } };
}

test('a deep link is consumed only after the actual selection accepts its tab', async () => {
  const h = harness(); await h.run();
  assert.equal(h.state.tabs.length, 1);
  assert.equal(h.state.tabs[0].file, h.row);
  assert.equal(h.state.tabs[0].filePath, h.row.file_path);
  assert.equal(h.state.active, 'tab-a');
  assert.equal(h.ports.deepLinkDocumentIdRef.current, null);
  assert.deepEqual(h.state.history, [[h.ports.window.history.state, '', '/app?panel=notes#saved']]);
  assert.deepEqual(h.state.toasts, []);
});

test('a missing list row retains the pending link without opening anything', async () => {
  const h = harness(); h.ports.documents = []; await h.run();
  assert.equal(h.ports.deepLinkDocumentIdRef.current, 'document-a');
  assert.deepEqual(h.state.tabs, []); assert.deepEqual(h.state.history, []);
});

test('a stale account scope cannot consume a link or publish its file', async () => {
  const h = harness(); h.ports.documentOpenScopeRef.current = { actorUserId: 'actor-b' }; await h.run();
  assert.equal(h.ports.deepLinkDocumentIdRef.current, 'document-a');
  assert.deepEqual(h.state.tabs, []); assert.deepEqual(h.state.history, []);
  assert.deepEqual(h.state.toasts, []);
});

test('a busy open retains the link and a later accepted retry clears it', async () => {
  const h = harness(); h.ports.openingPdfsRef.current.add(getDocumentOpenKey(h.row)); await h.run();
  assert.equal(h.ports.deepLinkDocumentIdRef.current, 'document-a');
  assert.deepEqual(h.state.history, []);
  h.ports.openingPdfsRef.current.clear(); await h.run();
  assert.equal(h.state.tabs.length, 1); assert.equal(h.state.history.length, 1);
  assert.equal(h.ports.deepLinkDocumentIdRef.current, null);
});

test('a generation-marked row without issued proof fails closed and retains its link for retry', async () => {
  const h = harness(); h.row.pdfGenerationId = 'unverified-generation';
  await h.run();
  assert.equal(h.ports.deepLinkDocumentIdRef.current, 'document-a');
  assert.deepEqual(h.state.tabs, []); assert.deepEqual(h.state.history, []);
  assert.equal(h.state.toasts.length, 1);
  assert.match(h.state.toasts[0][0], /link and your saved work were kept/);
});

test('an unexpected open rejection does not leak its diagnostics or crash the effect', async () => {
  const h = harness(); h.ports.handleDocumentSelect = () => { throw new Error('SECRET provider diagnostic'); };
  await h.run();
  assert.equal(h.ports.deepLinkDocumentIdRef.current, 'document-a');
  assert.deepEqual(h.state.history, []);
  assert.doesNotMatch(JSON.stringify(h.state.toasts), /SECRET|provider diagnostic/);
});

test('selecting an existing tab reports acceptance without rebuilding its file', () => {
  const h = harness(); const file = new File(['existing'], 'Plan.pdf'); file.id = h.row.id;
  h.ports.tabs = [{ id: 'existing-tab', actorUserId: 'actor-a', file }];
  h.ports.closeViewRef.current = { tabs: h.ports.tabs };
  const select = compile(selection, h.ports);
  assert.equal(select(h.row), true);
  assert.equal(h.state.selected, file); assert.equal(h.state.active, 'existing-tab');
  assert.deepEqual(h.state.tabs, []);
});
