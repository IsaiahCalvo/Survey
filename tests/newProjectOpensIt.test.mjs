// Survey #1601: after "+ New project" the new Project must be the open one,
// so "From a job file" imports into it, not the project open before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url), 'utf8');

test('New project remembers the projects that were there before the host flow runs', () => {
  const start = src.indexOf('const handleNewProject = useCallback');
  const body = src.slice(start, src.indexOf('onCreateProject();', start));
  assert.match(body, /pendingNewProjectRef\.current = \{ ids: new Set\(localProjects/);
});

test('the first project that was not there before is opened', () => {
  const start = src.indexOf('const pendingNewProjectRef = useRef(null);');
  assert.ok(start > 0);
  const effect = src.slice(start, src.indexOf('const handleNewProject', start));
  assert.match(effect, /!pending\.ids\.has\(p\.id\)/);
  assert.match(effect, /setOpenId\(added\.id\)/);
  assert.match(effect, /10 \* 60 \* 1000/);
});
