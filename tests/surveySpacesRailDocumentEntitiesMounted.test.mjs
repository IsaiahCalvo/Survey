import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

let vite;
let SurveySpacesRail;
before(async () => {
  vite = await createServer({ configFile: false, envDir: false, appType: 'custom',
    server: { middlewareMode: true, hmr: false } });
  ({ default: SurveySpacesRail } = await vite.ssrLoadModule('/src/SurveySpacesRail.jsx'));
});
after(async () => vite?.close());

const legacy = { id: 'same', name: 'Legacy', color: '#112233' };
const accepted = { id: 'accepted', name: 'Accepted', color: '#abcdef' };
const complete = { id: 'done', name: 'Complete', color: '#00aa00' };
const template = { id: 'template', name: 'Template', entities: [legacy], modules: [{ id: 'module',
  name: 'Module', categories: [{ id: 'category', name: 'Category', checklist: [] }] }] };

function mountRail(t, { choices, railTemplate = template, initialItems = {}, mobileMode = false,
  deferMarkerUpdates = false, strictMode = false,
  marker = { name: 'Marker', moduleId: 'module', categoryId: 'category',
    entityId: 'same', entityName: 'Saved name', entityColor: '#445566' } } = {}) {
  const dom = new JSDOM('<div id="root"></div>');
  const prior = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(document.getElementById('root'));
  let current = marker;
  const reports = [];
  const calls = { markers: 0, items: 0, annotations: 0 };
  let currentItems = initialItems;
  const queuedMarkerUpdates = [];
  let flushMarkerUpdate;
  const noop = () => {};
  function Probe({ documentEntityChoices, pdfFile, documentEntityChoiceScope }) {
    const [markers, setMarkers] = useState({ mark: current });
    const [items, setItems] = useState(currentItems);
    flushMarkerUpdate = () => setMarkers(old => {
      const change = queuedMarkerUpdates.shift();
      if (!change) return old;
      const next = change(old); current = next.mark; reports.push(structuredClone(next)); return next;
    });
    const updateMarkers = change => {
      calls.markers += 1;
      if (deferMarkerUpdates && typeof change === 'function') {
        queuedMarkerUpdates.push(change); return;
      }
      setMarkers(old => {
      const next = typeof change === 'function' ? change(old) : change;
      current = next.mark; reports.push(structuredClone(next)); return next;
      });
    };
    const updateItems = change => {
      calls.items += 1;
      setItems(old => {
      const next = typeof change === 'function' ? change(old) : change;
      currentItems = next; return next;
      });
    };
    return React.createElement(SurveySpacesRail, {
      documentEntityChoices, documentEntityChoiceScope, pdfFile, user: { id: 'actor' },
      selectedTemplate: railTemplate, selectedModuleId: 'module',
      selectedCategoryId: 'category', selectedCategories: ['category'], surveyTemplates: [railTemplate],
      surveyMarkers: markers, setSurveyMarkers: updateMarkers, items, setItems: updateItems,
      annotations: {}, setAnnotations: () => { calls.annotations += 1; },
      annotationsByPage: {}, setAnnotationsByPage: noop,
      expandedCategories: { category: true }, setExpandedCategories: noop,
      expandedSurveyMarkers: { mark: true }, setExpandedSurveyMarkers: noop,
      selectedItemsInCategory: {}, setSelectedItemsInCategory: noop, copiedItemSelection: {},
      setCopiedItemSelection: noop, itemSelectModeActive: {}, setItemSelectModeActive: noop,
      categorySelectModeActive: false, setCategorySelectModeActive: noop,
      setCategorySelectModeForCategory: noop, setCopyModeActive: noop, copyModeActive: false,
      selectedSpaceId: 'space', spaces: [], mobileMode, expandRequestKey: 1,
      showSurveyPanel: true,
      getCategoryName: () => 'Category', getModuleName: () => 'Module',
      getModuleDataKey: () => 'moduleData', normalizeSurveyMarkerColor: value => value,
      DEFAULT_SURVEY_MARKER_OPACITY: 0.35, features: {}, showToast: noop,
      setActiveTool: noop, setSelectedCategoryId: noop, setSelectedModuleId: noop,
      setSelectedSpaceId: noop, setShowSurveyPanel: noop, setShowSpaceSelection: noop,
      setShowExportMenu: noop,
      setPendingLocationItem: noop, setNoteDialogContent: noop, setNoteDialogOpen: noop,
      setNewSurveyMarkersByPage: noop, setSurveyMarkersToRemoveByPage: noop,
      handleSurveyToggle: noop, handleToggleSurveyAnnotations: noop,
      handleToggleCanvasAnnotations: noop, handleToggleRegionOverlay: noop,
      getSurveyAnnotationVisibilityState: () => true, getCanvasAnnotationVisibilityState: () => true,
      isRegionOverlayEnabled: true, isRegionOverlayToggleEnabled: true,
    });
  }
  const render = (value, pdfFile = { id: 'doc-a' },
    documentEntityChoiceScope = { actorUserId: 'actor', tabId: 'tab-a', file: pdfFile }) =>
    act(async () => root.render(strictMode
      ? React.createElement(React.StrictMode, null, React.createElement(Probe,
        { documentEntityChoices: value, pdfFile, documentEntityChoiceScope }))
      : React.createElement(Probe, { documentEntityChoices: value, pdfFile, documentEntityChoiceScope })));
  let unmounted = false;
  t.after(async () => {
    if (!unmounted) await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of [...prior].reverse()) descriptor
      ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  });
  return { render, reports, calls, marker: () => current, items: () => currentItems,
    queuedMarkerUpdates, flushMarkerUpdate: () => act(async () => flushMarkerUpdate()),
    unmount: () => act(async () => { root.unmount(); unmounted = true; }) };
}

const entityOptionClick = label => {
  const option = [...document.querySelectorAll('[role="option"]')]
    .find(node => node.textContent.includes(label));
  const key = Object.keys(option).find(name => name.startsWith('__reactProps$'));
  return option[key].onClick;
};

test('mounted desktop entity picker uses scoped document choices and keeps marker snapshots', async t => {
  const h = mountRail(t, { choices: [accepted] });
  await h.render([accepted]);
  const trigger = document.querySelector('.survey-marker-entity-trigger');
  assert.ok(trigger, 'real expanded marker entity picker is mounted');
  assert.equal(trigger.textContent.trim(), 'Saved name', 'stored marker name wins over live config');
  await act(async () => trigger.click());
  assert.match(document.querySelector('[role="listbox"]').textContent, /Accepted/);
  assert.doesNotMatch(document.querySelector('[role="listbox"]').textContent, /Legacy/);
  const before = structuredClone(h.marker());
  const oldOption = [...document.querySelectorAll('[role="option"]')]
    .find(node => node.textContent.includes('Accepted'));
  const reactPropsKey = Object.keys(oldOption).find(key => key.startsWith('__reactProps$'));
  const retainedOldClick = oldOption[reactPropsKey].onClick;
  const tabB = { id: 'tab-b', name: 'Tab B', color: '#fedcba' };
  const fileB = { id: 'doc-b' };
  await h.render([tabB], fileB, { actorUserId: 'actor', tabId: 'tab-b', file: fileB });
  const callsBeforeOldClick = structuredClone(h.calls);
  await act(async () => retainedOldClick({ stopPropagation() {} }));
  assert.deepEqual(h.marker(), before, 'a retained handler from tab A cannot write after switching to B');
  assert.deepEqual(h.calls, callsBeforeOldClick, 'stale handler calls no parent setter');
  assert.equal(document.querySelector('.survey-marker-entity-trigger').textContent.trim(), 'Saved name',
    'a tab scope change does not rewrite the historical marker');
  if (!document.querySelector('[role="listbox"]')) {
    await act(async () => document.querySelector('.survey-marker-entity-trigger').click());
  }
  const switchedOptions = document.querySelector('[role="listbox"]').textContent;
  assert.match(switchedOptions, /Tab B/);
  assert.doesNotMatch(switchedOptions, /Accepted|Legacy/);
  await act(async () => [...document.querySelectorAll('[role="option"]')]
    .find(node => node.textContent.includes('Tab B')).click());
  assert.equal(h.marker().entityId, tabB.id);
  assert.equal(h.marker().entityName, tabB.name);
  assert.equal(h.marker().entityColor, tabB.color);
});

test('the real PDFViewer right-rail API publishes and tracks the document entity list', async () => {
  const source = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const publishStart = source.indexOf('const nextRightRailApi = {');
  const publishEnd = source.indexOf('onRightRailApiChange((prev)', publishStart);
  const dependencyEnd = source.indexOf(']);', publishEnd);
  assert.match(source.slice(publishStart, publishEnd), /\bdocumentEntityChoices,/);
  assert.match(source.slice(publishEnd, dependencyEnd), /\bdocumentEntityChoices,/,
    'catalog changes must republish the live tab rail API');
});

test('mounted picker treats an empty document list as final and explicit None clears', async t => {
  const h = mountRail(t);
  await h.render([]);
  const trigger = document.querySelector('.survey-marker-entity-trigger');
  assert.equal(trigger.textContent.trim(), 'Saved name');
  await act(async () => trigger.click());
  const options = [...document.querySelectorAll('[role="option"]')];
  assert.equal(options.length, 1);
  assert.match(options[0].textContent, /None/);
  await act(async () => options[0].click());
  assert.equal(h.marker().entityId, undefined);
  assert.equal(h.marker().entityName, undefined);
  assert.equal(h.marker().entityColor, undefined);
});

for (const [label, choices] of [['null', null], ['invalid object', { entities: [legacy] }]]) {
  test(`mounted picker treats explicit ${label} document choices as authoritative empty`, async t => {
    const h = mountRail(t);
    await h.render(choices);
    await act(async () => document.querySelector('.survey-marker-entity-trigger').click());
    const options = [...document.querySelectorAll('[role="option"]')];
    assert.equal(options.length, 1);
    assert.match(options[0].textContent, /None/);
    assert.doesNotMatch(document.querySelector('[role="listbox"]').textContent, /Legacy/);
  });
}

test('missing historical name and color use the legacy template snapshot map, not the same-id catalog row', async t => {
  const h = mountRail(t, { marker: { name: 'Marker', moduleId: 'module', categoryId: 'category',
    entityId: 'same' } });
  await h.render([{ id: 'same', name: 'Changed accepted', color: '#abcdef' }]);
  assert.equal(document.querySelector('.survey-marker-entity-trigger').textContent.trim(), 'Legacy');
  const swatch = document.querySelector('.survey-marker-entity-trigger .survey-marker-entity-swatch');
  assert.match(swatch.getAttribute('style'), /17, 34, 51|#112233/i);
});

test('a retained mobile entity option cannot write after its file and tab scope retire', async t => {
  const h = mountRail(t, { mobileMode: true });
  const fileA = { id: 'doc-a' };
  await h.render([accepted], fileA, { actorUserId: 'actor', tabId: 'tab-a', file: fileA });
  await act(async () => document.querySelector('[aria-label="Choose Survey Marker entity"]').click());
  const option = [...document.querySelectorAll('[role="option"]')]
    .find(node => node.textContent.includes('Accepted'));
  const key = Object.keys(option).find(name => name.startsWith('__reactProps$'));
  const oldClick = option[key].onClick;
  const before = structuredClone(h.marker());
  const fileB = { id: 'doc-b' };
  await h.render([{ id: 'b', name: 'B', color: '#010203' }], fileB,
    { actorUserId: 'actor', tabId: 'tab-b', file: fileB });
  const callsBeforeOldClick = structuredClone(h.calls);
  await act(async () => oldClick());
  assert.deepEqual(h.marker(), before);
  assert.deepEqual(h.calls, callsBeforeOldClick);
});

test('a queued marker updater rechecks scope after the entity click', async t => {
  const h = mountRail(t, { deferMarkerUpdates: true });
  const fileA = { id: 'doc-a' };
  await h.render([accepted], fileA, { actorUserId: 'actor', tabId: 'tab-a', file: fileA });
  await act(async () => document.querySelector('.survey-marker-entity-trigger').click());
  await act(async () => [...document.querySelectorAll('[role="option"]')]
    .find(node => node.textContent.includes('Accepted')).click());
  assert.equal(h.queuedMarkerUpdates.length, 1);
  const before = structuredClone(h.marker());
  const fileB = { id: 'doc-b' };
  await h.render([], fileB, { actorUserId: 'actor', tabId: 'tab-b', file: fileB });
  await h.flushMarkerUpdate();
  assert.deepEqual(h.marker(), before, 'the queued updater cannot write into the next tab scope');
});

test('StrictMode cleanup restores a live lease and permits a current entity click', async t => {
  const h = mountRail(t, { strictMode: true });
  await h.render([accepted]);
  await act(async () => document.querySelector('.survey-marker-entity-trigger').click());
  await act(async () => entityOptionClick('Accepted')({ stopPropagation() {} }));
  assert.equal(h.marker().entityId, accepted.id);
});

test('A-B-A with the same upstream token and choices rejects the old A handler', async t => {
  const h = mountRail(t);
  const fileA = { id: 'doc-a' }, fileB = { id: 'doc-b' };
  const scopeA = { actorUserId: 'actor', tabId: 'tab-a', file: fileA };
  const scopeB = { actorUserId: 'actor', tabId: 'tab-b', file: fileB };
  const choicesA = [accepted];
  await h.render(choicesA, fileA, scopeA);
  await act(async () => document.querySelector('.survey-marker-entity-trigger').click());
  const oldClick = entityOptionClick('Accepted');
  const before = structuredClone(h.marker());
  await h.render([], fileB, scopeB);
  await h.render(choicesA, fileA, scopeA);
  const callsBeforeOldClick = structuredClone(h.calls);
  await act(async () => oldClick({ stopPropagation() {} }));
  assert.deepEqual(h.marker(), before);
  assert.deepEqual(h.calls, callsBeforeOldClick);
});

test('same-file choice-array replacement rejects a retained old handler', async t => {
  const h = mountRail(t);
  const file = { id: 'doc-a' };
  const scope = { actorUserId: 'actor', tabId: 'tab-a', file };
  await h.render([accepted], file, scope);
  await act(async () => document.querySelector('.survey-marker-entity-trigger').click());
  const oldClick = entityOptionClick('Accepted');
  const before = structuredClone(h.marker());
  await h.render([{ id: 'next', name: 'Next', color: '#010203' }], file, scope);
  const callsBeforeOldClick = structuredClone(h.calls);
  await act(async () => oldClick({ stopPropagation() {} }));
  assert.deepEqual(h.marker(), before);
  assert.deepEqual(h.calls, callsBeforeOldClick);
});

test('a retained handler after unmount performs zero parent writes', async t => {
  const h = mountRail(t);
  await h.render([accepted]);
  await act(async () => document.querySelector('.survey-marker-entity-trigger').click());
  const oldClick = entityOptionClick('Accepted');
  const before = structuredClone(h.marker());
  await h.unmount();
  const callsBeforeOldClick = structuredClone(h.calls);
  await oldClick({ stopPropagation() {} });
  assert.deepEqual(h.marker(), before);
  assert.deepEqual(h.calls, callsBeforeOldClick, 'unmounted handler calls no parent setter');
  assert.equal(h.reports.length, 0);
});

test('mounted checklist auto-Complete uses the accepted document list, not the changed template', async t => {
  const checklistTemplate = { ...template, entities: [legacy], modules: [{ id: 'module', name: 'Module',
    categories: [{ id: 'category', name: 'Category', checklist: [{ id: 'check', text: 'Done?' }] }] }] };
  const h = mountRail(t, { railTemplate: checklistTemplate, choices: [complete],
    marker: { name: 'Marker', moduleId: 'module', categoryId: 'category' },
    initialItems: { item: { itemId: 'item', name: 'Marker', itemType: 'Category', moduleData: {} } } });
  await h.render([complete]);
  const yes = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Y');
  assert.ok(yes, 'real expanded checklist control is mounted');
  await act(async () => yes.click());
  assert.equal(h.marker().entityId, complete.id);
  assert.equal(h.marker().entityName, complete.name);
  assert.equal(h.marker().entityColor, complete.color);
  assert.equal(h.items().item.moduleData.entityId, complete.id);
});

test('mounted legacy caller falls back only when the document-list prop is omitted', async t => {
  const h = mountRail(t);
  await h.render(undefined);
  await act(async () => document.querySelector('.survey-marker-entity-trigger').click());
  assert.match(document.querySelector('[role="listbox"]').textContent, /Legacy/);
});
