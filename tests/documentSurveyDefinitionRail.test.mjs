import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let vite;
let SurveySpacesRail;
before(async () => {
  vite=await createServer({configFile:false,envDir:false,appType:'custom',server:{middlewareMode:true,hmr:false}});
  ({default:SurveySpacesRail}=await vite.ssrLoadModule('/src/SurveySpacesRail.jsx'));
});
after(async()=>vite?.close());

const entity={id:'entity',name:'Complete document entity',color:'#123456'};
const privateTemplate={id:'private-template',name:'Private author template',linkedExcelPath:'/private/source.xlsx',
  entities:[{id:'private-entity',name:'Private entity',color:'#654321'}],modules:[{id:'private-module',name:'Private module',
    categories:[{id:'private-category',name:'Private category',checklist:[{id:'private-check',text:'Private check'}]}]}]};
const definition={id:'source-template',name:'Document survey',modules:[{id:'module',name:'Document module',
  categories:[{id:'category',name:'Document category',checklist:[
    {id:'active-check',text:'Document check'},
    {id:'archived-check',text:'Archived check',archived:true,archivedAt:'2026-09-09T12:00:00Z',lastKnownLabel:'Archived check'},
  ]}]}]};

function mountRail(t,{mobileMode=false}={}) {
  const dom=new JSDOM('<div id="root"></div>');const prior=new Map();
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})) {
    prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const root=createRoot(document.getElementById('root'));const calls={templates:0,markers:0,items:0,annotations:0,exports:0,
    addCategory:0,reorder:0,deleteCategory:0};let unmounted=false,currentMarkers,currentItems;
  const noop=()=>{};
  function Probe({survey,scope,selectedTemplate=privateTemplate,showPanel=true}) {
    const [markers,setMarkers]=useState({mark:{name:'Marker',moduleId:'module',categoryId:'category',entityId:'entity',
      entityName:'Saved entity',entityColor:'#abcdef'}});
    const [items,setItems]=useState({item:{itemId:'item',name:'Marker',itemType:'Document category',moduleData:{}}});
    currentMarkers=markers;currentItems=items;
    const countSet=(key,setter)=>change=>{calls[key]++;setter(old=>{const next=typeof change==='function'?change(old):change;
      if(key==='markers')currentMarkers=next;if(key==='items')currentItems=next;return next;});};
    return React.createElement(SurveySpacesRail,{
      documentSurveyTemplate:survey,documentSurveyDefinitionScope:scope,documentEntityChoices:[entity],
      documentEntityChoiceScope:scope,pdfFile:scope?.file,user:{id:'actor'},selectedTemplate,
      selectedModuleId:survey===undefined?'private-module':'module',selectedCategoryId:survey===undefined?'private-category':'category',
      selectedCategories:{},surveyTemplates:[privateTemplate],surveyMarkers:markers,setSurveyMarkers:countSet('markers',setMarkers),
      items,setItems:countSet('items',setItems),annotations:{},setAnnotations:()=>{calls.annotations++;},
      annotationsByPage:{},setAnnotationsByPage:noop,expandedCategories:{category:true,'private-category':true},
      setExpandedCategories:noop,expandedSurveyMarkers:{mark:true},setExpandedSurveyMarkers:noop,
      selectedItemsInCategory:{},setSelectedItemsInCategory:noop,copiedItemSelection:{},setCopiedItemSelection:noop,
      itemSelectModeActive:{},setItemSelectModeActive:noop,categorySelectModeActive:false,
      setCategorySelectModeActive:noop,setCategorySelectModeForCategory:noop,copyModeActive:false,setCopyModeActive:noop,
      activeSpaceId:'space',selectedSpaceId:'space',spaces:[],mobileMode,showSurveyPanel:showPanel,expandRequestKey:1,
      getCategoryName:(_template,_module,id)=>id==='category'?'Document category':'Private category',
      getModuleName:(_template,id)=>id==='module'?'Document module':'Private module',getModuleDataKey:()=> 'moduleData',
      normalizeSurveyMarkerColor:value=>value,DEFAULT_SURVEY_MARKER_OPACITY:0.35,features:{},showToast:noop,
      setActiveTool:noop,setSelectedCategoryId:noop,setSelectedModuleId:noop,setSelectedSpaceId:noop,
      setShowSurveyPanel:noop,setShowSpaceSelection:noop,setPendingLocationItem:noop,setNoteDialogContent:noop,
      setNoteDialogOpen:noop,setNewSurveyMarkersByPage:noop,setSurveyMarkersToRemoveByPage:noop,
      handleSurveyToggle:noop,handleToggleSurveyAnnotations:noop,handleToggleCanvasAnnotations:noop,
      handleToggleRegionOverlay:noop,getSurveyAnnotationVisibilityState:()=>true,getCanvasAnnotationVisibilityState:()=>true,
      isRegionOverlayEnabled:true,isRegionOverlayToggleEnabled:true,isExporting:false,linkedExcelExists:true,
      handleExportSurveyToExcel:()=>{calls.exports++;},onSelectSurveyTemplate:()=>{calls.templates++;},
      onRequestCreateTemplate:()=>{calls.templates++;},addCategoryToCurrentTemplate:()=>{calls.addCategory++;},
      addCategoryAsNewTemplate:()=>{calls.addCategory++;},handleReorderSurveyCategories:()=>{calls.reorder++;},
      deleteCategory:()=>{calls.deleteCategory++;},setShowExportMenu:noop,showExportMenu:false,
    });
  }
  const render=(survey,scope={actorUserId:'actor',tabId:'tab-a',file:{id:'doc-a'}},selectedTemplate=privateTemplate,showPanel=true)=>
    act(async()=>root.render(React.createElement(Probe,{survey,scope,selectedTemplate,showPanel})));
  t.after(async()=>{if(!unmounted)await act(async()=>root.unmount());dom.window.close();for(const [key,descriptor] of [...prior].reverse())
    descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  return {render,calls,markers:()=>currentMarkers,items:()=>currentItems,
    unmount:()=>act(async()=>{root.unmount();unmounted=true;})};
}

const retainedClick=node=>node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))].onClick;

test('accepted document survey renders static structure without a private template and permits manual export',async t=>{
  const h=mountRail(t);await h.render(definition,undefined,null);
  const text=document.body.textContent;
  assert.match(text,/Document survey|Document module/);assert.match(text,/Document category/);assert.match(text,/Document check/);
  assert.doesNotMatch(text,/Private author template|Private module|Private category|Private check|Archived check/);
  assert.equal(document.querySelector('[aria-label="Create category"]'),null);
  assert.equal(document.querySelector('.survey-marker-category-select-button'),null);
  assert.equal(document.querySelector('[aria-label="Choose survey template"]'),null);
  assert.doesNotMatch(text,/Sync Microsoft 365|Open Excel|Delete selected categories/);
  const exportButton=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()==='EXPORT');
  assert.ok(exportButton,'accepted static surveys retain manual export');await act(async()=>exportButton.click());
  assert.equal(h.calls.exports,1);
  const yes=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()==='Y');
  assert.ok(yes,'accepted checklist is interactive');await act(async()=>yes.click());
  assert.equal(h.calls.markers,1,'checklist click reaches the parent marker setter');
  assert.equal(h.markers().mark.checklistResponses?.['active-check']?.selection,'Y',JSON.stringify(h.markers()));
  assert.equal(h.items().item.moduleData.entityId,entity.id);
  assert.equal(h.markers().mark.entityId,entity.id,'completion resolves from document entity choices');
});

test('null document survey is authoritative unknown and never exposes private structure',async t=>{
  const h=mountRail(t);await h.render(null);
  assert.doesNotMatch(document.body.textContent,/Private module|Private category|Private check/);
  assert.equal(document.querySelector('[aria-label="Create category"]'),null);
});

test('an omitted document survey prop keeps the legacy private author flow',async t=>{
  const h=mountRail(t);await h.render(undefined);
  assert.match(document.body.textContent,/Private author template|Private category|Private check/);
  assert.ok(document.querySelector('[aria-label="Create category"]'));
});

test('cold accepted definition renders saved structure even when legacy panel state reset false',async t=>{
  const h=mountRail(t);await h.render(definition,undefined,privateTemplate,false);
  assert.match(document.body.textContent,/Document survey|Document module/);
  assert.match(document.body.textContent,/Document category|Document check/);
  assert.doesNotMatch(document.body.textContent,/Private author template|Private module|Private check/);
  assert.equal(document.querySelector('[aria-label="Choose survey template"]'),null);
});

test('cold unknown definition renders an explicit unavailable state and never the private picker',async t=>{
  const h=mountRail(t);await h.render(null,undefined,privateTemplate,false);
  assert.ok(document.querySelector('[data-document-survey-definition-unavailable]'));
  assert.match(document.body.textContent,/Document survey structure unavailable/);
  assert.doesNotMatch(document.body.textContent,/Private author template|Private module|Private check/);
  assert.equal(document.querySelector('[aria-label="Choose survey template"]'),null);
});

test('cold legacy undefined keeps its prior panel-hidden behavior',async t=>{
  const h=mountRail(t);await h.render(undefined,undefined,privateTemplate,false);
  assert.doesNotMatch(document.body.textContent,/Document category|Document check/);
  assert.equal(document.querySelector('[data-document-survey-definition-unavailable]'),null);
});

test('retained legacy author callback cannot write after adoption, null, A-B-A, or unmount',async t=>{
  const h=mountRail(t,{mobileMode:true});const fileA={id:'doc-a'},fileB={id:'doc-b'};
  const scopeA={actorUserId:'actor',tabId:'tab-a',file:fileA},scopeB={actorUserId:'actor',tabId:'tab-b',file:fileB};
  await h.render(undefined,scopeA);await act(async()=>document.querySelector('[aria-label="Choose survey template"]').click());
  const oldClick=retainedClick([...document.querySelectorAll('[role="option"]')].find(node=>node.textContent.includes('Private author')));
  for(const [survey,scope] of [[definition,scopeA],[null,scopeB],[undefined,scopeB],[undefined,scopeA]]) {
    await h.render(survey,scope);const before=h.calls.templates;await act(async()=>oldClick());assert.equal(h.calls.templates,before);
  }
  const generationScope={...scopeA,pdfGenerationId:'generation-b'};
  await h.render(undefined,generationScope);const beforeGenerationClick=h.calls.templates;
  await act(async()=>oldClick());assert.equal(h.calls.templates,beforeGenerationClick);
  await h.unmount();const before=h.calls.templates;await oldClick();assert.equal(h.calls.templates,before);
});
