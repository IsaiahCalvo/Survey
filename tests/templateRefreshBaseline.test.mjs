import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hook = readFileSync('src/hooks/useDatabase.js', 'utf8');
const dashboard = readFileSync('src/Dashboard.jsx', 'utf8');

test('template refetch rejects instead of representing a failed read as an empty database', () => {
  const start = hook.indexOf('const loadTemplates =');
  const end = hook.indexOf('const createTemplate =', start);
  const body = hook.slice(start, end);
  assert.match(body, /setError\(err\.message\);\s*throw err;/);
  assert.doesNotMatch(body, /setError\(err\.message\);\s*return \[\];/);
});

test('boot document/template loads consume rejection after preserving hook error state', () => {
  assert.match(hook, /void loadDocuments\(\{ coalesce: true, initialScopeKey: documentScopeKey \}\)\.catch\(\(\) => undefined\);/);
  assert.match(hook, /void loadTemplates\(\{ coalesce: templateReadScope\.initialMount, initialScopeKey: templateScopeKey \}\)\.catch\(\(\) => undefined\);/);
  assert.match(hook, /initialMount: templateReadScopeRef\.current === null/);
  assert.match(hook, /refetch: \(\) => loadDocuments\(\{ coalesce: false \}\)/);
  assert.match(hook, /refetch: \(\) => loadTemplates\(\{ coalesce: false \}\)/);
});

test('template persistence advances its baseline only from a successful atomic snapshot result', () => {
  const start = dashboard.indexOf('const persistTemplates =');
  const end = dashboard.indexOf('const deleteDocumentEverywhere =', start);
  const body = dashboard.slice(start, end);
  assert.match(body, /const freshRows = await persistTemplateSnapshot\(\{/);
  assert.match(body, /persist: replaceSupabaseTemplates/);
  assert.match(body, /supabaseRowsRef\.current = freshRows;/);
  assert.match(body, /return freshRows;/);
});
