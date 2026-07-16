import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTemplateConfig } from '../templateConfig.js';

test('sanitizeTemplateConfig strips only supabaseId', () => {
  const input = { supabaseId: 'row-123', id: 'tpl-1', name: 'A', linkedExcelPath: '/x.xlsx' };
  assert.deepEqual(sanitizeTemplateConfig(input), { id: 'tpl-1', name: 'A', linkedExcelPath: '/x.xlsx' });
  assert.equal(input.supabaseId, 'row-123');
});

test('sanitizeTemplateConfig passes through non-objects', () => {
  assert.equal(sanitizeTemplateConfig(null), null);
  assert.equal(sanitizeTemplateConfig(undefined), undefined);
  assert.equal(sanitizeTemplateConfig('x'), 'x');
  assert.equal(sanitizeTemplateConfig(42), 42);
});
