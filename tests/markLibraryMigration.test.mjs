// Mark library wiring contracts: the table's row rules go through the shared
// project access helper, nobody signed out can touch it, and the feature is a
// beta flag (Survey Nightly only) that gates the rail tab and the mark menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261027233000_mark_library.sql');

test('mark library rows: RLS on, signed-out locked out, project rules use user_can_access_project', () => {
  assert.match(sql, /alter table public\.mark_library_items enable row level security/);
  assert.match(sql, /revoke all on table public\.mark_library_items from anon/);
  for (const name of ['read', 'add', 'change', 'delete']) {
    assert.match(sql, new RegExp(`create policy "mark library: ${name}"`), name);
  }
  assert.match(sql, /user_can_access_project\(project_id, 'viewer'\)/);
  assert.match(sql, /user_can_access_project\(project_id, 'editor'\)/);
  assert.match(sql, /user_can_access_project\(project_id, 'owner'\)/);
  // No policy reads project_collaborators itself (the helper owns roles and archived projects).
  assert.doesNotMatch(sql, /project_collaborators/);
  // The author can't be changed or spoofed.
  assert.match(sql, /new\.created_by := old\.created_by/);
  assert.match(sql, /new\.created_by := auth\.uid\(\)/);
  assert.match(sql, /grant execute on function public\.mark_library_project_access\(uuid\) to authenticated/);
  assert.match(sql, /\('mark-library', 'off',/);
});

test('mark library is a beta flag and gates the rail tab and the mark menu', () => {
  assert.equal(FEATURE_FLAGS['mark-library']?.stage, 'beta');
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /isFeatureOn\('mark-library'\)/);
  assert.match(viewer, /saveFamilyToLibrary: markLibraryEnabled \? saveFamilyToLibrary : null/);
  const rail = read('src/PDFSidebar.jsx');
  assert.match(rail, /markLibraryEnabled \? \[\{ id: 'library'/);
});
