import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVisiblePageStack } from '../src/utils/visiblePageLayout.js';
import { pickCurrentPage } from '../src/utils/pageNavigationMath.js';
const pages = [{w:600,h:800},{w:1200,h:1600},{w:400,h:500}];
test('nonadjacent Spaces pages have no hidden-page gap and keep physical numbers', () => {
  const stack=buildVisiblePageStack({pageSizes:pages,visiblePageNumbers:[1,3],scale:2,gap:12});
  assert.deepEqual(stack.tops,[24,1648,1648]);
  assert.equal(stack.height,2672);
  assert.equal(stack.widestPt,600);
  assert.equal(stack.dims[1].hidden,true);
  assert.equal(pickCurrentPage({pageTops:stack.tops,pageHeights:stack.dims.map(d=>d.h*2),viewTop:1700,viewBottom:2400}),3);
});
test('all-page default keeps existing layout and rotation', () => {
  const stack=buildVisiblePageStack({pageSizes:pages,rotation:90,scale:1,gap:12});
  assert.deepEqual(stack.tops,[12,624,1836]);
  assert.equal(stack.height,2248);
  assert.equal(stack.widestPt,1600);
});
test('gap fallback never selects a hidden page at the end of a space', () => {
  assert.equal(pickCurrentPage({pageTops:[12,824,824],pageHeights:[800,0,0],viewTop:850,viewBottom:950}),1);
});
