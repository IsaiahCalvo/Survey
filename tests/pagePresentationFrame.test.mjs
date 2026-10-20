import test from 'node:test';
import assert from 'node:assert/strict';
import { clientPointInPageFrame, clientPastePointInPageFrame } from '../src/utils/pagePresentation.js';
const frame={left:10,top:20,width:200,height:100};
const size={width:400,height:200};
test('invalid viewBox or pointer measurements cannot write NaN mark geometry',()=>{
  for(const value of [NaN,Infinity,0,-1,undefined]) {
    assert.equal(clientPointInPageFrame({clientX:50,clientY:50},frame,{...size,width:value}),null);
    assert.equal(clientPointInPageFrame({clientX:50,clientY:50},frame,{...size,height:value}),null);
  }
  for(const value of [NaN,Infinity,undefined]) {
    assert.equal(clientPointInPageFrame({clientX:value,clientY:50},frame,size),null);
    assert.equal(clientPointInPageFrame({clientX:50,clientY:value},frame,size),null);
  }
});
test('reflection converts client coordinates independently for both axes',()=>{
  assert.deepEqual(clientPointInPageFrame({clientX:50,clientY:50},frame,size),{x:80,y:60});
  assert.deepEqual(clientPointInPageFrame({clientX:50,clientY:50},{...frame,mirrorH:true},size),{x:320,y:60});
  assert.deepEqual(clientPointInPageFrame({clientX:50,clientY:50},{...frame,mirrorV:true},size),{x:80,y:140});
});
test('captured pointers outside the page stay outside for the gesture to clamp',()=>{
  const plain=clientPointInPageFrame({clientX:0,clientY:130},frame,size);assert.equal(plain.x,-20);assert.ok(Math.abs(plain.y-220)<1e-10);
  const reflected=clientPointInPageFrame({clientX:0,clientY:130},{...frame,mirrorH:true,mirrorV:true},size);assert.equal(reflected.x,420);assert.ok(Math.abs(reflected.y+20)<1e-10);
});

test('group paste keeps the same visible upper-left anchor and repeat direction under mirrors',()=>{
  const extent={width:80,height:40};
  assert.deepEqual(clientPastePointInPageFrame({clientX:50,clientY:50},frame,size,{extent,repeatOffset:16}),{x:96,y:76});
  assert.deepEqual(clientPastePointInPageFrame({clientX:50,clientY:50},{...frame,mirrorH:true,mirrorV:true},size,{extent,repeatOffset:16}),{x:224,y:84});
  assert.equal(clientPastePointInPageFrame({clientX:50,clientY:50},frame,{width:NaN,height:200},{extent}),null);
});
