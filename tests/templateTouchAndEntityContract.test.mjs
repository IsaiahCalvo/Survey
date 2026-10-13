import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('agent-cli/mobile-workflows/survey-template.mjs', 'utf8');
const editor = readFileSync('src/home/TemplatesEditor.jsx', 'utf8');
const picker = readFileSync('src/components/CompactColorPicker.jsx', 'utf8');
const reorder = readFileSync('src/reorder/SortableRearrangeList.jsx', 'utf8');

test('mobile template workflow drives trusted handles and reload-verifies every nested reorder', () => {
  assert.match(workflow, /querySelector\?\.\('\[data-drag-rearrange-handle\]'\)/);
  assert.match(workflow, /coverTouchReorderPersistence\(\{ page, touch, baseUrl, artifacts \}\)/);
  for (const phrase of [
    'template touch reorder',
    'module touch reorder',
    'category touch reorder',
    'checklist item touch reorder',
    'entity touch reorder',
    'Touch reorder changed after reload',
  ]) assert.match(workflow, new RegExp(phrase, 'i'));
});

test('responsive reorder measurement selects rendered duplicate-id node', () => {
  assert.match(reorder, /const matches = Array\.from\(document\.querySelectorAll\('\[data-sortable-rearrange-item\]'\)\)/);
  assert.match(reorder, /rect\.width > 0 && rect\.height > 0/);
  assert.match(reorder, /\|\| matches\[0\]/);
});

// RULED 2026-09-23 (owner): the open entity's own row also counts as inside
// the picker, so tapping its name/grip/More does not collapse it.
test('entity color panel protects its tabs and persists duplicate styling fallbacks', () => {
  assert.match(picker, /dismissInsideSelector/);
  assert.match(picker, /insideSelector=\{dismissInsideSelector\}/);
  assert.ok((editor.match(/data-entity-color-panel/g) || []).length >= 4);
  assert.match(editor, /dismissInsideSelector="\[data-entity-color-panel\](?:, \[data-sortable-rearrange-item\]:has\(\[data-entity-color-panel\]\))?"/);
  assert.match(editor, /e\.opacity \?\? 0\.35/);
  assert.match(editor, /: !!e\.matchFill/);
  assert.match(editor, /color: e\.borderColor \|\| fillColor/);
});

test('unsaved entity styles are cloned before entity and whole-template duplication', () => {
  assert.match(editor, /const liveEntityStyle = \(entity\) =>/);
  assert.match(editor, /const seedClonedEntityStyles = \(clones\) =>/);
  assert.match(editor, /const style = liveEntityStyle\(r\);[\s\S]*clonedEntities\.push\(\{ id, style \}\);[\s\S]*return \{ \.\.\.r, \.\.\.style, id \};/);
  assert.match(editor, /const clonesBySource = new Map\(\);[\s\S]*const clone = \{ \.\.\.entity, \.\.\.style, id, role: `\$\{entity\.role\} copy` \};/);
  assert.ok((editor.match(/seedClonedEntityStyles\(clonedEntities\)/g) || []).length >= 2);

  for (const phrase of [
    'Duplicate Inspector before save',
    'Copy template before save',
    'inspectorCopy?.opacity === inspector?.opacity',
    'copiedOwner?.color === owner?.color',
    'Unsaved entity duplicate styling changed after hard reload',
    'Unsaved template copy ${name} style changed after hard reload',
  ]) assert.ok(workflow.includes(phrase), `missing workflow assertion: ${phrase}`);
});
