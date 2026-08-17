import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  cloneMissingTransferCategories,
  persistTemplateBeforeDocumentMutation,
} from '../src/viewerShared.js';

const PDF_VIEWER = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('missing transfer categories clone checklist content with fresh identities', () => {
  let sequence = 0;
  const template = {
    modules: [
      { id: 'source', categories: [{ id: 'cat-source', name: 'Doors', checklist: [{ id: 'check-source', text: 'Locked?' }] }] },
      { id: 'dest', categories: [] },
    ],
  };
  const result = cloneMissingTransferCategories(template, 'source', 'dest', ['Doors'], () => `new-${++sequence}`);
  const sourceCategory = result.modules[0].categories[0];
  const cloned = result.modules[1].categories[0];
  assert.equal(cloned.name, 'Doors');
  assert.equal(cloned.checklist[0].text, 'Locked?');
  assert.notEqual(cloned.id, sourceCategory.id);
  assert.notEqual(cloned.checklist[0].id, sourceCategory.checklist[0].id);
  assert.deepEqual(result.spaces, result.modules);
  assert.deepEqual(template.modules[1].categories, [], 'source template stays immutable');
});

test('missing-category confirmation persists the cloned template and transfers through module ids', () => {
  const checklistStart = PDF_VIEWER.indexOf('Missing categories detected');
  const checklistEnd = PDF_VIEWER.indexOf('{/* Locate Modal */}', checklistStart);
  const checklistFlow = PDF_VIEWER.slice(checklistStart, checklistEnd);
  assert.match(checklistFlow, /cloneMissingTransferCategories\(/);
  assert.match(checklistFlow, /transferState\.sourceModuleId/);
  assert.match(checklistFlow, /transferState\.destModuleId/);
  assert.match(checklistFlow, /updateSupabaseTemplate\(supabaseTemplateId/);
  assert.doesNotMatch(checklistFlow, /sourceSpaceId|destSpaceId|TODO: Actually create categories/);
});

test('missing-category transfer applies no document state until template persistence succeeds', async () => {
  const calls = [];
  await assert.rejects(persistTemplateBeforeDocumentMutation({
    persistTemplate: async () => { calls.push('persist'); throw new Error('offline'); },
    applyTemplate: () => calls.push('template'),
    applyDocument: () => calls.push('document'),
  }), /offline/);
  assert.deepEqual(calls, ['persist']);

  calls.length = 0;
  await persistTemplateBeforeDocumentMutation({
    persistTemplate: async () => calls.push('persist'),
    applyTemplate: () => calls.push('template'),
    applyDocument: () => calls.push('document'),
  });
  assert.deepEqual(calls, ['persist', 'template', 'document']);
});

test('guest/local missing-category transfer applies locally without a cloud persistence callback', async () => {
  const applied = [];
  await persistTemplateBeforeDocumentMutation({
    persistTemplate: null,
    applyTemplate: () => applied.push('template'),
    applyDocument: () => applied.push('document'),
  });
  assert.deepEqual(applied, ['template', 'document']);
});
