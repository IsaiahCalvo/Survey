// Times the sealed-doc OPEN hydrate passes over a realistic Y.Doc built via the
// REAL bridge. Splits: (1) materialization forEach (UNAVOIDABLE, feeds guards)
// vs (2) the 3 phase31 UAT diagnostic passes + 2 JSON.stringify now gated off.
import * as Y from 'yjs';
import { applyFabricCommit } from '../src/lib/collab/crdtAnnotationBridge.js';

const COUNT = Number(process.argv[2]) || 3057;
const PAGES = 7;
function makeAnnotations(n){ const out=[]; for(let i=0;i<n;i++){ const segs=[]; const sc=12+(i%20); for(let s=0;s<sc;s++) segs.push(['L',s*1.5,(s*0.7)%50]); out.push({pageNumber:1+(i%PAGES),type:'path',data:{id:`anno-${i}-0000-4000-8000-000000000000`,type:'ink',userId:(i%3===0)?'u1':'u2'},left:(i%800)+0.37,top:(i%600)+0.11,width:40+(i%120),height:30+(i%90),stroke:'#112233',strokeWidth:2,path:segs}); } return out; }

// --- exact copies of the open-path pure fns from useAnnotationCloudSync.js ---
function materializeAnnoFromYMap(annoYMap){ if(!annoYMap||typeof annoYMap.get!=='function')return null; const fabricYMap=annoYMap.get('fabric'); let fabricObj=null; if(fabricYMap){ if(typeof fabricYMap.toJSON==='function'){ try{fabricObj=fabricYMap.toJSON();}catch{fabricObj=null;} } if(!fabricObj&&typeof fabricYMap.forEach==='function'){ fabricObj={}; fabricYMap.forEach((v,k)=>{fabricObj[k]=v;}); } } if(!fabricObj)return null; const topId=annoYMap.get('id'); if(topId&&fabricObj.id==null)fabricObj.id=topId; try{ const m=annoYMap.get('meta'); if(m&&typeof m.get==='function'){ const aid=m.get('authorId'); if(aid&&fabricObj.authorId==null)fabricObj.authorId=aid; const lid=m.get('lastEditorId'); if(lid&&fabricObj.lastEditorId==null)fabricObj.lastEditorId=lid; } }catch{} return fabricObj; }
function __phase31UatBreakdown(byPage,viewerId){ let total=0,imported=0,drawnByMe=0,drawnByOthers=0; for(const page of Object.values(byPage||{})){ if(!page||!Array.isArray(page.objects))continue; for(const obj of page.objects){ total++; const isImp=obj?.type==='path'&&obj.left==null&&Array.isArray(obj.path); if(isImp){imported++;continue;} const a=obj?.data?.userId||obj?.data?.authorId||obj?.authorId||null; if(viewerId&&a===viewerId)drawnByMe++; else drawnByOthers++; } } return {total,imported,drawnByMe,drawnByOthers}; }
function __phase31UatYMapByType(yMap,viewerId){ const tbt={},tba={byMe:0,byOthers:0,anonymous:0},bta={},ptp={}; let total=0; if(!yMap||typeof yMap.forEach!=='function')return{total,tbt,tba,bta,ptp}; yMap.forEach((a)=>{ if(!a||typeof a.get!=='function')return; total++; const ft=a.get('type')||'unknown'; const pn=a.get('pageNumber')??'unknown'; let mid=null; try{const m=a.get('meta'); if(m&&typeof m.get==='function')mid=m.get('authorId')||null;}catch{} tbt[ft]=(tbt[ft]||0)+1; let b; if(!mid)b='anonymous'; else if(viewerId&&mid===viewerId)b='byMe'; else b='byOthers'; tba[b]++; if(!bta[ft])bta[ft]={byMe:0,byOthers:0,anonymous:0}; bta[ft][b]++; if(!ptp[ft])ptp[ft]={}; ptp[ft][pn]=(ptp[ft][pn]||0)+1; }); return {total,tbt,tba,bta,ptp}; }
function __phase31UatByPageByType(byPage){ const tbt={},ppt={}; let total=0; for(const [ps,page] of Object.entries(byPage||{})){ if(!page||!Array.isArray(page.objects))continue; for(const obj of page.objects){ total++; const t=obj?.data?.annotationType||obj?.type||'unknown'; tbt[t]=(tbt[t]||0)+1; if(!ppt[ps])ppt[ps]={}; ppt[ps][t]=(ppt[ps][t]||0)+1; } } return {total,tbt,ppt}; }

// build the Y.Doc the real way
const ydoc=new Y.Doc(); const origin=Object.freeze({source:'local-fabric',userId:'u1',deviceId:'d1'}); const ctx={userId:'u1',deviceId:'d1'};
const anns=makeAnnotations(COUNT);
ydoc.transact(()=>{ for(const a of anns) applyFabricCommit(ydoc, ydoc.getMap('annotations'), a, origin, ctx); }, origin);
const yMap=ydoc.getMap('annotations');
console.log(`built Y.Map entries: ${yMap.size} (requested ${COUNT})`);

function time(label,fn){ const t=performance.now(); const r=fn(); const ms=performance.now()-t; console.log(`${label.padEnd(42)} ${ms.toFixed(1)} ms`); return {ms,r}; }

// (1) UNAVOIDABLE: materialization forEach -> byPage (stays after my fix)
const mat=time('materialization forEach (KEPT)',()=>{ const byPage={}; yMap.forEach((annoYMap)=>{ if(!annoYMap||typeof annoYMap.get!=='function')return; const pn=annoYMap.get('pageNumber')??1; const fo=materializeAnnoFromYMap(annoYMap); if(!fo)return; if(!byPage[pn])byPage[pn]={version:'5.3.0',objects:[]}; byPage[pn].objects.push(fo); }); return byPage; });
const byPage=mat.r;

// (2) NOW-GATED diagnostics
const d1=time('__phase31UatBreakdown (GATED)',()=>__phase31UatBreakdown(byPage,'u1'));
const d2=time('__phase31UatYMapByType  (GATED)',()=>__phase31UatYMapByType(yMap,'u1'));
const d3=time('__phase31UatByPageByType(GATED)',()=>__phase31UatByPageByType(byPage));
const perPage={}; for(const [ps,po] of Object.entries(byPage)) perPage[ps]=po.objects.length;
const s1=time('JSON.stringify diag payload 1 (GATED)',()=>JSON.stringify({a:d1.r,perPage,pages:Object.keys(byPage).length}));
const s2=time('JSON.stringify diag payload 2 (GATED)',()=>JSON.stringify({yMapByType:d2.r.tbt,byTypeByAuthor:d2.r.bta,perTypePerPage:d2.r.ptp,byPageByType:d3.r.tbt,perPagePerType:d3.r.ppt}));

const gated=d1.ms+d2.ms+d3.ms+s1.ms+s2.ms;
console.log('-----');
console.log(`KEPT (materialization) ........ ${mat.ms.toFixed(1)} ms`);
console.log(`REMOVED (diagnostics, gated) .. ${gated.toFixed(1)} ms  across ${COUNT} marks`);
console.log(`open-hydrate passes before fix  ${(mat.ms+gated).toFixed(1)} ms ; after fix  ${mat.ms.toFixed(1)} ms`);
