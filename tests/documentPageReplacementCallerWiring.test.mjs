import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import { sameDefinitionRevisionReference }
  from '../src/hooks/useDocumentDefinitionRevisions.js';

const viewerSource = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const viewerTree = parse(viewerSource, { sourceType:'module',plugins:['jsx'] });
const appSource = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const appTree = parse(appSource, { sourceType:'module',plugins:['jsx'] });

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) for (const child of Array.isArray(value) ? value : [value]) {
    const found = find(child, predicate); if (found) return found;
  }
  return null;
}

function callback(name, scope) {
  const source = scope.__source || viewerSource;
  const tree = scope.__tree || viewerTree;
  delete scope.__source; delete scope.__tree;
  const declaration = find(tree, node => node.type === 'VariableDeclarator'
    && node.id?.name === name && node.init?.type === 'CallExpression');
  assert.ok(declaration, `missing production ${name}`);
  const fn = declaration.init.arguments[0];
  return Function(...Object.keys(scope), `return (${source.slice(fn.start, fn.end)});`)(
    ...Object.values(scope));
}

test('AppShell resolves injected legacy transport behind the page flag', () => {
  const injectedTransport = async () => null;
  const window = { location:{ href:'https://surveytool.app/' } };
  let calls = 0;
  const resolveDocumentPageReplacementTransport = input => {
    calls++; assert.deepEqual(input, { injectedTransport,window }); return injectedTransport;
  };
  const make = checkedPageReplacementEnabled => callback('resolvedDocumentReplacementTransport', {
    __source:appSource,__tree:appTree,checkedPageReplacementEnabled,documentReplacementTransport:injectedTransport,
    documentDefinitionRevisionsEnabled:false,resolveDocumentPageReplacementTransport,globalThis:{ window },
  })();
  assert.equal(make(false), null);
  assert.equal(calls, 0);
  assert.equal(make(true), injectedTransport);
  assert.equal(calls, 1);
  assert.match(appSource, /transport: resolvedDocumentReplacementTransport/);
  assert.match(appSource, /typeof resolvedDocumentReplacementTransport !== 'function'/);
});

test('AppShell automatic V5 route requires both page and definition flags', () => {
  const automatic = async () => null;
  let calls = 0;
  const make = (checkedPageReplacementEnabled, documentDefinitionRevisionsEnabled) =>
    callback('resolvedDocumentReplacementTransport', {
      __source:appSource,__tree:appTree,checkedPageReplacementEnabled,
      documentDefinitionRevisionsEnabled,documentReplacementTransport:null,
      resolveDocumentPageReplacementTransport:() => { calls++; return automatic; },
      globalThis:{ window:{ location:{ href:'https://surveytool.app/' } } },
    })();
  assert.equal(make(false, false), null);
  assert.equal(make(true, false), null);
  assert.equal(calls, 0);
  assert.equal(make(true, true), automatic);
  assert.equal(calls, 1);
});

const actor = 'actor-a', documentId = 'document-a', generationId = 'generation-a';
const reference = Object.freeze({ version:1,documentId,definitionRevision:7,
  definitionDigest:'d'.repeat(64) });

function wiring(overrides = {}) {
  const file = { id:documentId }, checkedBundle = { pdfGenerationId:generationId };
  const definitionRevisionScopeRef = { current:{ active:true,actorUserId:actor,documentId,
    generationId,file } };
  const currentDefinitionRevisionReferenceRef = { current:reference };
  const calls = [];
  const onReplaceCheckedPages = async input => { calls.push(input); return true; };
  const value = callback('replaceCheckedPagesWithDefinition', {
    onReplaceCheckedPages, definitionRevisionFlowEnabled:true,
    definitionRevisionScopeRef, currentDefinitionRevisionReferenceRef,
    pdfFile:file, checkedBundle, user:{ id:actor }, sameDefinitionRevisionReference,
    ...overrides,
  });
  return { value,calls,definitionRevisionScopeRef,currentDefinitionRevisionReferenceRef,file,
    checkedBundle };
}

test('new checked page operation carries the exact accepted definition tuple', async () => {
  const h = wiring();
  const input = { operation:{ type:'duplicate',page:2 }, revalidateCapture:async () => true };
  assert.equal(await h.value(input), true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].definitionRevision, '7');
  assert.equal(h.calls[0].definitionDigest, 'd'.repeat(64));
  assert.notEqual(h.calls[0].revalidateCapture, input.revalidateCapture);
  assert.equal(await h.calls[0].revalidateCapture({ accepted:true }), true);
});

test('definition or actor drift during accepted-state revalidation fails before dispatch', async () => {
  const h = wiring();
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  await h.value({ operation:{ type:'duplicate',page:2 },
    revalidateCapture:async () => { await waiting; return true; } });
  const pending = h.calls[0].revalidateCapture({ accepted:true });
  h.definitionRevisionScopeRef.current = {
    ...h.definitionRevisionScopeRef.current,actorUserId:'actor-b' };
  h.currentDefinitionRevisionReferenceRef.current = {
    ...reference,definitionRevision:8,definitionDigest:'e'.repeat(64) };
  release();
  assert.equal(await pending, false);
});

test('missing accepted definition fails closed while legacy and recovery paths stay unchanged', async () => {
  let calls = 0;
  const unavailable = wiring({ currentDefinitionRevisionReferenceRef:{ current:null },
    onReplaceCheckedPages:async () => { calls++; } });
  await assert.rejects(unavailable.value({ revalidateCapture:async () => true }),
    /definition/i);
  assert.equal(calls, 0);

  const raw = { operation:{ type:'rotate',page:1,delta:90 } };
  const legacyCalls = [];
  const legacy = wiring({ definitionRevisionFlowEnabled:false,
    onReplaceCheckedPages:async input => { legacyCalls.push(input); return true; } });
  assert.equal(await legacy.value(raw), true);
  assert.equal(legacyCalls[0], raw);
  assert.match(viewerSource,
    /onReplaceCheckedPages\(\{ recoveryOnly: true, retireGeneration: retirePdfGeneration,/);
});
