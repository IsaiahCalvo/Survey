import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';

const source = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const tree = parse(source, { sourceType:'module',plugins:['jsx'] });
const id = n => `ca000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = find(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

const declaration = find(tree, node => node.type === 'VariableDeclarator'
  && node.id?.name === 'handleFirstGenerationAdoption');
assert.ok(declaration, 'test the real AppShell adoption route');
const callbackSource = source.slice(declaration.init.arguments[0].start,
  declaration.init.arguments[0].end);

function routeHarness() {
  const actor = id(1), documentId = id(2), generationId = id(3), tabId = 'tab-legacy';
  const scope = { actorUserId:actor }, file = { id:documentId,name:'legacy.pdf' };
  const tab = { id:tabId,actorUserId:actor,file,checkedBundle:null,documentOpenScope:scope };
  const closeViewRef = { current:{ activeTabId:tabId,tabs:[tab] } };
  const documentOpenScopeRef = { current:scope }, mount = {};
  const documentOpenMountRef = { current:mount };
  let selected = file;
  const checkedBundle = { pdfGenerationId:generationId };
  const preparedFile = { id:documentId,name:'legacy.pdf',__checked:true };
  const client = { review:async input => {
    const installed = await input.install({ opened:{ checkedBundle } });
    return { installed };
  } };
  const firstGenerationAdoptionClientRef = { current:{ scope,mount,client } };
  const handler = Function('useCallback','firstGenerationAdoptionClientRef','closeViewRef',
    'documentOpenScopeRef','documentOpenMountRef','prepareCheckedDocumentOpen','flushSync',
    'setTabs','setSelectedPDF',`return (${callbackSource});`)(callback => callback,
    firstGenerationAdoptionClientRef,closeViewRef,documentOpenScopeRef,documentOpenMountRef,
    () => ({ file:preparedFile,pdfGenerationId:generationId }),callback => callback(),
    updater => { closeViewRef.current.tabs = updater(closeViewRef.current.tabs); },
    updater => { selected = updater(selected); });
  return { actor,documentId,generationId,tabId,scope,file,checkedBundle,preparedFile,
    closeViewRef,documentOpenScopeRef,handler,selected:() => selected };
}

test('exact active legacy tab installs the reacquired checked bundle in place', async () => {
  const h = routeHarness();
  const result = await h.handler('review', {}, h.tabId, h.file, null, h.scope);
  assert.equal(result.installed, true);
  assert.equal(h.closeViewRef.current.tabs[0].file, h.preparedFile);
  assert.equal(h.closeViewRef.current.tabs[0].checkedBundle, h.checkedBundle);
  assert.equal(h.selected(), h.preparedFile);
});

test('retired actor, tab, file, or checked state cannot run or install an upgrade', async () => {
  for (const change of ['actor','tab','file','checked']) {
    const h = routeHarness();
    if (change === 'actor') h.documentOpenScopeRef.current = { actorUserId:id(9) };
    if (change === 'tab') h.closeViewRef.current.activeTabId = 'other';
    if (change === 'file') h.closeViewRef.current.tabs[0] = { ...h.closeViewRef.current.tabs[0],file:{} };
    if (change === 'checked') h.closeViewRef.current.tabs[0] = {
      ...h.closeViewRef.current.tabs[0],checkedBundle:{} };
    await assert.rejects(h.handler('review', {}, h.tabId, h.file, null, h.scope),
      /upgrade is not available/i);
    assert.equal(h.selected(), h.file);
  }
});

test('AppShell keeps first-generation adoption opt-in and passes exact tab scope', () => {
  assert.match(source, /documentFirstGenerationAdoptionEnabled = false/);
  assert.match(source, /firstGenerationAdoptionScope=\{tab\.documentOpenScope\}/);
  assert.match(source, /onFirstGenerationAdoption=\{documentFirstGenerationAdoptionEnabled/);
  assert.doesNotMatch(source, /VITE_[A-Z_]*FIRST_GENERATION_ADOPTION/);
});
