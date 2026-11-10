import test from 'node:test';
import assert from 'node:assert/strict';
import { calloutWrapsWords, textWrapsWords, wrapParagraph, wrapTextCss } from '../src/utils/textWrapMode.js';

// Every character is 1 unit wide.
const measure = (value) => [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(value)].length;

test('older marks keep the break-anywhere wrap', () => {
  assert.deepEqual(wrapParagraph('please confirm', 8, measure), ['please c', 'onfirm']);
  assert.equal(wrapTextCss(false).wordBreak, 'break-all');
});

test('word wrap breaks at spaces, spaces hang on the line they end', () => {
  assert.deepEqual(wrapParagraph('please confirm', 8, measure, { wrapWords: true }), ['please ', 'confirm']);
  assert.deepEqual(wrapParagraph('a b c d', 3, measure, { wrapWords: true }), ['a b ', 'c d']);
  assert.equal(wrapTextCss(true).wordBreak, 'normal');
  assert.equal(wrapTextCss(true).overflowWrap, 'anywhere');
});

test('a word wider than the box still breaks inside', () => {
  assert.deepEqual(wrapParagraph('go electromechanical', 6, measure, { wrapWords: true }), ['go ', 'electr', 'omecha', 'nical']);
});

test('CJK characters fill the line before it breaks', () => {
  assert.deepEqual(wrapParagraph('ab 漢字漢字', 5, measure, { wrapWords: true }), ['ab 漢字', '漢字']);
});

test('an emoji is never split', () => {
  const lines = wrapParagraph('👷🏽‍♀️👷🏽‍♀️👷🏽‍♀️', 2, measure, { wrapWords: true });
  assert.deepEqual(lines, ['👷🏽‍♀️👷🏽‍♀️', '👷🏽‍♀️']);
});

test('the mode lives on the mark', () => {
  assert.equal(textWrapsWords({ splitByGrapheme: false }), true);
  assert.equal(textWrapsWords({ splitByGrapheme: true }), false);
  assert.equal(textWrapsWords({}), false);
  assert.equal(calloutWrapsWords({ style: { wrapWords: true } }), true);
  assert.equal(calloutWrapsWords({ style: {} }), false);
});

test('new marks carry the mode through commit and the callout bridge', async () => {
  const { buildNewTextCommitJSON } = await import('../src/utils/textEditCommit.js');
  const { calloutToAnnotationObject, annotationObjectToCallout } = await import('../src/utils/calloutAnnotationBridge.js');
  const base = { text: 'hello there', left: 0, top: 0, innerWrapWidth: 100, naturalInnerHeight: 20 };
  assert.equal(buildNewTextCommitJSON({ ...base, style: { wrapWords: true } }).splitByGrapheme, false);
  assert.equal(buildNewTextCommitJSON(base).splitByGrapheme, true);
  const callout = {
    id: 'c1', pageNumber: 1, arrowTip: { x: 0.1, y: 0.1 }, knee: { x: 0.2, y: 0.2 },
    textBoxPosition: { x: 0.3, y: 0.3 }, textBoxWidth: 0.2, textBoxHeight: 0.05, text: 'hi',
    style: { fontSize: 12, wrapWords: true },
  };
  const page = { width: 612, height: 792 };
  const obj = calloutToAnnotationObject(callout, page);
  const box = obj.objects.find((c) => c.type === 'Textbox' || c.type === 'textbox');
  assert.equal(box.splitByGrapheme, false);
  const plain = calloutToAnnotationObject({ ...callout, style: { fontSize: 12 } }, page);
  assert.equal(plain.objects.find((c) => c.type === 'Textbox' || c.type === 'textbox').splitByGrapheme, true);
  const back = annotationObjectToCallout({ ...obj, data: { ...obj.data, legacyCallout: undefined } }, page);
  assert.equal(back.style.wrapWords, true);
});
