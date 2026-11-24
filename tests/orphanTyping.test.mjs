// r5b #21 (2026-11-24): when the field being typed in is taken off the page
// (someone else deleted the mark whose note was open), the rest of the word
// must not fire single-key tool shortcuts, and the panel can tell the person.
import test from 'node:test';
import assert from 'node:assert/strict';

const body = { tagName: 'BODY' };
const documentElement = { tagName: 'HTML' };
globalThis.document = { body, documentElement };

const { isTypingTarget, isOrphanTyping, noteTypingKey, forgetTypingField, typedFieldJustLeft } = await import('../src/utils/typingTarget.js');

const field = () => ({ tagName: 'TEXTAREA', isConnected: true });

test('keys reaching <body> right after the typed-in field vanished still count as typing', () => {
  forgetTypingField();
  const note = field();
  noteTypingKey(note, 1000);
  assert.equal(isTypingTarget(body, 1100), false, 'field still on the page: body is not typing');
  note.isConnected = false;
  assert.equal(isTypingTarget(body, 1400), true);
  assert.equal(isOrphanTyping(body, 1400), true);
  // Each further key keeps the guard up while the person keeps typing.
  noteTypingKey(body, 2300);
  assert.equal(isOrphanTyping(body, 3700), true);
  assert.equal(isOrphanTyping(body, 3900), false, 'a pause ends it');
});

test('a click ends the guard at once', () => {
  forgetTypingField();
  const note = field();
  noteTypingKey(note, 1000);
  note.isConnected = false;
  forgetTypingField();
  assert.equal(isOrphanTyping(body, 1100), false);
  assert.equal(typedFieldJustLeft(10000, 1100), false);
});

test('leaving the field by key (Escape, then Delete) is not someone else deleting it', () => {
  forgetTypingField();
  const note = field();
  noteTypingKey(note, 1000); // Escape inside the note
  noteTypingKey(body, 1200); // Delete on the page, field still there
  note.isConnected = false; // the mark (and its panel) go
  assert.equal(typedFieldJustLeft(10000, 1300), false);
  assert.equal(isOrphanTyping(body, 1300), false);
});

test('typedFieldJustLeft reports a field taken away mid-typing', () => {
  forgetTypingField();
  const note = field();
  noteTypingKey(note, 1000);
  assert.equal(typedFieldJustLeft(10000, 2000), false, 'still on the page');
  note.isConnected = false;
  assert.equal(typedFieldJustLeft(10000, 5000), true);
  assert.equal(typedFieldJustLeft(10000, 12000), false);
});

test('only the page root counts: a real control keeps its own rules', () => {
  forgetTypingField();
  const note = field();
  noteTypingKey(note, 1000);
  note.isConnected = false;
  assert.equal(isOrphanTyping({ tagName: 'BUTTON' }, 1100), false);
});
