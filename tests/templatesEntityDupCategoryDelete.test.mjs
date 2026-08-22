import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-templates-entity-dup-category-delete.spec.mjs
// Unique leftovers after template-list Duplicate:
// New entity / entity Duplicate / entity Delete / category Delete.
// Distinct from U-03 template create/rename/delete, entity color,
// New category / category Duplicate / module Delete, leftover-18 export.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('addEntity mints unique Entity N and opens the color picker; empty title restores', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('const addEntity = () => {');
  assert.ok(start > 0, 'addEntity');
  const block = editor.slice(start, editor.indexOf('const renameEntity = (eid, role) => {', start));
  assert.match(block, /if \(!tpl\) return;/);
  assert.match(block, /role = `Entity \$\{n\+\+\}`/);
  assert.match(block, /while \(existing\.includes\(role\)\)/);
  assert.match(block, /roster: \[\.\.\.t\.roster, \{ id, role, color \}\]/);
  assert.match(block, /setTimeout\(\(\) => setOpenColor\(id\), 0\)/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /__e2eAddEntity/);

  assert.match(editor, /<Icon name="plus" size=\{11\} \/>New entity/);
  assert.match(editor, /<button type="button" onClick=\{addEntity\}><Icon name="plus" size=\{11\} \/>New entity<\/button>/);

  assert.match(editor, /const ENTITY_BLANK_HINT = "Can't be empty — type a name or remove the row\.";/);
  assert.match(editor, /onBlur=\{\(e\) => commitRequiredRow\(e\.currentTarget, r\.role, ENTITY_BLANK_HINT, \(v\) => renameEntity\(r\.id, v\)\)\}/);
});

test('Duplicate leftover is entity duplicateEntities, not template-list / module / category', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('const duplicateEntities = (ids) => {');
  assert.ok(start > 0, 'duplicateEntities');
  const block = editor.slice(start, editor.indexOf('const reorderEntities = (activeId, overId) => {', start));
  assert.match(block, /if \(!tpl \|\| !ids\.size\) return;/);
  assert.match(block, /role: `\$\{entity\.role\} copy`/);
  assert.match(block, /const id = newId\('e'\)/);
  assert.match(block, /seedClonedEntityStyles\(clonedEntities\)/);
  assert.match(block, /setSelEntities\(new Set\(\)\)/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /Copy to Spaces/);

  assert.match(editor, /onClick=\{\(\) => duplicateEntities\(selEntities\)\}/);
  assert.match(editor, /onClick=\{\(\) => duplicateEntities\(visibleSelectedIds\)\}/);

  const tplDup = editor.indexOf('const duplicateTemplates = (ids) => {');
  const modDup = editor.indexOf('const duplicateModules = (ids) => {');
  const catDup = editor.indexOf('const duplicateCategories = (ids) => {');
  assert.ok(tplDup > 0, 'duplicateTemplates is a distinct leftover already proven');
  assert.ok(modDup > 0, 'duplicateModules is a distinct leftover already proven');
  assert.ok(catDup > 0, 'duplicateCategories is a distinct leftover already proven');
  assert.notEqual(start, tplDup);
  assert.notEqual(start, modDup);
  assert.notEqual(start, catDup);
});

test('deleteEntities and deleteCategories are immediate — no confirm, no last-row guard', () => {
  const editor = read('src/home/TemplatesEditor.jsx');

  const entStart = editor.indexOf('const deleteEntities = (ids) => {');
  assert.ok(entStart > 0, 'deleteEntities');
  const entBlock = editor.slice(entStart, editor.indexOf('const duplicateEntities = (ids) => {', entStart));
  assert.match(entBlock, /if \(!tpl \|\| !ids\.size\) return;/);
  assert.match(entBlock, /roster: t\.roster\.filter\(\(r\) => !ids\.has\(r\.id\)\)/);
  assert.match(entBlock, /setSelEntities\(new Set\(\)\)/);
  assert.doesNotMatch(entBlock, /confirm\(/);
  assert.doesNotMatch(entBlock, /archive-confirm/);
  assert.doesNotMatch(entBlock, /Are you sure/);
  assert.doesNotMatch(entBlock, /last.?entity/);
  assert.doesNotMatch(entBlock, /onExportSpaceCSV/);
  assert.doesNotMatch(entBlock, /file\.id/);
  assert.doesNotMatch(entBlock, /__e2eDeleteEntity/);

  const catStart = editor.indexOf('const deleteCategories = (ids) => {');
  assert.ok(catStart > 0, 'deleteCategories');
  const catBlock = editor.slice(catStart, editor.indexOf('const duplicateCategories = (ids) => {', catStart));
  assert.match(catBlock, /if \(!ids\.size\) return;/);
  assert.match(catBlock, /categories: m\.categories\.filter\(\(c\) => !ids\.has\(c\.id\)\)/);
  assert.match(catBlock, /setSelCats\(new Set\(\)\)/);
  assert.match(catBlock, /setOpenCat\(-1\)/);
  assert.doesNotMatch(catBlock, /confirm\(/);
  assert.doesNotMatch(catBlock, /archive-confirm/);
  assert.doesNotMatch(catBlock, /Are you sure/);
  assert.doesNotMatch(catBlock, /last.?categor/);
  assert.doesNotMatch(catBlock, /onExportSpaceCSV/);
  assert.doesNotMatch(catBlock, /file\.id/);
  assert.doesNotMatch(catBlock, /__e2eDeleteCategory/);

  assert.match(editor, /onClick=\{\(\) => deleteEntities\(selEntities\)\}/);
  assert.match(editor, /onClick=\{\(\) => deleteCategories\(selCats\)\}/);
  assert.match(editor, /onClick=\{\(\) => deleteCategories\(visibleSelectedIds\)\}/);

  const archiveAt = editor.indexOf('data-testid="archive-confirm-modal"');
  assert.ok(archiveAt > 0, 'archive confirm exists only for checklist usage');
  const archive = editor.slice(archiveAt - 400, archiveAt + 200);
  assert.match(archive, /Archive checklist item confirmation modal/);
  assert.doesNotMatch(archive, /deleteEntities/);
  assert.doesNotMatch(archive, /deleteCategories/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /\{ id: 'e1', name: 'GC', color: 'rgba\(216,168,78,0\.5\)' \}/);
  assert.match(preview, /\{ id: 'e2', name: 'Subcontractor', color: 'rgba\(122,183,230,0\.5\)' \}/);
  assert.match(preview, /\{ id: 'e3', name: '100% Complete', color: 'rgba\(166,224,122,0\.5\)' \}/);
  assert.match(preview, /\{ id: 'c1', name: 'Cameras', checklist: \[/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /file\.id/);
});
