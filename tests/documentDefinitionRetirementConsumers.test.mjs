import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const railSource = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
const parseSource = source => parse(source, { sourceType:'module', plugins:['jsx'] });
const viewerTree = parseSource(viewerSource);
const railTree = parseSource(railSource);
let vite;
let SurveySpacesRail;
before(async () => {
  vite = await createServer({ configFile:false, envDir:false, appType:'custom',
    server:{ middlewareMode:true, hmr:false } });
  ({ default:SurveySpacesRail } = await vite.ssrLoadModule('/src/SurveySpacesRail.jsx'));
});
after(async () => vite?.close());

const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      const match = find(child, predicate);
      if (match) return match;
    }
  }
  return null;
};

const variable = (tree, name) => {
  const node = find(tree, value => value.type === 'VariableDeclarator' && value.id?.name === name);
  assert.ok(node, `${name} exists in the real caller`);
  return node;
};
const evaluate = (source, node, scope) => new Function(...Object.keys(scope),
  `return (${source.slice(node.start, node.end)});`)(...Object.values(scope));

test('real marker creation callback rejects retired module, category, and entity before history', () => {
  const callback = variable(viewerTree, 'handleSurveyMarkerCreated').init.arguments[0];
  for (const blockedKind of ['module', 'category', 'entity']) {
    const history = [];
    const fn = evaluate(viewerSource, callback, {
      canCommitDocumentDefinitionMutation:() => true,
      effectiveDocumentLockedRef:{ current:false },
      selectedModuleId:'module', selectedCategoryId:'category', mobileSurveyEntityId:'entity',
      isDefinitionIdAvailable:kind => kind !== blockedKind,
      pendingLocationItem:null, crypto:{ randomUUID:() => 'new' },
      addHistoryCheckpoint:(...args) => history.push(args),
    });
    assert.doesNotThrow(() => fn(1, { x:1, y:1, width:10, height:10 }));
    assert.deepEqual(history, [], `${blockedKind} stops before the create checkpoint`);
  }
});

test('retained availability callback sees flag changes but rejects a changed document scope', () => {
  const callback = variable(viewerTree, 'isDefinitionIdAvailable').init.arguments[0];
  const capturedScope = { actorUserId:'actor', documentId:'doc-a',
    generationId:'generation-a', file:{} };
  let currentScope = capturedScope;
  const live = { current:{ enabled:false, isAvailable:() => true } };
  const retained = evaluate(viewerSource, callback, {
    isDefinitionRevisionScopeCurrent:candidate => candidate === currentScope,
    definitionAvailabilityScope:capturedScope,
    definitionAvailabilityRef:live,
  });
  assert.equal(retained('module', 'retired'), true, 'legacy disabled flow stays available');
  live.current = { enabled:true, isAvailable:() => false };
  assert.equal(retained('module', 'retired'), false,
    'the same-scope retained callback uses the newly enabled live predicate');
  live.current = { enabled:true, isAvailable:() => true };
  currentScope = { actorUserId:'actor', documentId:'doc-b',
    generationId:'generation-b', file:{} };
  assert.equal(retained('module', 'same-id'), false,
    'an old document callback cannot use the new document predicate');
});

test('passive retirement keeps the old module selected for browsing and leaves creation mode', () => {
  const effect = find(viewerTree, node => node.type === 'CallExpression'
    && node.callee?.name === 'useEffect'
    && viewerSource.slice(node.start, node.end).includes('const canonicalModules = effectiveSurveyTemplate'));
  assert.ok(effect, 'real selected-module effect exists');
  const moduleChanges = [];
  const toolChanges = [];
  const run = evaluate(viewerSource, effect.arguments[0], {
    surveyDefinition:{ mode:'accepted' },
    effectiveSurveyTemplate:{ modules:[{ id:'retired-module', name:'Old module' }] },
    definitionRevisionFlowEnabled:true,
    definitionRevisions:{ availableModules:[] },
    selectedModuleId:'retired-module', activeTool:'survey-marker',
    setSelectedModuleId:value => moduleChanges.push(value),
    setActiveTool:value => toolChanges.push(value),
  });
  run();
  assert.deepEqual(moduleChanges, [], 'passive refresh preserves the canonical browse selection');
  assert.deepEqual(toolChanges, ['pan'], 'passive retirement leaves the creation tool');
});

test('real rail module browse disarms creation while entity assignment rechecks live availability', () => {
  const selected = [];
  const selectModule = evaluate(railSource, variable(railTree, 'selectSurveyModule').init, {
    selectedModuleId:'old', isDefinitionIdAvailable:() => false,
    availableSurveyModuleIds:new Set(), activeTool:'survey-marker',
    setIsModuleSelectorOpen:value => selected.push(['open', value]),
    setSelectedModuleId:value => selected.push(['module', value]),
    setSelectedCategoryId:value => selected.push(['category', value]),
    setActiveCategoryDropdown:value => selected.push(['dropdown', value]),
    setActiveTool:value => selected.push(['tool', value]), setCopyModeActive:() => {},
    setCopiedItemSelection:() => {}, categorySelectModeActive:false,
    setSelectedCategories:() => {}, mobileMode:false, setExpandedSurveyMarkers:() => {},
  });
  selectModule('retired-module');
  assert.deepEqual(selected, [['module', 'retired-module'], ['category', null],
    ['dropdown', 'survey'], ['tool', 'pan'], ['open', false]]);

  const applyEntity = evaluate(railSource, variable(railTree, 'applyEntitySelectionForMarker').init, {
    entityChoiceScopeIsCurrent:() => true, surveyDefinitionScopeIsCurrent:() => true,
    isDefinitionIdAvailable:() => false,
  });
  assert.equal(applyEntity('marker', 'module', { id:'category' }, 'entity'), false);
});

test('real rail entity clear stays usable for old work while a new assignment is blocked', () => {
  const writes = [];
  const applyEntity = evaluate(railSource, variable(railTree, 'applyEntitySelectionForMarker').init, {
    entityChoiceScopeIsCurrent:() => true, surveyDefinitionScopeIsCurrent:() => true,
    isDefinitionIdAvailable:() => false,
    findMarkerMatchingItem:() => ({ matchingItem:null, moduleData:{}, dataKey:null }),
    availableEntityChoices:[],
    setSurveyMarkers:change => writes.push(change({ marker:{ entityId:'old' } })),
  });
  assert.equal(applyEntity('marker', 'retired-module', { id:'retired-category' }, ''), true);
  assert.equal(writes[0].marker.entityId, undefined);
  assert.equal(applyEntity('marker', 'retired-module', { id:'retired-category' }, 'new'), false);
  assert.equal(writes.length, 1);
});

test('queued checklist write rechecks retirement at commit time', () => {
  let available = true;
  let queued;
  const applyChecklist = evaluate(railSource,
    variable(railTree, 'applyChecklistResponseSelection').init, {
      entityChoiceScopeIsCurrent:() => true, surveyDefinitionScopeIsCurrent:() => true,
      isDefinitionIdAvailable:() => available,
      surveyMarkers:{ marker:{ checklistResponses:{} } },
      setSurveyMarkers:change => { queued = change; },
    });
  assert.equal(applyChecklist('marker', 'module', { id:'category' }, 'Marker', 'item', 'Y'), true);
  available = false;
  const current = { marker:{ checklistResponses:{} } };
  assert.equal(queued(current), current, 'the deferred setter cannot add the now-retired item');
});

test('Excel sync may update an old response but cannot add a retired checklist field', () => {
  const policy = variable(viewerTree, 'canWriteImportedChecklistResponse').init;
  const canWrite = evaluate(viewerSource, policy, {});
  const responses = { old:{ selection:'N' } };
  const unavailable = () => false;
  assert.equal(canWrite(responses, 'old', unavailable), true);
  assert.equal(canWrite(responses, 'new', unavailable), false);
  assert.equal(canWrite(responses, 'new', () => true), true);
});

test('mounted rail browses a retired module without arming creation or changing old work', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map();
  for (const [key, value] of Object.entries({ window:dom.window, document:dom.window.document,
    IS_REACT_ACT_ENVIRONMENT:true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable:true, writable:true, value });
  }
  const root = createRoot(document.getElementById('root'));
  const activeModule = { id:'active-module', name:'Active module', categories:[] };
  const retiredModule = { id:'retired-module', name:'Old module', categories:[{
    id:'retired-category', name:'Old category', checklist:[],
  }] };
  const template = { id:'template', name:'Template', modules:[activeModule, retiredModule], entities:[] };
  const oldMarker = { id:'old-marker', name:'Saved old marker', moduleId:'retired-module',
    categoryId:'retired-category', checklistResponses:{} };
  const toolCalls = [];
  let markerWrites = 0;
  const noop = () => {};
  function Probe() {
    const [selectedModuleId, setSelectedModuleId] = useState('active-module');
    return React.createElement(SurveySpacesRail, {
      documentSurveyTemplate:template, availableSurveyModules:[activeModule],
      documentEntityChoices:[], availableEntityChoices:[], isDefinitionIdAvailable:() => false,
      selectedTemplate:template, surveyTemplates:[template], selectedModuleId,
      setSelectedModuleId, selectedCategoryId:null, setSelectedCategoryId:noop,
      selectedCategories:{}, setSelectedCategories:noop,
      activeTool:'survey-marker', setActiveTool:value => toolCalls.push(value),
      surveyMarkers:{ 'old-marker':oldMarker }, setSurveyMarkers:() => { markerWrites += 1; },
      items:{}, setItems:noop, annotations:{}, setAnnotations:noop,
      annotationsByPage:{}, setAnnotationsByPage:noop,
      expandedCategories:{ 'retired-category':true },
      setExpandedCategories:noop, expandedSurveyMarkers:{}, setExpandedSurveyMarkers:noop,
      selectedItemsInCategory:{}, setSelectedItemsInCategory:noop, copiedItemSelection:{},
      setCopiedItemSelection:noop, itemSelectModeActive:{}, setItemSelectModeActive:noop,
      categorySelectModeActive:false, setCategorySelectModeActive:noop,
      setCategorySelectModeForCategory:noop, copyModeActive:false, setCopyModeActive:noop,
      mobileMode:false, showSurveyPanel:true, features:{}, spaces:[], selectedSpaceId:null,
      setSelectedSpaceId:noop, setShowSurveyPanel:noop, setShowSpaceSelection:noop,
      setShowExportMenu:noop, setActiveCategoryDropdown:noop, setPendingLocationItem:noop,
      setNoteDialogContent:noop, setNoteDialogOpen:noop, setNewSurveyMarkersByPage:noop,
      setSurveyMarkersToRemoveByPage:noop, getCategoryName:() => 'Old category',
      getModuleName:() => 'Old module', getModuleDataKey:() => 'oldModule',
      normalizeSurveyMarkerColor:value => value, DEFAULT_SURVEY_MARKER_OPACITY:0.35,
      showToast:noop, handleToggleSurveyAnnotations:noop, handleToggleCanvasAnnotations:noop,
      handleToggleRegionOverlay:noop, getSurveyAnnotationVisibilityState:() => true,
      getCanvasAnnotationVisibilityState:() => true, isRegionOverlayEnabled:true,
      isRegionOverlayToggleEnabled:true, applyLayoutDrivenZoom:noop,
    });
  }
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) descriptor
      ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  });
  await act(async () => root.render(React.createElement(Probe)));
  await act(async () => document.querySelector('button[aria-haspopup="listbox"]').click());
  const retiredOption = [...document.querySelectorAll('[role="option"]')]
    .find(node => node.textContent.includes('Old module'));
  assert.ok(retiredOption, 'retired module remains in browse navigation');
  assert.match(retiredOption.textContent, /Retired/);
  await act(async () => retiredOption.click());
  assert.equal(document.querySelector('input[aria-label="Rename Saved old marker"]')?.value,
    'Saved old marker');
  assert.deepEqual(toolCalls, ['pan'], 'retired browse leaves the creation tool');
  assert.equal(markerWrites, 0, 'browsing does not change old marker data');
});
