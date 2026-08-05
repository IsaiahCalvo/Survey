// KAL-432 — archiving a template from the Survey Hub must never make one
// disappear without reaching Archive.
//
// The bug: hubArchiveTemplates mapped each editor id to its `templates` ROW id
// and then filtered the unresolved ones out of the batch. archiveItems([]) has
// nothing to fail on, so the call reported success, TemplatesEditor dropped the
// row from its list, and the stored template stayed live and un-archived. The
// next bundle save then saw that template missing from the saved list and
// issued a PERMANENT delete. From the outside: "it got deleted weird and didn't
// even show up in Archive".
//
// Part A drives the real fan-out module (src/services/archiveBulk.js is
// dependency-free precisely so Node can import it) to pin the per-item
// succeeded/failed reporting the id mapping relies on. Part B is source
// tripwires over Dashboard.jsx and TemplatesEditor.jsx, which only resolve
// under vite — same split as templatesEditorReloadGuard.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { runArchiveBulk } from '../src/services/archiveBulk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(path.join(__dirname, '../src/Dashboard.jsx'), 'utf8');
const editorSrc = readFileSync(path.join(__dirname, '../src/home/TemplatesEditor.jsx'), 'utf8');

const hubArchiveTemplatesSrc = (() => {
  const start = dashboardSrc.indexOf('const hubArchiveTemplates = async');
  assert.notEqual(start, -1, 'hubArchiveTemplates must still exist in Dashboard.jsx');
  const end = dashboardSrc.indexOf('const hubSaveTemplates', start);
  assert.ok(end > start, 'hubArchiveTemplates must still be followed by hubSaveTemplates');
  return dashboardSrc.slice(start, end);
})();

const deleteTemplatesSrc = (() => {
  const start = editorSrc.indexOf('const deleteTemplates = async');
  assert.notEqual(start, -1, 'deleteTemplates must still exist in TemplatesEditor.jsx');
  const end = editorSrc.indexOf('/* --- module-level --- */', start);
  assert.ok(end > start, 'deleteTemplates must still precede the module-level section');
  return editorSrc.slice(start, end);
})();

/* ---------------- Part A — real fan-out behavior ---------------- */

test('runArchiveBulk reports succeeded items by identity, so row ids map back to editor ids', async () => {
  const items = [
    { type: 'template', id: 'row-a', name: 'Paging copy' },
    { type: 'template', id: 'row-b', name: 'Security copy' },
  ];
  const { succeeded, failed } = await runArchiveBulk(
    items,
    { template: async (id) => (id === 'row-a' ? { success: true } : { success: false, error: 'nope' }) },
    'archived'
  );
  assert.deepEqual(succeeded.map((i) => i.id), ['row-a']);
  assert.deepEqual(failed.map((f) => f.item.id), ['row-b']);
  // The name carried in the item is what a partial failure is reported with —
  // a generic label here would make the toast useless.
  assert.equal(failed[0].item.name, 'Security copy');
});

test('runArchiveBulk on an empty selection reports nothing, succeeded AND failed', async () => {
  // This is the exact shape that made the old silent-drop possible: filtering
  // every unresolved id out left an empty batch that could not fail.
  const { succeeded, failed } = await runArchiveBulk([], { template: async () => ({ success: true }) }, 'archived');
  assert.deepEqual(succeeded, []);
  assert.deepEqual(failed, []);
});

/* ---------------- Part B — source tripwires ---------------- */

test('KAL-432 hubArchiveTemplates surfaces templates it cannot resolve instead of dropping them', () => {
  assert.match(
    hubArchiveTemplatesSrc,
    /const unresolved = rows\.filter\(\(row\) => !row\.supabaseId\)/,
    'unresolved ids must be collected, not filtered away'
  );
  assert.match(
    hubArchiveTemplatesSrc,
    /if \(unresolved\.length\) \{[\s\S]*showToast\(/,
    'unresolved ids must raise a visible error'
  );
});

test('KAL-432 hubArchiveTemplates returns the ids that actually reached Archive, never a bare true', () => {
  assert.match(
    hubArchiveTemplatesSrc,
    /const archivedRowIds = new Set\(succeeded\.map\(/,
    'the archived set must come from archiveItems’ succeeded list'
  );
  assert.match(hubArchiveTemplatesSrc, /return succeededIds;/);
  assert.doesNotMatch(
    hubArchiveTemplatesSrc,
    /\n\s*return true;/,
    'returning true would tell the editor every id archived, including ones that did not'
  );
});

test('KAL-432 Archive shows the template’s real name, not a generic label', () => {
  assert.doesNotMatch(
    hubArchiveTemplatesSrc,
    /name: 'Template'/,
    'the literal placeholder name must not come back'
  );
  assert.match(hubArchiveTemplatesSrc, /name: row\.name/);
});

test('KAL-432 archiving prunes the persisted-rows baseline so a later save cannot hard-delete the archived row', () => {
  assert.match(
    hubArchiveTemplatesSrc,
    /supabaseRowsRef\.current = \(supabaseRowsRef\.current \|\| \[\]\)\.filter\([\s\S]*archivedRowIds\.has/,
    'the archived rows must leave the baseline persistTemplates diffs against'
  );
});

test('KAL-432 the editor sends names alongside ids so an unsaved template can be named', () => {
  assert.match(
    deleteTemplatesSrc,
    /const selection = Array\.from\(ids\)\.map\(\(id\) => \(\{[\s\S]*name: rich\.find/,
    'the editor must pass { id, name } entries to onArchiveTemplates'
  );
  assert.match(
    hubArchiveTemplatesSrc,
    /typeof entry === 'string' \? \{ id: entry, name: null \} : entry/,
    'the hub must still accept bare ids'
  );
});

test('KAL-432 TemplatesEditor drops only the templates the hub confirmed archived', () => {
  assert.match(deleteTemplatesSrc, /if \(archived === false\) return;/);
  assert.match(
    deleteTemplatesSrc,
    /const done = Array\.isArray\(archived\) \? new Set\(archived\) : ids;/,
    'the editor must intersect its selection with what actually archived'
  );
  assert.match(deleteTemplatesSrc, /if \(done\.size === 0\) return;/);
  assert.match(deleteTemplatesSrc, /prev\.filter\(\(t\) => !done\.has\(t\.id\)\)/);
});

test('KAL-432 archiving still bypasses the bundle save (that path deletes permanently)', () => {
  // The signed-out fallback keeps the old save-inferred delete; the archive
  // branch must return before ever reaching it.
  const archiveBranch = deleteTemplatesSrc.slice(0, deleteTemplatesSrc.indexOf('Signed-out'));
  assert.doesNotMatch(archiveBranch, /dispatchTemplatesSave/);
});
