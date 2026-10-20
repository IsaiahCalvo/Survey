export async function installCloudMocks(page, { baseline = false } = {}) {
 await page.route('**/src/components/collab/YDocProvider.jsx*', async route => {
  const response = await route.fetch(); const source = await response.text();
  const reactPath = source.match(/from ["']([^"']*deps\/react\.js[^"']*)["']/)[1];
  await route.fulfill({contentType:'text/javascript',body:`import React from '${reactPath}';
import {YDocContext} from '/src/components/collab/YDocContext.js';
import ReadOnlyGate from '/src/components/collab/ReadOnlyGate.jsx';
export default function YDocProvider({docId,children,isActive}) {
 const [revoked,setRevoked]=React.useState(false); const [docRole,setRole]=React.useState('owner');
 window.warmRole ||= {}; window.warmRole[docId]=setRole;
 window.warmRevoke ||= {}; window.warmRevoke[docId]=setRevoked;
 const value={ydoc:null,isHydrating:false,isCRDTEnabled:true,docRole,role:'leader',accessRevoked:revoked,loginExpired:false,getOriginContext:()=>({source:'local'}),undoManager:null,undoCtx:null,getAwareness:()=>null};
 return React.createElement(YDocContext.Provider,{value},children,React.createElement(ReadOnlyGate,{isActive}));
}`});
 });
 await page.route('**/src/services/documentLockService.js*', async route => {
  const response=await route.fetch(); let source=await response.text();
  source=source.replace('export async function fetchDocumentLockState(', 'async function unusedWarmFetchDocumentLockState(').replace('export function subscribeDocumentLockState(', 'function unusedWarmSubscribeDocumentLockState(');
  source += `\nexport async function fetchDocumentLockState() { return null; }
export function subscribeDocumentLockState(id,listener) {
 window.warmLock ||= {}; window.warmLock[id]=listener;
 return ()=>{delete window.warmLock[id];};
}\n`;
  await route.fulfill({response,body:source});
 });
 await page.route('**/src/services/annotationDocSync.js*', async route => {
  const response=await route.fetch(); let source=await response.text();
  source=source.replace('export async function openAnnotationDoc(', 'async function unusedWarmOpenAnnotationDoc(');
  source += `\nexport async function openAnnotationDoc(options) {
 const id=options.documentId;
 window.warmOpens ||= {}; window.warmDestroys ||= {};
 window.warmOpens[id]=(window.warmOpens[id]||0)+1;
 options.onPreview?.({});
 await new Promise(resolve=>setTimeout(resolve,600));
 const doc=new Y.Doc(); let byPage={}; const meta=new Map();
 const methods={doc,getByPage:()=>byPage,getMeta:key=>meta.get(key),setMeta:(key,value)=>meta.set(key,value),getSurveyMarkers:()=>({}),applyByPage:value=>{byPage=value;return {};},applySurveyMarkers:()=>{},onChange:()=>{},getSyncStatus:()=>({stage:'idle',healthy:true}),destroy:async()=>{window.warmDestroys[id]=(window.warmDestroys[id]||0)+1;doc.destroy();},metaSubscribe:()=>()=>{},getDeletedPdfAnnotations:()=>[],getHistoryQuarantineGeneration:()=>0};
 return new Proxy(methods,{get:(target,key)=>key==='then'?undefined:(key in target?target[key]:(()=>undefined))});
}\n`;
  await route.fulfill({response,body:source});
 });
 if(baseline) await page.route('**/src/PDFViewer.jsx*',async route=>{
   const response=await route.fetch(); const source=(await response.text()).replace('enabled: cloudSyncEnabled &&', 'enabled: isActive && cloudSyncEnabled &&');
   await route.fulfill({response,body:source});
 });
}
