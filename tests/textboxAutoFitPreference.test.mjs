import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TEXTBOX_AUTO_FIT_STORAGE_KEY,
  TEXTBOX_AUTO_FIT_CHANGE_EVENT,
  readTextboxAutoFit,
  writeTextboxAutoFit,
  boxFollowsAutoFit,
  clearAutoFitFlag,
  autoFitEditWidth,
} from '../src/utils/textboxAutoFitPreference.js';
import {
  TEXT_PADDING,
  buildNewTextCommitJSON,
  buildExistingTextCommitJSON,
} from '../src/utils/textEditCommit.js';

// KAL-397 (F19): Settings -> Annotations -> "Fit text boxes to their text".
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
};
const pad = TEXT_PADDING;

test('the setting is On until someone turns it off, and it is remembered', () => {
  const store = memoryStorage();
  assert.equal(readTextboxAutoFit(store), true);
  const sent = [];
  class FakeEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const win = { CustomEvent: FakeEvent, dispatchEvent: (e) => sent.push([e.type, e.detail.on]) };
  assert.equal(writeTextboxAutoFit(false, store, win), false);
  assert.equal(store.getItem(TEXTBOX_AUTO_FIT_STORAGE_KEY), 'off');
  assert.equal(readTextboxAutoFit(store), false);
  writeTextboxAutoFit(true, store, win);
  assert.equal(readTextboxAutoFit(store), true);
  assert.deepEqual(sent, [[TEXTBOX_AUTO_FIT_CHANGE_EVENT, false], [TEXTBOX_AUTO_FIT_CHANGE_EVENT, true]]);
});

test('blocked storage falls back to On and never throws', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readTextboxAutoFit(broken), true);
  assert.equal(readTextboxAutoFit(null), true);
  assert.doesNotThrow(() => writeTextboxAutoFit(false, broken, null));
  assert.equal(readTextboxAutoFit({ getItem: () => 'junk' }), true);
});

const newBox = (over = {}) => buildNewTextCommitJSON({
  text: 'Hi', left: 10, top: 20, innerWrapWidth: 300, maxLineWidth: 20, lineCount: 1,
  naturalInnerHeight: 21, ...over,
});

test('On: a new box fits its text (as before) and is marked to keep fitting', () => {
  const json = newBox({ autoFit: true, drawn: true, drawnOuterHeight: 200 });
  assert.equal(json.width, Math.ceil(20 + 2) + 2 * pad);
  assert.equal(json.height, 21 + 2 * pad);
  assert.equal(boxFollowsAutoFit(json), true);
  assert.equal(json.data.autoFitWidth, 300 + 2 * pad);
});

test('Off: a dragged-out box keeps the width and height you drew', () => {
  const json = newBox({ autoFit: false, drawn: true, drawnOuterHeight: 200 });
  assert.equal(json.width, 300 + 2 * pad);
  assert.equal(json.height, 200);
  assert.equal(boxFollowsAutoFit(json), false);
  // Text taller than the drawn box still fits.
  assert.equal(newBox({ autoFit: false, drawn: true, drawnOuterHeight: 10 }).height, 21 + 2 * pad);
});

test('Off: a clicked box has no drawn size, so it still fits its text', () => {
  const json = newBox({ autoFit: false, drawn: false });
  assert.equal(json.width, Math.ceil(20 + 2) + 2 * pad);
  assert.equal(json.data.autoFit, undefined);
});

const stored = (data = {}) => ({ type: 'Textbox', left: 0, top: 0, width: 200, height: 120, angle: 0, scaleX: 1, scaleY: 1, text: 'old', data: { id: 't1', ...data } });
const edit = (original, over = {}) => buildExistingTextCommitJSON({
  original, text: 'ok', naturalInnerHeight: 21, maxLineWidth: 18, lineCount: 1, ...over,
});

test('On: editing a box that still fits itself shrinks it to the new text', () => {
  const json = edit(stored({ autoFit: true }), { autoFit: true });
  assert.equal(json.width, Math.ceil(18 + 2) + 2 * pad);
  assert.equal(json.height, 21 + 2 * pad);
  assert.equal(json.data.autoFit, true);
});

test('On: wrapped text keeps the width and lets the height follow the text', () => {
  const json = edit(stored({ autoFit: true }), { autoFit: true, lineCount: 3, maxLineWidth: 500, naturalInnerHeight: 60 });
  assert.equal(json.width, 200);
  assert.equal(json.height, 60 + 2 * pad);
});

test('On: a box that hugged one short word widens again for longer text', () => {
  const hugged = { ...stored({ autoFit: true, autoFitWidth: 172 }), width: 30 };
  assert.equal(autoFitEditWidth(hugged), 172);
  const json = edit(hugged, { autoFit: true, wrapOuterWidth: 172, lineCount: 1, maxLineWidth: 120 });
  assert.equal(json.width, Math.ceil(120 + 2) + 2 * pad);
  const wrapped = edit(hugged, { autoFit: true, wrapOuterWidth: 172, lineCount: 2, maxLineWidth: 400, naturalInnerHeight: 40 });
  assert.equal(wrapped.width, 172);
  assert.equal(wrapped.height, 40 + 2 * pad);
});

test('the edit width is only widened for an unrotated box that still fits itself', () => {
  assert.equal(autoFitEditWidth(stored({})), null);
  assert.equal(autoFitEditWidth({ ...stored({ autoFit: true, autoFitWidth: 300 }), angle: 15 }), null);
  assert.equal(autoFitEditWidth(stored({ autoFit: true, autoFitWidth: 100 })), 200);
});

test('a box resized by hand, an older box, a callout or Off never shrinks', () => {
  for (const [label, original, opts] of [
    ['resized by hand', stored({}), { autoFit: true }],
    ['made before the setting', { ...stored(), data: { id: 'old' } }, { autoFit: true }],
    ['callout', stored({ autoFit: true }), { autoFit: true, isCallout: true }],
    ['setting off', stored({ autoFit: true }), { autoFit: false }],
  ]) {
    const json = edit(original, opts);
    assert.equal(json.width, 200, label);
    assert.equal(json.height, 120, label);
  }
});

test('a rotated box only re-fits its height (its width stays put)', () => {
  const json = edit({ ...stored({ autoFit: true }), angle: 30 }, { autoFit: true });
  assert.equal(json.width, 200);
  assert.equal(json.height, 21 + 2 * pad);
});

test('a hand resize clears the flag and leaves everything else alone', () => {
  const box = stored({ autoFit: true, autoFitWidth: 172, pdfCloudIntensity: 2 });
  clearAutoFitFlag(box);
  assert.deepEqual(box.data, { id: 't1', pdfCloudIntensity: 2 });
  assert.doesNotThrow(() => clearAutoFitFlag(null));
  assert.doesNotThrow(() => clearAutoFitFlag({ type: 'Rect' }));
});

test('single and group resize commits both clear the flag', () => {
  const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(hook, /clearAutoFitFlag\(obj\);/);
  assert.match(hook, /if \(ds\.mode === 'group-resize'\) \{\s*for \(const index of merged\.indexes \|\| \[\]\) clearAutoFitFlag/);
});

test('Settings has an Annotations tab with the switch', () => {
  const settings = readFileSync(new URL('../src/components/AccountSettings.jsx', import.meta.url), 'utf8');
  assert.match(settings, /setActiveTab\('annotations'\)/);
  assert.match(settings, /activeTab === 'annotations' && <AnnotationPreferencesPanel \/>/);
  const panel = readFileSync(new URL('../src/components/AnnotationPreferencesPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /role="switch"/);
  assert.match(panel, /Fit text boxes to their text/);
});
