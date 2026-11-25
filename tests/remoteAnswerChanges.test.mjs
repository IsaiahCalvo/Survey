import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteAnswerChanges, remoteAnswerMessage } from '../src/utils/remoteAnswerChanges.js';

const marker = (responses, extra = {}) => ({ name: 'Camera 1', checklistResponses: responses, ...extra });

test('finds answers another screen changed, not notes or untouched items', () => {
  const prev = { cam1: marker({ cable: { selection: 'N', note: '' }, lens: { selection: 'Y' } }) };
  const next = { cam1: marker({ cable: { selection: 'Y', note: 'x' }, lens: { selection: 'Y' } }, { changedBy: 'CT' }) };
  assert.deepEqual(remoteAnswerChanges(prev, next), [{ markerId: 'cam1', itemId: 'cable', from: 'N', to: 'Y', by: 'CT' }]);
  // A note-only change on an item is not an answer change.
  assert.deepEqual(remoteAnswerChanges(prev, { cam1: marker({ cable: { selection: 'N', note: 'new' }, lens: { selection: 'Y' } }) }), []);
  // A marker that just arrived is not a change to an open one.
  assert.deepEqual(remoteAnswerChanges({}, next), []);
});

test('says what changed in plain words', () => {
  const text = (id) => ({ cable: 'Cable run' }[id]);
  assert.equal(remoteAnswerMessage([{ itemId: 'cable', to: 'Y', by: 'CT' }], text), 'Cable run changed on another screen (CT): now Y.');
  assert.equal(remoteAnswerMessage([{ itemId: 'cable', to: null, by: null }], text), 'Cable run was cleared on another screen.');
  assert.equal(remoteAnswerMessage([{ itemId: 'a', to: 'Y' }, { itemId: 'b', to: 'N' }], text), '2 answers changed on another screen.');
});

test('the hook announces remote marker changes and the rail shows them for the open marker', () => {
  const hook = readFileSync(new URL('../src/hooks/useAnnotationDoc.js', import.meta.url), 'utf8');
  assert.match(hook, /announceRemoteAnswers\(surveyMarkersRef\.current, sm\);\s*setSurveyMarkers\(sm\);/);
  const rail = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
  assert.match(rail, /REMOTE_ANSWERS_EVENT/);
});
