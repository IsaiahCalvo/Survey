import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useDocumentSurveyDefinition } from '../src/hooks/useDocumentSurveyDefinition.js';
import { buildLocalDocumentState, createLocalDocumentStateReader } from '../src/services/localDocumentState.js';

const id=n=>`d1600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const localId=n=>`local:${id(n)}`;
const actor=id(1),templateId=id(2),updatedAt='2026-09-09T12:00:00Z';
const template={id:templateId,name:'Reviewed',updatedAt,modules:[{id:'module',name:'Module',categories:[
  {id:'category',name:'Category',checklist:[{id:'check',text:'Check'}]},
]}]};
const managedDefinition=documentId=>({status:'accepted',version:1,documentId,definitionRevision:1,
  sourceTemplateId:templateId,sourceTemplateUpdatedAt:updatedAt,sourceStructureSha256:'a'.repeat(64),modules:template.modules});
const accepted=documentId=>({status:'accepted',version:1,documentId,definitionRevision:1,
  source:{templateId,templateUpdatedAt:updatedAt,structureSha256:'a'.repeat(64)},
  seed:{operationId:id(8),requestSha256:'b'.repeat(64)},modules:template.modules});
const unadopted=documentId=>({status:'unadopted',version:1,documentId});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const waitFor=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await act(async()=>new Promise(resolve=>setImmediate(resolve)));}
  assert.fail('mounted definition state did not settle');};
const localFile=n=>{const value={localId:localId(n),_surveyPdfId:localId(n),storageMode:'local'};
  value._localDocumentState=buildLocalDocumentState({pdfId:value.localId});return value;};
const readManagedLocal=file=>{const raw=createLocalDocumentStateReader(file).getItem(`surveyDefinition_${file.localId}`);
  return raw?JSON.parse(raw):null;};

function mounted(t,{strict=false}={}) {
  const dom=new JSDOM('<div id="root"></div>');const prior=new Map();
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})) {
    prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const root=createRoot(document.getElementById('root'));let latest;let reports=0;
  function Probe({input}) {const value=useDocumentSurveyDefinition(input);latest=value;reports++;return null;}
  const render=input=>act(async()=>root.render(strict?React.createElement(React.StrictMode,null,React.createElement(Probe,{input})):
    React.createElement(Probe,{input})));
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();for(const [key,descriptor] of [...prior].reverse())
    descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  return{render,latest:()=>latest,reports:()=>reports};
}

async function startLocalAdoption(h,file,persistManagedLocal,isCurrent=()=>true) {
  const input={enabled:true,file,actorUserId:actor,template,readManagedLocal,persistManagedLocal,isCurrent};
  await h.render(input);assert.equal(h.latest().mode,'legacy');
  await act(async()=>h.latest().requestAdoption());await waitFor(()=>h.latest().review);
  let confirming;await act(async()=>{confirming=h.latest().confirmAdoption();await new Promise(resolve=>setImmediate(resolve));});
  return{input,confirming};
}

for(const scenario of ['feature disabled','A-B-A scope','caller inactive then active','same-ID file replacement']) {
  test(`late local commit never exposes legacy after ${scenario}`,async t=>{
    const h=mounted(t);const fileA=localFile(10),fileB=scenario==='same-ID file replacement'
      ? {...localFile(10),_localDocumentState:buildLocalDocumentState({pdfId:localId(10)})}:localFile(11);
    const gate=deferred();let persistCalls=0;let callerActive=true;
    const persist=async(file,definition)=>{persistCalls++;await gate.promise;
      file._localDocumentState=buildLocalDocumentState({pdfId:file.localId,surveyDefinition:definition});};
    const started=await startLocalAdoption(h,fileA,persist,()=>callerActive);await waitFor(()=>persistCalls===1);
    if(scenario==='feature disabled') await h.render({...started.input,enabled:false});
    if(scenario==='A-B-A scope') {await h.render({...started.input,file:fileB});await h.render(started.input);}
    if(scenario==='caller inactive then active') {callerActive=false;await h.render({...started.input,isCurrent:()=>callerActive});}
    if(scenario==='same-ID file replacement') await h.render({...started.input,file:fileB});
    await act(async()=>{gate.resolve();await assert.rejects(started.confirming);});
    if(scenario==='caller inactive then active') {callerActive=true;await h.render({...started.input,isCurrent:()=>callerActive});}
    assert.equal(readManagedLocal(fileA)?.status,'accepted','durable write completed');
    assert.equal(h.latest().mode,scenario==='same-ID file replacement'?'unknown':'accepted',
      'the exact file reconciles its commit while a replacement never inherits it');
    assert.equal(h.latest().busy,false,'retired work cannot leave the active scope save-locked');
    assert.ok(h.reports()<40,'scope reconciliation does not cause a render loop');
  });
}

for(const switchKind of ['actor','generation']) {
  test(`late local commit does not clear a different ${switchKind} scope review`,async t=>{
    const h=mounted(t);const file=localFile(switchKind==='actor'?12:13),gate=deferred();let writes=0;
    const persist=async(target,definition)=>{writes++;await gate.promise;
      target._localDocumentState=buildLocalDocumentState({pdfId:target.localId,surveyDefinition:definition});};
    const first=await startLocalAdoption(h,file,persist);await waitFor(()=>writes===1);
    const nextInput={...first.input,actorUserId:switchKind==='actor'?id(99):actor};
    if(switchKind==='generation') file.pdfGenerationId=id(98);
    await h.render(nextInput);assert.equal(h.latest().mode,'legacy');
    await act(async()=>h.latest().requestAdoption());await waitFor(()=>Boolean(h.latest().review));
    const currentReview=h.latest().review;
    await act(async()=>{gate.resolve();await assert.rejects(first.confirming);});
    assert.equal(h.latest().review,currentReview,'old completion cannot clear the active review');
    assert.equal(h.latest().busy,false);assert.ok(h.reports()<40);
  });
}

test('StrictMode local review remains usable through a durable commit',async t=>{
  const h=mounted(t,{strict:true});const file=localFile(20);let calls=0;
  const persist=async(target,definition)=>{calls++;target._localDocumentState=buildLocalDocumentState({pdfId:target.localId,surveyDefinition:definition});};
  const started=await startLocalAdoption(h,file,persist);
  await act(async()=>started.confirming);await waitFor(()=>h.latest().mode==='accepted');
  assert.equal(calls,1);assert.equal(h.latest().definition.documentId,file.localId);
});

test('disabling after durable intent reserve prevents cloud dispatch and keeps the intent',async t=>{
  const h=mounted(t);const documentId=id(30),markGate=deferred();let latestRow=null,adopts=0,markCalls=0;
  const preview={status:'preview',version:1,documentId,source:{templateId,templateUpdatedAt:updatedAt,
    structureSha256:'a'.repeat(64)},modules:template.modules};
  const store={get:async()=>null,getAccepted:async()=>null,putAccepted:async()=>assert.fail('no accepted write'),finish:async()=>assert.fail('intent stays'),
    reserve:async(_actor,_document,value)=>{latestRow={...value,phase:'pending',revision:1};return{created:true,row:latestRow};},
    markDispatched:async()=>{markCalls++;await markGate.promise;latestRow={...latestRow,phase:'dispatched'};return latestRow;}};
  const cloudClient={read:async()=>unadopted(documentId),preview:async()=>preview,
    adopt:async()=>{adopts++;return accepted(documentId);}};
  const input={enabled:true,file:{id:documentId},actorUserId:actor,template,cloudClient,adoptionStore:store};
  await h.render(input);await waitFor(()=>h.latest().mode==='legacy');await act(async()=>h.latest().requestAdoption());
  let confirming;await act(async()=>{confirming=h.latest().confirmAdoption();await waitFor(()=>markCalls===1);});
  await h.render({...input,enabled:false});await act(async()=>{markGate.resolve();await assert.rejects(confirming);});
  assert.equal(adopts,0);assert.equal(latestRow.phase,'dispatched');
});

test('forbidden authoritative read never falls back to an accepted cache for the same scope',async t=>{
  const h=mounted(t);const documentId=id(40),cached=accepted(documentId);
  const store={get:async()=>null,getAccepted:async()=>cached};
  const error=Object.assign(new Error('forbidden'),{code:'DOCUMENT_SURVEY_DEFINITION_FORBIDDEN'});
  await h.render({enabled:true,file:{id:documentId},actorUserId:actor,template,adoptionStore:store,
    cloudClient:{read:async()=>{throw error;}}});
  await waitFor(()=>Boolean(h.latest().error));assert.equal(h.latest().mode,'unknown');assert.equal(h.latest().definition,null);
});
