// Owner 2026-10-07 (survey bar round): the Survey tab / dock button goes
// straight back into the template last used on THIS document; the picker only
// opens the first time or when that template was deleted. Remembered on the
// device (localStorage, per document id), every storage call wrapped.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SURVEY_LAST_TEMPLATE_KEY_PREFIX,
  surveyLastTemplateKey,
  readLastSurveyTemplateId,
  rememberLastSurveyTemplate,
  forgetLastSurveyTemplate,
  resolveLastSurveyTemplate,
  surveyMemoryDocumentKey,
} from '../src/utils/surveyLastTemplate.js';

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

function throwingStorage() {
  const boom = () => { throw new Error('SecurityError: storage blocked'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

const TEMPLATES = [
  { id: 'tpl-a', name: 'Fire Alarm Walkdown' },
  { id: 'tpl-b', name: 'Lighting Survey' },
];

test('the key is per document and empty without a document id', () => {
  assert.equal(surveyLastTemplateKey('doc-1'), `${SURVEY_LAST_TEMPLATE_KEY_PREFIX}doc-1`);
  assert.notEqual(surveyLastTemplateKey('doc-1'), surveyLastTemplateKey('doc-2'));
  assert.equal(surveyLastTemplateKey(null), null);
  assert.equal(surveyLastTemplateKey(undefined), null);
  assert.equal(surveyLastTemplateKey(''), null);
});

test('the document key: the id, else a local file path, else the file name', () => {
  assert.equal(surveyMemoryDocumentKey({ id: 'doc-uuid', name: 'Plan.pdf' }, '/x/Plan.pdf'), 'doc-uuid');
  assert.equal(surveyMemoryDocumentKey({ id: 12 }), '12');
  assert.equal(surveyMemoryDocumentKey({ name: 'Plan.pdf' }, '/x/Plan.pdf'), 'path:/x/Plan.pdf');
  assert.equal(surveyMemoryDocumentKey({ name: 'Plan.pdf' }), 'name:Plan.pdf');
  assert.equal(surveyMemoryDocumentKey(null), null);
  assert.equal(surveyMemoryDocumentKey({}), null);
});

test('first time: nothing remembered, so the picker opens', () => {
  const storage = memoryStorage();
  assert.equal(readLastSurveyTemplateId('doc-1', storage), null);
  assert.equal(resolveLastSurveyTemplate('doc-1', TEMPLATES, storage), null);
});

test('a remembered template comes back for the same document only', () => {
  const storage = memoryStorage();
  assert.equal(rememberLastSurveyTemplate('doc-1', 'tpl-b', storage), true);
  assert.equal(resolveLastSurveyTemplate('doc-1', TEMPLATES, storage), TEMPLATES[1]);
  assert.equal(resolveLastSurveyTemplate('doc-2', TEMPLATES, storage), null, 'another document has its own memory');
  rememberLastSurveyTemplate('doc-2', 'tpl-a', storage);
  assert.equal(resolveLastSurveyTemplate('doc-1', TEMPLATES, storage).id, 'tpl-b');
  assert.equal(resolveLastSurveyTemplate('doc-2', TEMPLATES, storage).id, 'tpl-a');
});

test('the latest pick wins', () => {
  const storage = memoryStorage();
  rememberLastSurveyTemplate('doc-1', 'tpl-a', storage);
  rememberLastSurveyTemplate('doc-1', 'tpl-b', storage);
  assert.equal(resolveLastSurveyTemplate('doc-1', TEMPLATES, storage).id, 'tpl-b');
});

test('numeric ids match their string form', () => {
  const storage = memoryStorage();
  rememberLastSurveyTemplate(42, 7, storage);
  assert.deepEqual(resolveLastSurveyTemplate(42, [{ id: 7, name: 'Seven' }], storage), { id: 7, name: 'Seven' });
});

test('a deleted template is forgotten, so the picker opens and the next pick is remembered', () => {
  const storage = memoryStorage();
  rememberLastSurveyTemplate('doc-1', 'tpl-gone', storage);
  assert.equal(resolveLastSurveyTemplate('doc-1', TEMPLATES, storage), null);
  assert.equal(readLastSurveyTemplateId('doc-1', storage), null, 'the stale id is dropped');
});

test('an empty template list (not loaded yet) keeps the memory', () => {
  const storage = memoryStorage();
  rememberLastSurveyTemplate('doc-1', 'tpl-a', storage);
  assert.equal(resolveLastSurveyTemplate('doc-1', [], storage), null);
  assert.equal(resolveLastSurveyTemplate('doc-1', undefined, storage), null);
  assert.equal(readLastSurveyTemplateId('doc-1', storage), 'tpl-a');
  assert.equal(resolveLastSurveyTemplate('doc-1', TEMPLATES, storage).id, 'tpl-a');
});

test('no document id or no template id: nothing is written', () => {
  const storage = memoryStorage();
  assert.equal(rememberLastSurveyTemplate(null, 'tpl-a', storage), false);
  assert.equal(rememberLastSurveyTemplate('doc-1', null, storage), false);
  assert.equal(rememberLastSurveyTemplate('doc-1', '', storage), false);
  assert.equal(storage.map.size, 0);
});

test('blocked or missing storage never throws - it just remembers nothing', () => {
  const blocked = throwingStorage();
  assert.equal(rememberLastSurveyTemplate('doc-1', 'tpl-a', blocked), false);
  assert.equal(readLastSurveyTemplateId('doc-1', blocked), null);
  assert.doesNotThrow(() => forgetLastSurveyTemplate('doc-1', blocked));
  assert.equal(resolveLastSurveyTemplate('doc-1', TEMPLATES, blocked), null);
  assert.equal(rememberLastSurveyTemplate('doc-1', 'tpl-a', null), false);
  assert.equal(resolveLastSurveyTemplate('doc-1', TEMPLATES, null), null);
});

test('without a window (node), the default storage is simply absent', () => {
  assert.equal(readLastSurveyTemplateId('doc-1'), null);
  assert.equal(rememberLastSurveyTemplate('doc-1', 'tpl-a'), false);
});
