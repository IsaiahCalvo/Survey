import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('official leftover files besides isolated 8448 match live source after Templates checklist chrome type', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /role="dialog"/);
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);

  const auth = read('src/components/AuthModal.jsx');
  assert.match(
    auth,
    /<button type="button" className="auth-modal-close" onClick=\{handleClose\} aria-label="Close">/,
  );

  const access = read('src/home/AccessManagementModal.jsx');
  assert.match(access, /aria-labelledby="access-management-modal-title"/);
  assert.match(
    access,
    /<button type="button" onClick=\{onClose\} title="Close" aria-label="Close" style=\{closeButtonStyle/,
  );

  const editor = read('src/home/TemplatesEditor.jsx');
  const moreButtons = [...editor.matchAll(/<button[\s\S]{0,900}title="More"/g)].map((row) => row[0]);
  assert.equal(moreButtons.length, 4);
  for (const tag of moreButtons) {
    assert.match(tag, /type="button"/);
  }
  const deleteStart = editor.indexOf('title="Delete item" aria-label="Delete item"');
  assert.ok(deleteStart > 0, 'desktop Delete item');
  assert.match(editor.slice(Math.max(0, deleteStart - 80), deleteStart + 40), /<button\s+type="button"/);
  const addStart = editor.indexOf("onClick={() => addItem(i)}");
  assert.ok(addStart > 0, 'desktop Add checklist item');
  assert.match(editor.slice(Math.max(0, addStart - 80), addStart + 40), /<button\s+type="button"/);
  const start = editor.indexOf('className="templates-module-edit-modal"');
  const slice = editor.slice(start, start + 1100);
  assert.match(slice, /aria-labelledby="templates-module-edit-title"/);

  const bookmarks = read('src/sidebar/BookmarksPanel.jsx');
  assert.match(bookmarks, /aria-label="Drag to reorder"/);
  assert.match(bookmarks, /aria-label="Add bookmark"/);

  const surveyRail = read('src/SurveySpacesRail.jsx');
  const headerClose = surveyRail.indexOf('aria-label="Close Survey panel"');
  assert.ok(headerClose > 0, 'header Close Survey panel');
  assert.match(surveyRail.slice(Math.max(0, headerClose - 500), headerClose + 40), /<button\s+type="button"/);

  const search = read('src/sidebar/SearchTextPanel.jsx');
  assert.match(search, /aria-label="Search text in PDF"/);
  assert.match(search, /aria-label="Clear search"/);

  const viewer = read('src/PDFViewer.jsx');
  const chip = viewer.indexOf('const glyph = getCategoryGlyphLabel(category.name);');
  assert.ok(chip > 0, 'survey toolbar chips');
  assert.match(viewer.slice(chip, chip + 1800), /<button\s+type="button"/);

  const tree = read('src/home/ProjectsFolderTree.jsx');
  const projectMore = [...tree.matchAll(/<button[\s\S]{0,800}title="More"/g)].map((row) => row[0]);
  for (const tag of projectMore) {
    assert.match(tag, /type="button"/);
  }

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('hunt after Templates checklist chrome type looks past Templates More type and leftover-18', () => {
  const spec = read('debug/scenarios/e2e-after-templates-checklist-item-chrome-button-type-independent-hunt.spec.mjs');
  assert.match(spec, /AFTER_TEMPLATES_CHECKLIST_ITEM_CHROME_BUTTON_TYPE_INDEPENDENT_HUNT/);
  assert.match(spec, /Independent hunt after Templates checklist Add \/ Delete item type=button/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /surveyTransitionE2E=1/);
  assert.match(spec, /addType/);
  assert.match(spec, /addName/);
  assert.match(spec, /addInForm/);
  assert.match(spec, /deleteType/);
  assert.match(spec, /deleteName/);
  assert.match(spec, /implicitSubmit/);
  assert.match(spec, /afterEscapeAdd/);
  assert.match(spec, /mobileAddType/);
  assert.match(spec, /mobileDeleteType/);
  assert.match(spec, /toolbarChipType/);
  assert.match(spec, /toolbarChipImplicitSubmit/);
  assert.match(spec, /authCloseType/);
  assert.match(spec, /signInType/);
  assert.match(spec, /googleType/);
  assert.match(spec, /roleTrigger/);
  assert.match(spec, /fileId/);
  assert.match(spec, /addType\)\.toBe\('button'\)/);
  assert.match(spec, /addName\)\.toBe\('\+ Add checklist item'\)/);
  assert.match(spec, /deleteType\)\.toBe\('button'\)/);
  assert.match(spec, /deleteName\)\.toBe\('Delete item'\)/);
  assert.match(spec, /mobileAddType\)\.toBe\('button'\)/);
  assert.match(spec, /afterEscapeAdd\)\.toBe\(1\)/);
  assert.match(spec, /closeType\)\.toBe\('button'\)/);
  assert.match(spec, /signInType\)\.toBe\('submit'\)/);
  assert.match(spec, /googleType\)\.toBe\('button'\)/);
  assert.match(spec, /roleTrigger\)\.toBe\(0\)/);
  assert.match(spec, /fileId\)\.toBeNull\(\)/);
  assert.match(spec, /notes\)\.toBe\(0\)/);
  assert.match(spec, /spacesExpand\)\.toBe\(0\)/);
  assert.match(spec, /highlighterCaret\)\.toBe\(0\)/);
  assert.match(spec, /counterCaret\)\.toBe\(0\)/);
  assert.match(spec, /versionHistory\)\.toBe\(0\)/);
  assert.match(spec, /viewBox\)\.toBe\('0 0 612 792'\)/);
  assert.match(spec, /restore\)\.toBe\(0\)/);
  assert.match(spec, /deleteForever\)\.toBe\(0\)/);
  assert.match(spec, /moveCopy\)\.toBe\(0\)/);
  assert.match(spec, /activity\)\.toBe\(0\)/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add checklist item'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New template'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create space'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Walls'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
});
