// Nightly 'typing-undo': Undo while typing steps back a word at a time
// (Drawboard parity, t2-tools-deep.md gap 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTypingHistory, typingUndoKey } from '../src/utils/typingUndo.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Type `text` one key at a time, `gap` ms apart, after what is already there.
function type(history, start, text, t0 = 0, gap = 50) {
  let now = t0;
  let value = start;
  for (const ch of text) {
    value += ch;
    now += gap;
    history.record(value, value.length, ch === '\n' ? 'insertParagraph' : 'insertText', now);
  }
  return { value, now };
}

test('each Undo takes back one word, and Redo brings it back', () => {
  const h = createTypingHistory('');
  type(h, '', 'hello big world');
  assert.deepEqual(h.undo(), { text: 'hello big ', caret: 10 });
  assert.deepEqual(h.undo(), { text: 'hello ', caret: 6 });
  assert.deepEqual(h.undo(), { text: '', caret: 0 });
  assert.equal(h.undo(), null, 'nothing before the text the box opened with');
  assert.deepEqual(h.redo(), { text: 'hello ', caret: 6 });
  assert.deepEqual(h.redo(), { text: 'hello big ', caret: 10 });
});

test('a pause, a switch to deleting, or a paste each close a step', () => {
  const h = createTypingHistory('ab');
  let { value, now } = type(h, 'ab', 'cd', 0);
  ({ value, now } = type(h, value, 'ef', now + 1500)); // paused
  h.record('abcde', 5, 'deleteContentBackward', now + 50);
  h.record('abcd', 4, 'deleteContentBackward', now + 100);
  h.record('abcdXYZ', 7, 'insertFromPaste', now + 150);
  assert.equal(h.undo().text, 'abcd');
  assert.equal(h.undo().text, 'abcdef');
  assert.equal(h.undo().text, 'abcd');
  assert.equal(h.undo().text, 'ab');
  assert.equal(h.undo(), null);
});

test('typing after an Undo drops the steps that were undone', () => {
  const h = createTypingHistory('');
  const { value, now } = type(h, '', 'one two');
  h.undo();
  type(h, 'one ', 'six', now + 2000);
  assert.equal(h.redo(), null);
  assert.equal(h.undo().text, 'one ');
  assert.equal(value, 'one two');
});

test('the keys: Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z and Ctrl+Y redo', () => {
  assert.equal(typingUndoKey({ key: 'z', ctrlKey: true }), 'undo');
  assert.equal(typingUndoKey({ key: 'Z', metaKey: true, shiftKey: true }), 'redo');
  assert.equal(typingUndoKey({ key: 'y', ctrlKey: true }), 'redo');
  assert.equal(typingUndoKey({ key: 'z' }), null);
  assert.equal(typingUndoKey({ key: 'z', ctrlKey: true, altKey: true }), null);
});

test('wired: a beta flag, a migration, and the text editor keeps its own steps', () => {
  assert.equal(FEATURE_FLAGS['typing-undo']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261110151000_typing_undo_flag.sql'), /'typing-undo', 'off'/);
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /typingHistoryRef\.current = isFeatureOn\('typing-undo'\) \? createTypingHistory\(el\.textContent\) : null;/);
  assert.match(overlay, /el\.addEventListener\('beforeinput', onHistoryInput\);/);
});
