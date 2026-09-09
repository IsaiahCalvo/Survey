import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureTemplateSurveyModules,
  createDocumentSurveyDefinitionClient,
  documentSurveyModuleDataKey,
  documentSurveySheetNameKey,
  validateDocumentSurveyDefinition,
} from '../src/services/documentSurveyDefinition.js';

const id = n => `10600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const documentId=id(1),templateId=id(2),operationId=id(3),updatedAt='2026-09-09T12:00:00Z';
const modules=[{id:'module',name:'Survey',categories:[{id:'category',name:'General',checklist:[
  {id:'one',text:'Installed'},{id:'old',text:'Old',archived:true,archivedAt:updatedAt,lastKnownLabel:'Old label'},
]}]}];
const preview={status:'preview',version:1,documentId,source:{templateId,templateUpdatedAt:updatedAt,
  structureSha256:'a'.repeat(64)},modules};
const accepted={...preview,status:'accepted',definitionRevision:1,
  seed:{operationId,requestSha256:'b'.repeat(64)}};

test('strict definition wire preserves optional archive-field presence and excludes private template data', () => {
  const value=validateDocumentSurveyDefinition(accepted,documentId);
  assert.deepEqual(value,accepted);
  assert.equal(Object.hasOwn(value.modules[0].categories[0].checklist[0],'archived'),false);
  assert.equal(value.modules[0].categories[0].checklist[1].archived,true);
  for(const changed of [null,false,0,{},[]]) {
    const bad=structuredClone(accepted);bad.modules[0].categories[0].checklist[1].archivedAt=changed;
    assert.throws(()=>validateDocumentSurveyDefinition(bad,documentId));
  }
  const publicOnly=captureTemplateSurveyModules({modules:[{...modules[0],privateWorkbookId:'secret'}]});
  assert.equal(Object.hasOwn(publicOnly[0],'privateWorkbookId'),false);
});

test('source aliases must agree and IDs, headers, checklist text, and sheet keys stay unique', () => {
  assert.deepEqual(captureTemplateSurveyModules({modules,spaces:structuredClone(modules)}),modules);
  const invalid=[
    {modules,spaces:[]},
    {modules:[{...modules[0],categories:[...modules[0].categories,{...modules[0].categories[0]}]}]},
    {modules:[{...modules[0],categories:[{...modules[0].categories[0],checklist:[{id:'x',text:'Item'}]}]}]},
    {modules:[{...modules[0],categories:[{...modules[0].categories[0],checklist:[{id:'x',text:' A ' }]}]}]},
    {modules:[{id:'a',name:'A/B',categories:[{id:'a-c',name:'C',checklist:[]}]},
      {id:'b',name:'A:B',categories:[{id:'b-c',name:'C',checklist:[]}]}]},
  ];
  invalid.forEach(value=>assert.throws(()=>captureTemplateSurveyModules(value)));
});

test('module and sheet identity helpers pin lower-before-strip and current Excel cleanup', () => {
  assert.equal(documentSurveyModuleDataKey('ΟΣ Σ'),'οςσData');
  assert.notEqual(documentSurveyModuleDataKey('ΟΣ Σ'),documentSurveyModuleDataKey('Ο Σ'));
  assert.equal(documentSurveyModuleDataKey('A\u00a0B'),'abData');
  assert.equal(documentSurveyModuleDataKey('A\ufeffB'),'abData');
  assert.equal(documentSurveySheetNameKey('A/B','M'),'ab - m');
  assert.equal(documentSurveySheetNameKey('1234567890123456789012345678901A','M').length,31);
  assert.throws(()=>documentSurveySheetNameKey(`123456789012345678901234567890😀A`,'M'),
    'a 31-unit cut cannot split an astral character');
});

test('wire timestamps require strict RFC3339 values', () => {
  for(const value of ['2026-09-09','2026-09-09 12:00:00Z','2026-09-09T12:00:00','not-a-time',
    '2026-02-30T12:00:00Z','2025-02-29T12:00:00Z','2026-09-09T12:00:00+14:01']) {
    const bad=structuredClone(preview);bad.source.templateUpdatedAt=value;
    assert.throws(()=>validateDocumentSurveyDefinition({...bad,status:'accepted',definitionRevision:1,
      seed:{operationId,requestSha256:'b'.repeat(64)}},documentId));
  }
  for(const value of ['2024-02-29T12:00:00Z','2026-09-09T12:00:00.123456-14:00']) {
    const good=structuredClone(accepted);good.source.templateUpdatedAt=value;
    assert.doesNotThrow(()=>validateDocumentSurveyDefinition(good,documentId));
  }
  assert.doesNotThrow(()=>validateDocumentSurveyDefinition(accepted,documentId));
});

test('array limits reject before mapping attacker-controlled entries', () => {
  const tooManyModules=Array.from({length:65},(_,n)=>({id:`m${n}`,name:`M${n}`,categories:[]}));
  let moduleGetterTouched=false;
  Object.defineProperty(tooManyModules,64,{get(){moduleGetterTouched=true;return {};}});
  assert.throws(()=>captureTemplateSurveyModules({modules:tooManyModules}));
  assert.equal(moduleGetterTouched,false,'module entries are not read past the pre-map bound');
  const tooManyItems=Array.from({length:257},(_,n)=>({id:`i${n}`,text:`Check ${n}`}));
  let itemGetterTouched=false;
  Object.defineProperty(tooManyItems,256,{get(){itemGetterTouched=true;return {};}});
  assert.throws(()=>captureTemplateSurveyModules({modules:[{id:'m',name:'M',categories:[
    {id:'c',name:'C',checklist:tooManyItems}]}]}));
  assert.equal(itemGetterTouched,false,'checklist entries are not read past the per-category bound');

  const categories=Array.from({length:1025},(_,n)=>({id:`c${n}`,name:`C${n}`,checklist:[]}));
  let categoryGetterTouched=false;
  Object.defineProperty(categories,1024,{get(){categoryGetterTouched=true;return {};}});
  assert.throws(()=>captureTemplateSurveyModules({modules:[{id:'m',name:'M',categories}]}));
  assert.equal(categoryGetterTouched,false,'category entries are not read past the aggregate bound');

  const firstCategories=Array.from({length:600},(_,n)=>({id:`a${n}`,name:`A${n}`,checklist:[]}));
  const secondCategories=Array.from({length:425},(_,n)=>({id:`b${n}`,name:`B${n}`,checklist:[]}));
  let aggregateGetterTouched=false;
  Object.defineProperty(secondCategories,0,{get(){aggregateGetterTouched=true;return {};}});
  assert.throws(()=>captureTemplateSurveyModules({modules:[
    {id:'a',name:'A',categories:firstCategories},{id:'b',name:'B',categories:secondCategories},
  ]}));
  assert.equal(aggregateGetterTouched,false,'aggregate category budget rejects before mapping the next array');
});

test('client keeps preview and adoption separate and maps disabled stale conflict and forbidden errors', async () => {
  const calls=[];
  const client=createDocumentSurveyDefinitionClient({enabled:true,rpc:async(name,args)=>{calls.push([name,args]);
    return {data:name.startsWith('preview')?preview:{...accepted,
      seed:{operationId:args.p_operation_id,requestSha256:args.p_request_sha256}}};}});
  const reviewed=await client.preview({documentId,templateId});
  await client.adopt({preview:reviewed,operationId});
  assert.equal(calls.length,2);
  assert.equal(Object.hasOwn(calls[1][1],'p_modules'),false,'client sends review proof, never caller modules');
  const disabled=createDocumentSurveyDefinitionClient({enabled:false,rpc:async()=>assert.fail()});
  await assert.rejects(disabled.read({documentId}),{code:'DOCUMENT_SURVEY_DEFINITION_DISABLED'});
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(client.preview({documentId,templateId,signal:aborted.signal}),{code:'DOCUMENT_SURVEY_DEFINITION_STALE'});
  for(const [cause,code] of [[{code:'40001'},'DOCUMENT_SURVEY_DEFINITION_CONFLICT'],
    [{code:'42501'},'DOCUMENT_SURVEY_DEFINITION_FORBIDDEN']]) {
    const failing=createDocumentSurveyDefinitionClient({enabled:true,rpc:async()=>({error:cause})});
    await assert.rejects(failing.read({documentId}),{code});
  }
});
