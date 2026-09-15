import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const componentUrl = new URL('../src/components/DocumentDefinitionRevisionReview.jsx', import.meta.url);
const portalUrl = new URL('../src/components/BodyPortal.js', import.meta.url);
const portalSource = (await transformWithOxc(await readFile(portalUrl, 'utf8'), portalUrl.pathname)).code
  .replace('"react-dom"', JSON.stringify(pathToFileURL(require.resolve('react-dom')).href));
const portalDataUrl = `data:text/javascript;base64,${Buffer.from(portalSource).toString('base64')}`;
const componentSource = (await transformWithOxc(await readFile(componentUrl, 'utf8'), componentUrl.pathname,
  { lang: 'jsx' })).code
  .replace('"react"', JSON.stringify(pathToFileURL(require.resolve('react')).href))
  .replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href))
  .replace('"./BodyPortal.js"', JSON.stringify(portalDataUrl));
const DocumentDefinitionRevisionReview = (await import(
  `data:text/javascript;base64,${Buffer.from(componentSource).toString('base64')}`
)).default;

const DOCUMENT_A = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_B = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_A = '33333333-3333-4333-8333-333333333333';
const TEMPLATE_B = '44444444-4444-4444-8444-444444444444';
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

const currentReceipt = ({ documentId = DOCUMENT_A, revision = 1,
  digest = DIGEST_A, label = 'Current module' } = {}) => ({
  status: 'accepted', documentId, definitionRevision: revision, definitionDigest: digest,
  surveyDefinition: { modules: [{ id: 'module-current', name: label, categories: [] }] },
  entityCatalog: { entities: [{ id: 'entity-current', name: 'Current entity' }] },
});
const template = (id, name) => ({ id, name,
  modules: [{ id: `module-${id}`, name: `${name} module`, categories: [] }],
  entities: [{ id: `entity-${id}`, name: `${name} entity` }] });

const installDom = () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
};

const waitFor = async (check, message) => {
  for (let i = 0; i < 50; i += 1) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
    if (check()) return;
  }
  assert.fail(message);
};

const mountReview = async (t, initialProps) => {
  const restore = installDom();
  let props = initialProps;
  const root = createRoot(document.getElementById('root'));
  const render = async patch => {
    props = { ...props, ...patch };
    await act(async () => root.render(React.createElement(DocumentDefinitionRevisionReview, props)));
  };
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  await render({});
  return { render };
};

const selectOption = async (index, value) => {
  const select = document.querySelectorAll('select')[index];
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
};

const button = pattern => [...document.querySelectorAll('button')]
  .find(value => pattern.test(value.textContent));

test('V2 discovery requires unchecked consent for every retired root before final review', async t => {
  const current = currentReceipt();
  const next = template(TEMPLATE_A, 'Replacement');
  const roots = [
    { kind: 'category', id: 'category-old', parentId: 'module-current', label: 'Old category', subtree: [
      { kind: 'category', id: 'category-old', parentId: 'module-current', label: 'Old category' },
      { kind: 'checklistItem', id: 'check-old', parentId: 'category-old', label: 'Old check' },
    ] },
    { kind: 'entity', id: 'entity-old', parentId: null, label: 'Old entity', subtree: [
      { kind: 'entity', id: 'entity-old', parentId: null, label: 'Old entity' },
    ] },
  ];
  const discovery = { status: 'retirement-required', version: 2, documentId: DOCUMENT_A,
    current: { definitionRevision: 1, definitionDigest: DIGEST_A },
    sourceModes: { survey: 'replace', entity: 'keep' },
    removedRoots: roots, autoRetainedRoots: roots, review: null };
  const finalReview = { status: 'reviewed', version: 2, documentId: DOCUMENT_A,
    currentReceipt: current,
    wire: { surveyDefinition: { modules: next.modules }, entityCatalog: current.entityCatalog } };
  const calls = [];
  await mountReview(t, { available: true, scopeKey: `actor-a:${DOCUMENT_A}`,
    currentReceipt: current, templates: [next],
    onRequest: async request => { calls.push(request); return calls.length === 1 ? discovery : finalReview; } });
  await selectOption(0, TEMPLATE_A);
  await act(async () => button(/Review document update/).click());
  await waitFor(() => calls.length === 1
    && document.querySelector('[data-document-definition-retirement-review]'),
  'retirement discovery did not render');
  assert.deepEqual(calls[0], { version: 2, surveyTemplate: next, entityTemplate: null,
    retiredSemanticRoots: [] });

  const checks = [...document.querySelectorAll('input[type="checkbox"]')];
  assert.equal(checks.length, 2);
  assert.equal(checks.every(check => check.checked === false), true,
    'server roots start without implied consent');
  assert.match(document.body.textContent, /Old category/);
  assert.match(document.body.textContent, /2 items in this retired group/i);
  assert.match(document.body.textContent, /1 item in this retired group/i);
  const continueButton = button(/Continue to final review/);
  assert.equal(continueButton.disabled, true);
  await act(async () => checks[0].click());
  assert.equal(continueButton.disabled, true, 'partial root consent cannot continue');
  await act(async () => checks[1].click());
  assert.equal(continueButton.disabled, false);

  await act(async () => continueButton.click());
  await waitFor(() => calls.length === 2
    && document.querySelector('[data-document-definition-revision-review]'),
  'checked retirement roots did not reach final review');
  assert.deepEqual(calls[1], { version: 2, surveyTemplate: next, entityTemplate: null,
    retiredSemanticRoots: [
      { kind: 'category', id: 'category-old' },
      { kind: 'entity', id: 'entity-old' },
    ] });
  assert.ok(button(/Apply shared update/));
});

test('source and scope changes clear consent and fence stale discovery replies', async t => {
  const current = currentReceipt();
  const first = template(TEMPLATE_A, 'First source');
  const second = template(TEMPLATE_B, 'Second source');
  const discovery = { status: 'retirement-required', version: 2, documentId: DOCUMENT_A,
    current: { definitionRevision: 1, definitionDigest: DIGEST_A },
    sourceModes: { survey: 'replace', entity: 'keep' },
    removedRoots: [{ kind: 'module', id: 'old', parentId: null, label: 'Old module', subtree: [
      { kind: 'module', id: 'old', parentId: null, label: 'Old module' },
    ] }], autoRetainedRoots: [], review: null };
  let resolvePending;
  const pending = new Promise(resolve => { resolvePending = resolve; });
  const harness = await mountReview(t, { available: true, scopeKey: `actor-a:${DOCUMENT_A}`,
    currentReceipt: current, templates: [first, second], onRequest: () => pending });
  await selectOption(0, TEMPLATE_A);
  await act(async () => button(/Review document update/).click());

  const replacementCurrent = currentReceipt({ documentId: DOCUMENT_B, revision: 2,
    digest: DIGEST_B, label: 'Other document' });
  await harness.render({ scopeKey: `actor-b:${DOCUMENT_B}`, currentReceipt: replacementCurrent });
  await act(async () => resolvePending(discovery));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  assert.equal(document.querySelector('[data-document-definition-retirement-review]'), null);
  assert.equal(document.querySelectorAll('select')[0].value, '');
  assert.equal(document.querySelectorAll('select')[1].value, '');
});

test('a direct V2 final review sends null for the accepted side kept by the owner', async t => {
  const current = currentReceipt();
  const next = template(TEMPLATE_B, 'Entity replacement');
  const finalReview = { status: 'reviewed', version: 2, documentId: DOCUMENT_A,
    currentReceipt: current,
    wire: { surveyDefinition: current.surveyDefinition,
      entityCatalog: { entities: next.entities } } };
  const calls = [];
  await mountReview(t, { available: true, scopeKey: `actor-a:${DOCUMENT_A}`,
    currentReceipt: current, templates: [next],
    onRequest: async request => { calls.push(request); return finalReview; } });
  await selectOption(1, TEMPLATE_B);
  await act(async () => button(/Review document update/).click());
  await waitFor(() => document.querySelector('[data-document-definition-revision-review]'),
    'direct final review did not render');
  assert.deepEqual(calls, [{ version: 2, surveyTemplate: null, entityTemplate: next,
    retiredSemanticRoots: [] }]);
  assert.match(document.body.textContent, /Entity replacement entity/);
});
