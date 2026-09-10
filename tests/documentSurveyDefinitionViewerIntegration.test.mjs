import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
import { buildLocalDocumentState, createLocalDocumentStateReader } from '../src/services/localDocumentState.js';
import { deriveCalloutsFromByPage } from '../src/utils/calloutAnnotationBridge.js';

const require=createRequire(import.meta.url);
const noticeUrl=new URL('../src/components/DocumentSurveyDefinitionAdoptionNotice.jsx',import.meta.url);
const portalUrl=new URL('../src/components/BodyPortal.js',import.meta.url);
const portalCode=(await transformWithOxc(await readFile(portalUrl,'utf8'),portalUrl.pathname,{lang:'js'})).code
  .replace('"react-dom"',JSON.stringify(pathToFileURL(require.resolve('react-dom')).href))
  .replaceAll('"react/jsx-runtime"',JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
const portalDataUrl=`data:text/javascript;base64,${Buffer.from(portalCode).toString('base64')}`;
const noticeCode=(await transformWithOxc(await readFile(noticeUrl,'utf8'),noticeUrl.pathname,{lang:'jsx'})).code
  .replace('"react"',JSON.stringify(pathToFileURL(require.resolve('react')).href))
  .replace('"./BodyPortal.js"',JSON.stringify(portalDataUrl))
  .replaceAll('"react/jsx-runtime"',JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
const Notice=(await import(`data:text/javascript;base64,${Buffer.from(noticeCode).toString('base64')}`)).default;
const viewerSource=await readFile(new URL('../src/PDFViewer.jsx',import.meta.url),'utf8');
const appSource=await readFile(new URL('../src/AppShell.jsx',import.meta.url),'utf8');

function mount(t) {
  const dom=new JSDOM('<div id="root"></div>');const prior=new Map();
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})) {
    prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();for(const [key,descriptor] of [...prior].reverse())
    descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  return props=>act(async()=>root.render(React.createElement(Notice,props)));
}

const review={kind:'local',templateName:'Reviewed source',preview:{modules:[{id:'module',name:'Closeout',categories:[
  {id:'category',name:'Doors',checklist:[{id:'active',text:'Latch installed'},
    {id:'archived',text:'Old hinge check',archived:true,archivedAt:'2026-09-09T12:00:00Z',lastKnownLabel:'Old hinge check'}]},
]}]}};
const localId='local:d1700000-0000-4000-8000-000000000001';
const catalog={status:'accepted',version:1,documentId:localId,catalogRevision:1,sourceTemplateId:'entity-template',
  sourceTemplateUpdatedAt:null,sourceEntitiesSha256:'a'.repeat(64),entities:[]};
const definition={status:'accepted',version:1,documentId:localId,definitionRevision:1,sourceTemplateId:'survey-template',
  sourceTemplateUpdatedAt:null,sourceStructureSha256:'b'.repeat(64),modules:review.preview.modules};

test('review notice shows exact checklist text and archive state and keeps confirm explicit',async t=>{
  const render=mount(t);let confirms=0,cancels=0;
  await render({available:true,review,busy:false,onConfirm:()=>{confirms++;},onCancel:()=>{cancels++;}});
  const dialog=document.querySelector('[role="dialog"]');assert.ok(dialog);
  assert.equal(dialog.hasAttribute('aria-modal'),false,'review is nonmodal and makes no focus-trap claim');
  assert.match(dialog.textContent,/Latch installed/);assert.match(dialog.textContent,/Old hinge check \(Archived\)/);
  assert.match(dialog.textContent,/This does not rewrite existing marks\./);
  const use=[...dialog.querySelectorAll('button')].find(button=>/Use for this document/.test(button.textContent));
  const keep=[...dialog.querySelectorAll('button')].find(button=>/Keep current structure/.test(button.textContent));
  assert.equal(confirms,0);await act(async()=>use.click());assert.equal(confirms,1);
  await act(async()=>keep.click());assert.equal(cancels,1);
  await render({available:true,review,busy:true,onConfirm:()=>{confirms++;},onCancel:()=>{cancels++;}});
  assert.equal([...document.querySelectorAll('button')].every(button=>button.disabled),true);
});

test('real managed-local snapshot capture retains both document-owned lists and blocks unknown or busy state',()=>{
  const start=viewerSource.indexOf('  const captureManagedLocalSnapshot = (file, snapshot) =>');
  const end=viewerSource.indexOf('  const persistManagedLocalSnapshot = (file, snapshot,',start);
  assert.ok(start>0&&end>start,'real viewer snapshot capture block exists');
  const makeCapture=scope=>new Function(...Object.keys(scope),`${viewerSource.slice(start,end)}\nreturn captureManagedLocalSnapshot;`)(...Object.values(scope));
  const base={managedLocalStateRef:{current:{items:{},annotations:{},deletedPdfAnnotations:[],callouts:[],pageNames:{},bookmarks:[],
    activeSpaceId:null,pageTransformations:{},regionOverlayDisabled:{},entityCatalog:catalog,surveyDefinition:definition}},
    buildLocalDocumentState,surveyMarkersRef:{current:{}},spacesRef:{current:[]}};
  const capture=makeCapture({...base,entityCatalog:{mode:'accepted',busy:false},surveyDefinition:{mode:'accepted',busy:false}});
  const state=capture({localId},{1:{objects:[{id:'mark'}]}});const reader=createLocalDocumentStateReader({localId,
    _surveyPdfId:localId,storageMode:'local',_localDocumentState:state});
  assert.deepEqual(JSON.parse(reader.getItem(`entityCatalog_${localId}`)),catalog);
  assert.deepEqual(JSON.parse(reader.getItem(`surveyDefinition_${localId}`)),definition);
  for(const surveyDefinition of [{mode:'unknown',busy:false},{mode:'legacy',busy:true}]) {
    const blocked=makeCapture({...base,entityCatalog:{mode:'accepted',busy:false},surveyDefinition});
    assert.throws(()=>blocked({localId},{}),/survey definition must finish/i);
  }
});

test('real managed-local page replacement retains both lists and blocks unresolved survey definition',()=>{
  const start=viewerSource.indexOf('  const persistPageMutationFile = useCallback(');
  const end=viewerSource.indexOf('  const checkedReplacementSessionRef = useRef(',start);
  assert.ok(start>0&&end>start,'real viewer page replacement block exists');
  const makePersist=scope=>new Function(...Object.keys(scope),`${viewerSource.slice(start,end)}\nreturn persistPageMutationFile;`)(...Object.values(scope));
  const file={localId,_surveyPdfId:localId,storageMode:'local'};let updates=0;
  const base={useCallback:fn=>fn,isManagedLocalDocument:value=>value===file,entityCatalog:{mode:'accepted',busy:false,catalog},
    buildLocalDocumentState,deriveCalloutsFromByPage,onUpdatePDFFile:()=>{updates++;},tabId:'tab'};
  const persist=makePersist({...base,surveyDefinition:{mode:'accepted',busy:false,definition}});
  persist(file,{annotationsByPage:{1:{objects:[]}},items:{},annotations:{},surveyMarkers:{},pageNames:{},bookmarks:[],spaces:[],
    activeSpaceId:null,pageTransformations:{},regionOverlayDisabled:{}});
  const reader=createLocalDocumentStateReader(file);
  assert.deepEqual(JSON.parse(reader.getItem(`entityCatalog_${localId}`)),catalog);
  assert.deepEqual(JSON.parse(reader.getItem(`surveyDefinition_${localId}`)),definition);assert.equal(updates,1);
  for(const surveyDefinition of [{mode:'unknown',busy:false},{mode:'legacy',busy:true}]) {
    const blocked=makePersist({...base,surveyDefinition});assert.throws(()=>blocked(file,{}),/survey definition must finish/i);
  }
});

test('real export entry guard rejects linked accepted writes and retired handlers before side effects',async()=>{
  const start=viewerSource.indexOf('  const handleExportSurveyToExcel = useCallback(async (targetPath = null, options = {}) => {');
  const end=viewerSource.indexOf('    // Stage 0 safety switch:',start);
  assert.ok(start>0&&end>start,'real export entry guard exists');
  let sideEffects=0;
  const makeHandler=scope=>new Function(...Object.keys(scope),
    `${viewerSource.slice(start,end)}\nsideEffect(); return false;\n  }, []);\nreturn handleExportSurveyToExcel;`)(...Object.values(scope));
  const oldScope={tabId:'tab',active:true,mode:'legacy',pdfGenerationId:'generation-a',definition:null,file:{id:'doc'}};
  const unknownScope={...oldScope,mode:'unknown'};
  const nextGenerationScope={...oldScope,pdfGenerationId:'generation-b'};
  const base={useCallback:fn=>fn,excelExportScope:()=> 'excel-scope',excelBaselineId:'doc',selectedTemplate:{id:'private'},
    documentSurveyDefinitionScope:oldScope,documentSurveyDefinitionScopeRef:{current:oldScope},excelExportScopeRef:{current:'excel-scope'},
    features:{excelExport:true},showToast:()=>{sideEffects++;},effectiveSurveyTemplate:{id:'definition',name:'Document survey',modules:[]},
    sideEffect:()=>{sideEffects++;}};
  const acceptedHandler=makeHandler({...base,surveyDefinition:{mode:'accepted'}});
  await assert.rejects(acceptedHandler('/linked.xlsx'),/standalone Excel export only/);
  await assert.rejects(acceptedHandler(null,{silent:true}),/standalone Excel export only/);
  assert.equal(sideEffects,0,'accepted linked-write guards run before SDK, Graph, or file work');

  for(const current of [unknownScope,nextGenerationScope]) {
    const retained=makeHandler({...base,surveyDefinition:{mode:'legacy'},documentSurveyDefinitionScopeRef:{current}});
    await assert.rejects(retained('/legacy-linked.xlsx'),/document changed|current document/i);
    assert.equal(sideEffects,0,'mode or generation-retired callback fails before any export side effect');
  }
});

test('viewer and AppShell wiring keep the feature off by default and publish only the narrow rail projection',()=>{
  assert.match(appSource,/documentSurveyDefinitionEnabled = false/);
  assert.match(appSource,/documentSurveyDefinitionEnabled=\{documentSurveyDefinitionEnabled\}/);
  const projectionStart=viewerSource.indexOf('  const effectiveSurveyTemplate = useMemo(');
  const projectionEnd=viewerSource.indexOf('  const documentEntityChoiceScope = useMemo(',projectionStart);
  const projection=viewerSource.slice(projectionStart,projectionEnd);
  assert.match(projection,/if \(surveyDefinition\.mode === 'legacy'\) return selectedTemplate/);
  assert.match(projection,/if \(surveyDefinition\.mode !== 'accepted'\) return null/);
  assert.match(projection,/name: 'Document survey'/);assert.match(projection,/modules: definition\.modules/);
  assert.doesNotMatch(projection,/linkedExcelPath|oneDrive|sharePoint/);
  const railStart=viewerSource.indexOf('    const nextRightRailApi = {');
  const railEnd=viewerSource.indexOf('    onRightRailApiChange((prev)',railStart);
  const rail=viewerSource.slice(railStart,railEnd);
  assert.match(rail,/documentSurveyDefinitionScope,/);assert.match(rail,/documentSurveyTemplate,/);
  assert.match(rail,/selectedTemplate,/,'private author template remains a separate MS and author config input');
  const dependencies=viewerSource.slice(railEnd,viewerSource.indexOf('  ]);',railEnd));
  assert.match(dependencies,/documentSurveyDefinitionScope,/);assert.match(dependencies,/documentSurveyTemplate,/);

  const buildOffsets=[];let offset=0;
  while((offset=viewerSource.indexOf('buildLocalDocumentState({',offset))!==-1){buildOffsets.push(offset);offset+=24;}
  assert.equal(buildOffsets.length,5,'every current viewer-managed snapshot path stays in this contract');
  for(const buildOffset of buildOffsets) {
    const call=viewerSource.slice(buildOffset,buildOffset+1050);
    assert.match(call,/entityCatalog:|managedLocalStateRef\.current/,
      'each managed snapshot carries the accepted entity list directly or through the tested full-state ref');
    assert.match(call,/surveyDefinition:|managedLocalStateRef\.current/,
      'each managed snapshot carries the accepted survey definition directly or through the tested full-state ref');
  }

  const noticeStart=viewerSource.indexOf('<DocumentSurveyDefinitionAdoptionNotice available={mayReviewSurveyDefinition}');
  assert.ok(noticeStart>0,'viewer renders the review notice');
  const notice=viewerSource.slice(noticeStart,noticeStart+650);
  assert.match(notice,/review=\{surveyDefinition\.review\}/);assert.match(notice,/busy=\{surveyDefinition\.busy\}/);
  assert.match(notice,/onRequest=\{\(\) => surveyDefinition\.requestAdoption\(selectedTemplate\)/);
  assert.match(notice,/onConfirm=\{\(\) => surveyDefinition\.confirmAdoption\(\)/);
  assert.match(notice,/onCancel=\{surveyDefinition\.cancelAdoption\}/);
});
