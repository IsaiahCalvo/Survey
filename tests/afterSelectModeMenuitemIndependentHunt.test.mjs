import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('official leftover files besides isolated 8448 match live source after Selection Mode menuitem', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /role="dialog"/);
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);

  const access = read('src/home/AccessManagementModal.jsx');
  assert.match(access, /aria-labelledby="access-management-modal-title"/);

  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('className="templates-module-edit-modal"');
  const slice = editor.slice(start, start + 1100);
  assert.match(slice, /aria-labelledby="templates-module-edit-title"/);

  const team = read('src/home/ManageTeamModal.jsx');
  const memberStart = team.indexOf('{!editMode && openMenu === m.id && (');
  const memberEnd = team.indexOf('{/* Pending invites');
  assert.match(team.slice(memberStart, memberEnd), /role="menu"/);
  assert.match(team.slice(memberStart, memberEnd), /role="menuitem"/);

  const app = read('src/AppShell.jsx');
  const selectStart = app.indexOf('data-select-mode-menu="true"');
  const selectEnd = app.indexOf('{/* Draw category */}');
  assert.match(app.slice(selectStart, selectEnd), /role="menu"/);
  assert.match(app.slice(selectStart, selectEnd), /role="menuitem"/);

  const settings = read('src/components/AccountSettings.jsx');
  assert.match(settings, /aria-labelledby="account-settings-title"/);

  const confirm = read('src/home/BulkModals.jsx');
  const confirmStart = confirm.indexOf('export function ConfirmModal');
  const confirmEnd = confirm.indexOf('export function RenameModal');
  assert.match(confirm.slice(confirmStart, confirmEnd), /aria-labelledby="confirm-modal-title"/);

  const create = read('src/components/CreateCategoryModal.jsx');
  assert.match(create, /aria-labelledby="create-category-modal-title"/);

  const official = [
    'tests/keyboardShortcutMatrix.test.mjs',
    'tests/mobileChromeHitTargets.test.mjs',
    'tests/shortcutsOverlay.test.mjs',
    'tests/keyboardShortcutsOverlayDialogName.test.mjs',
    'tests/accessManagementDialogName.test.mjs',
    'tests/templatesModuleEditDialogName.test.mjs',
    'tests/manageTeamMenuitem.test.mjs',
  ];
  for (const rel of official) {
    const src = read(rel);
    assert.match(src, /role="dialog"|KeyboardShortcutsOverlay|AccessManagementModal|templates-module-edit-title|role="menuitem"/);
  }

  assert.match(read('src/PDFSidebar.jsx'), /openPanel\(tab\.id\)/);
  assert.match(read('src/AppShell.jsx'), /document\.addEventListener\('pointerdown', onDown, true\)/);
  assert.doesNotMatch(read('src/DevTestRoute.jsx'), /cloudSync: true/);
  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('hunt after Selection Mode menuitem looks past Manage Team name and leftover-18', () => {
  const spec = read('debug/scenarios/e2e-after-select-mode-menuitem-independent-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /AFTER_SELECT_MODE_MENUITEM_INDEPENDENT_HUNT/);
  assert.match(spec, /Select text/);
  assert.match(spec, /templates-module-edit-title/);
  assert.match(spec, /Lock this document/);
  assert.match(spec, /data-eraser-caret-popup/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
});
