import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabChromeCache } from '../tabChromeCache.js';
function setup() {
 let active='A'; const state={};
 const setters=Object.fromEntries(['top','bottom','left','right'].map(key=>[key,next=>{
  state[key]=typeof next==='function'?next(state[key]):next;
 }]));
 const cache=createTabChromeCache(id=>active===id);
 return {cache,state,setters,activate:id=>{active=id;cache.activate(id,setters);}};
}
test('publisher callbacks keep one identity per mounted tab across state changes',()=>{
 const {cache,setters,activate}=setup();
 const a=cache.callbacks('A',setters);
 for(const kind of ['top','bottom','left','right']) a[kind]({name:'first'});
 activate('B');
 for(const kind of ['top','bottom','left','right']) a[kind]({name:'latest'});
 activate('A');
 const again=cache.callbacks('A',setters);
 assert.equal(again,a);
 for(const kind of ['top','bottom','left','right']) assert.equal(again[kind],a[kind]);
 cache.retain(['B']);
 assert.notEqual(cache.callbacks('A',setters),a,'a closed tab releases its publishers');
});
test('warm activation restores all four APIs before a click and stale methods cannot target another tab',()=>{
 const {cache,state,setters,activate}=setup();const calls=[];
 const a=cache.callbacks('A',setters),b=cache.callbacks('B',setters);
 for(const kind of ['top','bottom','left','right']) {
  a[kind]({name:'A',run:()=>calls.push(`A:${kind}`)});
  b[kind]({name:'B',run:()=>calls.push(`B:${kind}`)});
 }
 const stale=state.bottom;
 activate('B');stale.run();state.bottom.run();
 assert.deepEqual(calls,['B:bottom']);
 for(const kind of ['top','bottom','left','right'])assert.equal(state[kind].name,'B');
 activate('A');state.top.run();assert.deepEqual(calls,['B:bottom','A:top']);
});
test('hidden role refresh and stable callbacks use newest functions without parent render churn',()=>{
 const {cache,state,setters,activate}=setup();const calls=[];
 const a=cache.callbacks('A',setters);a.bottom({writable:true,run:()=>calls.push('old')});
 const original=state.bottom;
 a.bottom({writable:true,run:()=>calls.push('new')});
 assert.equal(state.bottom,original);original.run();assert.deepEqual(calls,['new']);
 activate('B');a.bottom({writable:false,run:()=>calls.push('revoked')});activate('A');
 assert.equal(state.bottom.writable,false);
});
test('functional owner-checked updates and nested Region actions stay scoped',()=>{
 const {cache,state,setters,activate}=setup();const calls=[];
 const token={};const a=cache.callbacks('A',setters);
 a.bottom({__ownerToken:token,activeTool:'pen',regionToolbarApi:{run:()=>calls.push('region')}});
 a.bottom(current=>({...current,activeTool:'text'}));assert.equal(state.bottom.activeTool,'text');
 const stale=state.bottom.regionToolbarApi;activate('B');stale.run();assert.deepEqual(calls,[]);
 activate('A');state.bottom.regionToolbarApi.run();assert.deepEqual(calls,['region']);
});
test('closing a tab releases snapshots and late cleanup cannot recreate them',()=>{
 const {cache,state,setters,activate}=setup();let calls=0;
 const a=cache.callbacks('A',setters);a.top({run:()=>calls++});const stale=state.top;
 cache.retain(['B']);a.top({run:()=>calls++});activate('A');stale.run();
 assert.equal(state.top,null);assert.equal(calls,0);
});
test('cold tabs have no armed API until their first publication',()=>{
 const {state,activate}=setup();activate('new');
 assert.deepEqual(state,{top:null,bottom:null,left:null,right:null});
});

test('nested Survey actions reject inactive snapshots and read updated hidden callbacks',()=>{
 const {cache,state,setters,activate}=setup();const calls=[];
 const a=cache.callbacks('A',setters);
 a.bottom({surveyToolbar:{onArmMarker:()=>calls.push('old'),onSelectTemplate:()=>calls.push('template')}});
 const stale=state.bottom.surveyToolbar;
 activate('B');stale.onArmMarker();stale.onSelectTemplate();assert.deepEqual(calls,[]);
 a.bottom({surveyToolbar:{onArmMarker:()=>calls.push('latest'),onSelectTemplate:()=>calls.push('new-template')}});
 activate('A');stale.onArmMarker();state.bottom.surveyToolbar.onSelectTemplate();
 assert.deepEqual(calls,['latest','new-template']);
});
