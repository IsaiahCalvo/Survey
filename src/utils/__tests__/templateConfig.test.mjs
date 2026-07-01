import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTemplateConfig } from '../templateConfig.js';

test('sanitizeTemplateConfig: strips supabaseId, keeps everything else', () => {
  const out = sanitizeTemplateConfig({ supabaseId: 'row-123', id: 'tpl-1', name: 'A', linkedExcelPath: '/x.xlsx' });
  assert.deepEqual(out, { id: 'tpl-1', name: 'A', linkedExcelPath: '/x.xlsx' });
  assert.equal('supabaseId' in out, false);
});

test('sanitizeTemplateConfig: object without supabaseId is returned intact (minus nothing)', () => {
  const input = { id: 'tpl-2', name: 'B' };
  assert.deepEqual(sanitizeTemplateConfig(input), { id: 'tpl-2', name: 'B' });
});

test('sanitizeTemplateConfig: nullish / non-object inputs pass through unchanged', () => {
  assert.equal(sanitizeTemplateConfig(null), null);
  assert.equal(sanitizeTemplateConfig(undefined), undefined);
  assert.equal(sanitizeTemplateConfig('not-an-object'), 'not-an-object');
  assert.equal(sanitizeTemplateConfig(42), 42);
});

test('sanitizeTemplateConfig: returns a new object (does not mutate input)', () => {
  const input = { supabaseId: 'row-9', id: 'tpl-3' };
  const out = sanitizeTemplateConfig(input);
  assert.equal('supabaseId' in input, true, 'original still has supabaseId');
  assert.notEqual(out, input, 'returns a fresh object');
});
