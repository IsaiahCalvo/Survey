import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLegacyEntities } from '../src/utils/mergeLegacyEntities.js';

test('late legacy entities retain edited names/colors and new current definitions', () => {
  const current = [{id:'a', name:'User edit', color:'#112233'}, {id:'new', name:'User added'}];
  const legacy = [{id:'a', name:'Old name', color:'#ffffff'}, {id:'legacy-only',name:'Legacy custom'}, {id:'new',name:'Old collision'}];
  const result = mergeLegacyEntities(current, legacy, ['a']);
  assert.deepEqual(result, [...current, legacy[1]]);
  assert.equal(result[0], current[0]);
  assert.deepEqual(current, [{id:'a',name:'User edit',color:'#112233'},{id:'new',name:'User added'}]);
});

test('an entity removed while the legacy request waits is not resurrected', () => {
  const current = [{id:'keep',name:'Current'}];
  assert.equal(mergeLegacyEntities(current, [{id:'removed',name:'Deleted by user'}], ['keep','removed']), current);
});

test('duplicate and invalid legacy definitions produce no duplicate ids or replace current state', () => {
  const current = [{id:'keep',name:'Current'}];
  const legacy = [{id:'old',name:'First definition'},{id:'old',name:'Duplicate'},{name:'Missing id'},null,{id:'',name:'Empty id'}];
  assert.deepEqual(mergeLegacyEntities(current,legacy), [current[0],legacy[0]]);
  assert.equal(mergeLegacyEntities(current,null),current);
  assert.equal(mergeLegacyEntities(current, [{id:'keep',name:'Stale'}]),current);
});
