// KAL-397 — Settings -> Annotations -> "Fit text boxes to their text".
//
// The switch (utils/annotationPreferences.js, this device's localStorage)
// decides whether a text commit tightens the box:
//   On (default): a new box hugs its text and is marked data.textAutoFit; a
//     re-edit of a marked box fits it again (it may shrink); a hand resize
//     clears the mark, so the user's size is kept from then on.
//   Off: no commit ever tightens; a new box keeps the size it was drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TEXT_PADDING,
  buildNewTextCommitJSON,
  buildExistingTextCommitJSON,
  shouldAutoFitExistingText,
} from '../src/utils/textEditCommit.js';
import {
  TEXTBOX_AUTO_FIT_KEY,
  TEXTBOX_AUTO_FIT_DEFAULT,
  readTextboxAutoFit,
  writeTextboxAutoFit,
  lockTextboxSizeAfterResize,
} from '../src/utils/annotationPreferences.js';

const pad = TEXT_PADDING;

function withStorage(store, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  try { return fn(); } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true, writable: true });
    else delete globalThis.localStorage;
  }
}
const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    map,
  };
};

// ------------------------------------------------------------ the setting

test('preference: defaults to on, persists on/off under its own key', () => {
  assert.equal(TEXTBOX_AUTO_FIT_DEFAULT, true);
  const store = memoryStorage();
  withStorage(store, () => {
    assert.equal(readTextboxAutoFit(), true, 'nothing stored -> on');
    assert.equal(writeTextboxAutoFit(false), false);
    assert.equal(store.map.get(TEXTBOX_AUTO_FIT_KEY), 'off');
    assert.equal(readTextboxAutoFit(), false, 'a reload reads it back');
    writeTextboxAutoFit(true);
    assert.equal(store.map.get(TEXTBOX_AUTO_FIT_KEY), 'on');
    assert.equal(readTextboxAutoFit(), true);
    store.setItem(TEXTBOX_AUTO_FIT_KEY, 'garbage');
    assert.equal(readTextboxAutoFit(), true, 'an unknown value falls back to the last choice / default');
  });
});

test('preference: blocked storage never throws and keeps this page\'s choice', () => {
  const blocked = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
  };
  withStorage(blocked, () => {
    assert.doesNotThrow(() => writeTextboxAutoFit(false));
    assert.equal(readTextboxAutoFit(), false);
    writeTextboxAutoFit(true);
    assert.equal(readTextboxAutoFit(), true);
  });
});

// ------------------------------------------------------------ new boxes

const NEW_BOX = {
  text: 'hi',
  left: 10,
  top: 20,
  innerWrapWidth: 300,
  maxLineWidth: 30,
  lineCount: 1,
  naturalInnerHeight: 21,
};

test('new box, switch on: hugs the text and carries the auto-fit mark', () => {
  const json = buildNewTextCommitJSON({ ...NEW_BOX, autoFit: true, minOuterHeight: 200 });
  assert.equal(json.width, 32 + 2 * pad);
  assert.equal(json.height, 21 + 2 * pad, 'a dragged height is not kept while auto-fit is on');
  assert.equal(json.data.textAutoFit, true);
});

test('new box, default call (no autoFit given) behaves exactly as before plus the mark', () => {
  const json = buildNewTextCommitJSON(NEW_BOX);
  assert.equal(json.width, 32 + 2 * pad);
  assert.equal(json.height, 21 + 2 * pad);
  assert.equal(json.data.textAutoFit, true);
});

test('new box, switch off: keeps the drawn width and dragged height, no mark', () => {
  const json = buildNewTextCommitJSON({ ...NEW_BOX, autoFit: false, minOuterHeight: 200 });
  assert.equal(json.width, 300 + 2 * pad, 'never tightened to the text');
  assert.equal(json.height, 200, 'the dragged height stays');
  assert.equal(json.data.textAutoFit, undefined);
  // ...but it still grows when the text needs more room than was drawn.
  const tall = buildNewTextCommitJSON({ ...NEW_BOX, autoFit: false, minOuterHeight: 40, naturalInnerHeight: 120 });
  assert.equal(tall.height, 120 + 2 * pad);
});

// ------------------------------------------------------------ re-edits

const MARKED = {
  type: 'Textbox', left: 100, top: 200, width: 160, height: 75, angle: 0,
  scaleX: 1, scaleY: 1, text: 'a long line of old text', fontSize: 16,
  data: { id: 'box-1', textAutoFit: true },
};

test('shouldAutoFitExistingText: only a marked plain box, only with the switch on', () => {
  assert.equal(shouldAutoFitExistingText({ original: MARKED, preference: true }), true);
  assert.equal(shouldAutoFitExistingText({ original: MARKED, preference: false }), false);
  assert.equal(shouldAutoFitExistingText({ original: MARKED, isCallout: true, preference: true }), false);
  const resized = { ...MARKED, data: { id: 'box-1', textAutoFit: false } };
  assert.equal(shouldAutoFitExistingText({ original: resized, preference: true }), false);
  const legacy = { ...MARKED, data: { id: 'old' } };
  assert.equal(shouldAutoFitExistingText({ original: legacy, preference: true }), false,
    'boxes made before the switch existed keep their size');
  assert.equal(shouldAutoFitExistingText({ original: null }), false);
});

test('re-edit with auto-fit: height fits the text (may shrink), one line narrows to hug', () => {
  const json = buildExistingTextCommitJSON({
    original: MARKED, text: 'x', naturalInnerHeight: 21, autoFit: true, maxLineWidth: 10, lineCount: 1,
  });
  assert.equal(json.height, 21 + 2 * pad);
  assert.equal(json.width, 12 + 2 * pad);
  assert.equal(json.data.textAutoFit, true, 'the mark survives a re-edit');
});

test('re-edit with auto-fit never widens and keeps width for wrapped text', () => {
  const wide = buildExistingTextCommitJSON({
    original: MARKED, text: 'x', naturalInnerHeight: 21, autoFit: true, maxLineWidth: 900, lineCount: 1,
  });
  assert.equal(wide.width, 160);
  const wrapped = buildExistingTextCommitJSON({
    original: MARKED, text: 'a\nb\nc', naturalInnerHeight: 63, autoFit: true, maxLineWidth: 10, lineCount: 3,
  });
  assert.equal(wrapped.width, 160);
  assert.equal(wrapped.height, 63 + 2 * pad);
});

test('re-edit with auto-fit: a rotated box keeps its width and its anchor math', () => {
  const rotated = { ...MARKED, angle: 90 };
  const json = buildExistingTextCommitJSON({
    original: rotated, text: 'x', naturalInnerHeight: 21, autoFit: true, maxLineWidth: 10, lineCount: 1,
  });
  assert.equal(json.width, 160);
  const dh = json.height - 75;
  assert.ok(dh < 0);
  assert.ok(Math.abs(json.left - (100 - dh / 2)) < 1e-9);
  assert.ok(Math.abs(json.top - (200 - dh / 2)) < 1e-9);
});

test('re-edit without auto-fit is unchanged: grow, never shrink, width locked', () => {
  const json = buildExistingTextCommitJSON({
    original: MARKED, text: 'x', naturalInnerHeight: 21, autoFit: false, maxLineWidth: 10, lineCount: 1,
  });
  assert.equal(json.height, 75);
  assert.equal(json.width, 160);
});

test('callouts never auto-fit even if asked', () => {
  const json = buildExistingTextCommitJSON({
    original: { ...MARKED, height: 80 }, text: 'x', naturalInnerHeight: 20, isCallout: true, autoFit: true, maxLineWidth: 10,
  });
  assert.equal(json.height, 80);
  assert.equal(json.width, 160);
});

// ------------------------------------------------------------ hand resize

test('lockTextboxSizeAfterResize clears the mark; leaves old and non-text marks untouched', () => {
  const marked = { type: 'Textbox', data: { id: 'a', textAutoFit: true } };
  lockTextboxSizeAfterResize(marked);
  assert.deepEqual(marked.data, { id: 'a', textAutoFit: false });

  const legacy = { type: 'textbox', data: { id: 'b' } };
  const legacyData = legacy.data;
  lockTextboxSizeAfterResize(legacy);
  assert.equal(legacy.data, legacyData, 'no new data object for a box without the mark');
  assert.deepEqual(legacy.data, { id: 'b' });

  const rect = { type: 'Rect', data: { id: 'c', textAutoFit: true } };
  lockTextboxSizeAfterResize(rect);
  assert.equal(rect.data.textAutoFit, true);
  assert.doesNotThrow(() => lockTextboxSizeAfterResize(null));
});

test('whole flow with the switch on: create -> re-edit fits -> resize -> re-edit keeps the size', () => {
  const created = buildNewTextCommitJSON({ ...NEW_BOX, text: 'hello world', maxLineWidth: 80, autoFit: true });
  assert.equal(created.width, 82 + 2 * pad);
  // Re-edit to shorter text: still fits (mark present, switch on).
  const fit = shouldAutoFitExistingText({ original: created, preference: true });
  const shorter = buildExistingTextCommitJSON({
    original: created, text: 'hi', naturalInnerHeight: 21, autoFit: fit, maxLineWidth: 14, lineCount: 1,
  });
  assert.equal(shorter.width, 16 + 2 * pad);
  // The user drags the box much bigger by hand (what useSVGInteraction commits).
  const resized = { ...shorter, width: 400, height: 200 };
  lockTextboxSizeAfterResize(resized);
  // Re-edit again: the size the user chose is kept.
  const fit2 = shouldAutoFitExistingText({ original: resized, preference: true });
  assert.equal(fit2, false);
  const after = buildExistingTextCommitJSON({
    original: resized, text: 'hi', naturalInnerHeight: 21, autoFit: fit2, maxLineWidth: 14, lineCount: 1,
  });
  assert.equal(after.width, 400);
  assert.equal(after.height, 200);
});

// ------------------------------------------------------------ wiring

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('wiring: both resize commits clear the mark; the editor reads the switch', () => {
  const interaction = src('src/hooks/useSVGInteraction.js');
  assert.match(interaction, /import \{ lockTextboxSizeAfterResize \} from '\.\.\/utils\/annotationPreferences\.js';/);
  const textBranch = interaction.slice(interaction.indexOf("objType === 'textbox' || objType === 'i-text'"));
  assert.match(textBranch.slice(0, 1600), /lockTextboxSizeAfterResize\(obj\)/, 'single-box resize');
  assert.match(interaction, /ds\.mode === 'group-resize'\) \{\s*for \(const i of merged\.indexes[^\n]*lockTextboxSizeAfterResize/, 'group resize');

  const overlay = src('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /readTextboxAutoFit\(\)/);
  assert.match(overlay, /autoFit: autoFitRef\.current,\s*minOuterHeight: g\.outerH,/);
  assert.match(overlay, /autoFit: autoFitRef\.current,\s*maxLineWidth:/);
});

test('wiring: Settings has an Annotations tab with the switch (desktop and phone share it)', () => {
  const settings = src('src/components/AccountSettings.jsx');
  assert.match(settings, /setActiveTab\('annotations'\)/);
  assert.match(settings, />\s*Annotations\s*</);
  assert.match(settings, /role="switch"\s*aria-checked=\{textboxAutoFit\}/);
  assert.match(settings, /writeTextboxAutoFit\(!textboxAutoFit\)/);
});
