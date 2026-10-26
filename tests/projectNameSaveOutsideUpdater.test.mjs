// Saving a project name calls the parent's onRenameProject (a setState in the
// hub). Doing that inside a setNameDraft updater runs it during render and
// React warns "Cannot update a component while rendering a different
// component". The rename must happen outside any state updater.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url), 'utf8');

test('saveProjectName renames outside a state updater', () => {
  const start = SOURCE.indexOf('const saveProjectName = useCallback(');
  assert.ok(start >= 0);
  const fn = SOURCE.slice(start, SOURCE.indexOf('}, [', start));
  assert.doesNotMatch(fn, /setNameDraft\(\(\w*\)\s*=>/, 'no updater function');
  assert.match(fn, /renameProject\(/);
});

test('hub preview user owns the fixture projects (owner-only actions stay live)', () => {
  const preview = readFileSync(new URL('../src/home/HubPreview.jsx', import.meta.url), 'utf8');
  assert.match(preview, /user=\{\{ id: 'u1',/);
  assert.match(preview, /\{ id: 'p1', name: '[^']+', user_id: 'u1'/);
});
