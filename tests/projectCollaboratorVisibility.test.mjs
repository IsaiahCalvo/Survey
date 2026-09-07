import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/hooks/useDatabase.js', import.meta.url), 'utf8');
const projectsHook = source.slice(source.indexOf('export const useProjects'), source.indexOf('// DOCUMENTS HOOKS'));

test('projects hook loads owned and active collaborator projects in parallel', () => {
  assert.match(projectsHook, /Promise\.all\(\[/);
  assert.match(projectsHook, /from\('projects'\)[\s\S]*?eq\('user_id', user\.id\)/);
  assert.match(projectsHook, /from\('project_collaborators'\)[\s\S]*?eq\('status', 'active'\)/);
  assert.match(projectsHook, /readLibraryIdChunks\(missingIds/);
  assert.match(projectsHook, /\.in\('id', ids\)/);
});

test('projects hook preserves owner precedence, deduplicates, and globally orders the merged result', () => {
  assert.match(projectsHook, /ownedIds[\s\S]*?filter\(\(id\) => !ownedIds\.has\(id\)\)/);
  assert.match(projectsHook, /\[\.\.\.ownedProjects, \.\.\.collaboratorProjects\]/);
  assert.match(projectsHook, /new Map\([\s\S]*?project\.id/);
  assert.match(projectsHook, /Date\.parse\(b\.created_at\)[\s\S]*?Date\.parse\(a\.created_at\)/);
});
