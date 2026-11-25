import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  END_OF_CONTENT_CLASS,
  endOfContentFor,
  guardTextLayerDrag,
  isEndOfContentNode,
} from '../src/utils/textLayerEndOfContent.js';

const makeLayer = () => {
  const dom = new JSDOM('<!doctype html><div class="pdfjsTextLayer is-interactive"><span>LIVING</span><span>KITCHEN</span></div>');
  const layer = dom.window.document.querySelector('.pdfjsTextLayer');
  return { dom, layer };
};

test('#1668: the guard puts a blank block after the text, and a press covers the layer with it', () => {
  const { dom, layer } = makeLayer();
  const unguard = guardTextLayerDrag(layer);
  const end = layer.lastElementChild;
  assert.equal(end.className, END_OF_CONTENT_CLASS);
  layer.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(layer.classList.contains('selecting'), true);
  dom.window.document.dispatchEvent(new dom.window.Event('pointerup'));
  assert.equal(layer.classList.contains('selecting'), false);
  assert.equal(layer.lastElementChild, end);
  unguard();
});

test('#1668: a layer rebuilt in place gets its block back on the next press', () => {
  const { dom, layer } = makeLayer();
  const unguard = guardTextLayerDrag(layer);
  layer.innerHTML = '<span>BATH</span>';
  layer.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(layer.querySelectorAll(`.${END_OF_CONTENT_CLASS}`).length, 1);
  assert.equal(endOfContentFor(layer), layer.lastElementChild);
  unguard();
});

test('#1669: a range never starts or ends on the blank block', () => {
  const { layer } = makeLayer();
  const end = endOfContentFor(layer);
  assert.equal(isEndOfContentNode(end), true);
  assert.equal(isEndOfContentNode(layer.firstElementChild.firstChild), false);
  const source = readFileSync(new URL('../src/utils/nativeTextDragSelection.js', import.meta.url), 'utf8');
  assert.match(source, /!isEndOfContentNode\(node\)/);
});

test('#1668: the interactive text layer turns the guard on and its styles carry the block', () => {
  const source = readFileSync(new URL('../src/components/PdfjsTextLayer.jsx', import.meta.url), 'utf8');
  assert.match(source, /const unguardDrag = guardTextLayerDrag\(el\);/);
  assert.match(source, /unguardDrag\(\);/);
  assert.match(source, /\$\{END_OF_CONTENT_CSS\}/);
});
