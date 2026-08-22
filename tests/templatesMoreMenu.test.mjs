import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-templates-more-menu.spec.mjs
// Unique leftover after existing-row rename: Templates More overflow
// (template-row Copy/Rename/Share/Delete + entity Duplicate/Move/Copy/
// Share/Rename/Delete). Distinct from Select chrome and leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('More menus wire Copy/Rename/Share/Delete and entity overflow; Rename focuses', () => {
  const editor = read('src/home/TemplatesEditor.jsx');

  const beginTpl = editor.indexOf('const beginTemplateRename = (tid) => {');
  assert.ok(beginTpl > 0, 'beginTemplateRename');
  const beginTplBlock = editor.slice(beginTpl, editor.indexOf('const beginEntityRename = (eid) => {', beginTpl));
  assert.match(beginTplBlock, /setSelected\(tid\)/);
  assert.match(beginTplBlock, /setTplEdit\(false\)/);
  assert.match(beginTplBlock, /setMobileTemplateOpen\(true\)/);
  assert.match(beginTplBlock, /focusVisibleField\('input\[data-template-title\]'\)/);
  assert.doesNotMatch(beginTplBlock, /onExportSpaceCSV/);
  assert.doesNotMatch(beginTplBlock, /file\.id/);

  const beginEnt = editor.indexOf('const beginEntityRename = (eid) => {');
  assert.ok(beginEnt > 0, 'beginEntityRename');
  const beginEntBlock = editor.slice(beginEnt, editor.indexOf('useModalFocusTrap({', beginEnt));
  assert.match(beginEntBlock, /setOpenColor\(null\)/);
  assert.match(beginEntBlock, /data-entity-id/);
  assert.match(beginEntBlock, /focusVisibleField\(/);
  assert.doesNotMatch(beginEntBlock, /onExportSpaceCSV/);

  const tplMenu = editor.indexOf("items={[\n            { label: 'Copy', onClick: () => duplicateTemplates(new Set([t.id])) },");
  assert.ok(tplMenu > 0, 'template More items');
  const tplItems = editor.slice(tplMenu, editor.indexOf('{entityMenu && tpl && (() => {', tplMenu));
  assert.match(tplItems, /\{ label: 'Copy', onClick: \(\) => duplicateTemplates\(new Set\(\[t\.id\]\)\) \}/);
  assert.match(tplItems, /\{ label: 'Rename', onClick: \(\) => beginTemplateRename\(t\.id\) \}/);
  assert.match(tplItems, /\{ label: 'Share', onClick: \(\) => onShare && onShare\(t\) \}/);
  assert.match(tplItems, /\{ label: 'Delete', danger: true, onClick: \(\) => deleteTemplates\(new Set\(\[t\.id\]\)\) \}/);
  assert.doesNotMatch(tplItems, /Print/);
  assert.doesNotMatch(tplItems, /stampTool/);
  assert.doesNotMatch(tplItems, /Copy to Spaces/);

  const entMenu = editor.indexOf("{ label: 'Duplicate', onClick: () => duplicateEntities(new Set([ent.id])) },");
  assert.ok(entMenu > 0, 'entity More items');
  const entItems = editor.slice(entMenu, editor.indexOf('{/* KAL-44', entMenu));
  assert.match(entItems, /\{ label: 'Duplicate', onClick: \(\) => duplicateEntities\(new Set\(\[ent\.id\]\)\) \}/);
  assert.match(entItems, /\{ label: 'Move\/Copy', onClick: \(\) => setMoveModal\(\{ count: 1, kind: 'entity' \}\) \}/);
  assert.match(entItems, /\{ label: 'Share', onClick: \(\) => \{ if \(tpl\) onShare && onShare\(tpl\); \} \}/);
  assert.match(entItems, /\{ label: 'Rename', onClick: \(\) => beginEntityRename\(ent\.id\) \}/);
  assert.match(entItems, /\{ label: 'Delete', danger: true, onClick: \(\) => deleteEntities\(new Set\(\[ent\.id\]\)\) \}/);
  assert.doesNotMatch(entItems, /setOpenColor\(null\) \}/);
  assert.doesNotMatch(entItems, /Print/);
  assert.doesNotMatch(entItems, /Note-Link/);

  assert.match(editor, /data-template-title=""/);
  assert.match(editor, /data-entity-id=\{r\.id\}/);
  assert.match(editor, /className="templates-mobile-more"/);
  assert.match(editor, /title="More" aria-label="More"/);
  assert.doesNotMatch(editor, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(editor, /__e2eMoreMenu/);
});

test('Move/Copy More item stays a dead stub — Copy/Move only closeMoveModal', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const moveAt = editor.indexOf('{/* Move/Copy modal */}');
  assert.ok(moveAt > 0, 'Move/Copy modal exists');
  const move = editor.slice(moveAt);
  assert.match(move, /onClick=\{closeMoveModal\}/);
  assert.match(move, />Copy<\/button>/);
  assert.match(move, />Move<\/button>/);
  assert.doesNotMatch(move, /mutateTpl/);
  assert.doesNotMatch(move, /duplicateEntities/);
  assert.doesNotMatch(move, /onExportSpaceCSV/);
  assert.doesNotMatch(move, /Copy to Spaces/);
  assert.doesNotMatch(move, /file\.id/);

  assert.match(editor, /function MoreMenu\(\{ anchorRect, items, onClose \}/);
  assert.match(editor, /DismissBarrier insideRefs=\{\[ref\]\} onDismiss=\{onClose\}/);
  assert.match(editor, /role="menuitem"/);
});

test('hubPreview seeds Security / MEP and does not invent leftover-18 share backends', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /id: 't1', name: 'Security Walk-Through'/);
  assert.match(preview, /id: 'e1', name: 'GC'/);
  assert.match(preview, /id: 't2', name: 'MEP As-Built Markup'/);
  assert.match(preview, /onSaveTemplates=\{setTemplates\}/);
  assert.doesNotMatch(preview, /onArchiveTemplates=/);
  assert.doesNotMatch(preview, /onExportSpaceCSV/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /file\.id/);

  const hub = read('src/home/SurveyHub.jsx');
  assert.match(hub, /onShare=\{shareTemplate\}/);
  assert.match(hub, /kind: 'template'/);
});
