import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { moveItemById } from '../src/reorder/flatReorderUtils.js';

// Live proof: debug/scenarios/e2e-templates-reorder-share.spec.mjs
// Unique leftovers after New entity / entity Duplicate / entity Delete /
// category Delete: entity / category / module reorder + Share.
// Distinct from template-list reorder (reorderTemplates) and leftover-18 A-03.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('reorderEntities / reorderCategories / reorderMods use moveItemById or splice and dirty via mutateTpl', () => {
  const editor = read('src/home/TemplatesEditor.jsx');

  assert.match(editor, /if \(changed\) markEdited\(\);/);
  assert.match(editor, /a no-op fn \(same template reference\) must NOT mark dirty/);

  const entStart = editor.indexOf('const reorderEntities = (activeId, overId) => {');
  assert.ok(entStart > 0, 'reorderEntities');
  const entBlock = editor.slice(entStart, editor.indexOf('const entitySwatch = (r) => {', entStart));
  assert.match(entBlock, /if \(!activeId \|\| !overId \|\| activeId === overId \|\| !tpl\) return;/);
  assert.match(entBlock, /moveItemById\(t\.roster \|\| \[\], activeId, overId\)/);
  assert.match(entBlock, /roster: nextRoster/);
  assert.doesNotMatch(entBlock, /onExportSpaceCSV/);
  assert.doesNotMatch(entBlock, /file\.id/);
  assert.doesNotMatch(entBlock, /__e2eReorderEntities/);

  const catStart = editor.indexOf('const reorderCategoriesInModule = (moduleIndex, activeId, overId) => {');
  assert.ok(catStart > 0, 'reorderCategoriesInModule');
  const catBlock = editor.slice(catStart, editor.indexOf('const reorderCategories = (activeId, overId) =>', catStart) + 120);
  assert.match(catBlock, /moveItemById\(module\.categories \|\| \[\], activeId, overId\)/);
  assert.match(catBlock, /const reorderCategories = \(activeId, overId\) => reorderCategoriesInModule\(openMod, activeId, overId\);/);

  const modStart = editor.indexOf('const reorderMods = (from, to) => {');
  assert.ok(modStart > 0, 'reorderMods');
  const modBlock = editor.slice(modStart, editor.indexOf('const deleteModules = (ids) => {', modStart));
  assert.match(modBlock, /if \(from === to \|\| from == null \|\| to == null \|\| !tpl\) return;/);
  assert.match(modBlock, /modules\.splice\(from, 1\)/);
  assert.match(modBlock, /modules\.splice\(to, 0, moved\)/);
  assert.match(modBlock, /if \(openMod === from\) setOpenMod\(to\);/);

  assert.match(editor, /ids=\{tpl\.roster\.map\(\(r\) => r\.id\)\} onReorder=\{reorderEntities\}/);
  assert.match(editor, /onReorder=\{reorderCategories\}/);
  assert.match(editor, /onReorderModules=\{reorderMods\}/);
  assert.match(editor, /reorderMods\(from, to\);/);
  assert.match(editor, /from '\.\.\/reorder\/SortableRearrangeList'/);
  const handle = read('src/reorder/DragRearrangeHandle.jsx');
  assert.match(handle, /title = 'Drag to rearrange'/);
  assert.match(handle, /data-drag-rearrange-handle/);

  const seed = [
    { id: 'e1', role: 'GC' },
    { id: 'e2', role: 'Subcontractor' },
    { id: 'e3', role: '100% Complete' },
  ];
  assert.deepEqual(moveItemById(seed, 'e1', 'e2').map(({ role }) => role), ['Subcontractor', 'GC', '100% Complete']);
  assert.equal(moveItemById(seed, 'e1', 'e1'), seed);
  assert.deepEqual(
    moveItemById([{ id: 'c1', name: 'Cameras' }, { id: 'c2', name: 'Doors' }], 'c1', 'c2').map(({ name }) => name),
    ['Doors', 'Cameras'],
  );
});

test('Share chrome calls onShare(template); hubPreview ShareModal is fail-closed without Supabase', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  assert.match(editor, /onShare,/);
  assert.match(editor, /if \(first\) onShare && onShare\(first\);/);
  assert.match(editor, /if \(c && tpl\) onShare && onShare\(tpl\);/);
  assert.match(editor, /if \(selCount && tpl\) onShare && onShare\(tpl\);/);
  assert.match(editor, /\{ label: 'Share', onClick: \(\) => onShare && onShare\(t\) \}/);
  assert.match(editor, /aria-label="Share"/);
  assert.doesNotMatch(editor, /createTemplateInvite/);
  assert.doesNotMatch(editor, /file\.id/);
  assert.doesNotMatch(editor, /VITE_DEV_AUTO_LOGIN/);

  const hub = read('src/home/SurveyHub.jsx');
  const shareStart = hub.indexOf('const shareTemplate = (template) => {');
  assert.ok(shareStart > 0, 'shareTemplate');
  const shareBlock = hub.slice(shareStart, hub.indexOf('const common =', shareStart));
  assert.match(shareBlock, /kind: 'template'/);
  assert.match(shareBlock, /manage: false/);
  assert.match(hub, /onShare=\{shareTemplate\}/);

  const modal = read('src/home/ShareModal.jsx');
  assert.match(modal, /if \(kind === 'template'\) \{/);
  assert.match(modal, /createTemplateInvite\(\{ templateId: targetId, templateName: name \|\| '', \.\.\.common \}\)/);
  assert.match(modal, /if \(auth\.isSupabaseAvailable === false\) \{/);
  assert.match(modal, /setError\('Sharing needs a signed-in cloud account\.'\);/);
  assert.match(modal, /Enter at least one valid email\./);
  assert.match(modal, /aria-label=\{`Share \$\{noun\}`\}/);
  assert.doesNotMatch(modal, /file\.id/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /isSupabaseAvailable: false,/);
  assert.match(preview, /tier: 'developer',/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /createTemplateInvite/);
});

test('Move/Copy stays a dead stub; template-list reorder is a distinct leftover', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const moveAt = editor.indexOf('{/* Move/Copy modal */}');
  assert.ok(moveAt > 0, 'Move/Copy modal exists');
  const move = editor.slice(moveAt);
  assert.match(move, /onClick=\{closeMoveModal\}/);
  assert.match(move, />Copy<\/button>/);
  assert.match(move, />Move<\/button>/);
  assert.doesNotMatch(move, /mutateTpl/);
  assert.doesNotMatch(move, /onExportSpaceCSV/);
  assert.doesNotMatch(move, /Copy to Spaces/);

  const tplReorder = editor.indexOf('const reorderTemplates = (activeId, overId) => {');
  const entReorder = editor.indexOf('const reorderEntities = (activeId, overId) => {');
  assert.ok(tplReorder > 0, 'reorderTemplates is a distinct leftover');
  assert.notEqual(tplReorder, entReorder);
  const tplBlock = editor.slice(tplReorder, editor.indexOf('const deleteTemplates = async (ids) => {', tplReorder));
  assert.match(tplBlock, /saveTemplateOrderPreference/);
  assert.doesNotMatch(tplBlock, /mutateTpl/);

  assert.doesNotMatch(editor, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(editor, /stampTool/);
  assert.doesNotMatch(editor, /Note-Link/);
});
