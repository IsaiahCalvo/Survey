import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|css)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

// 2026-10-04 (polish round 2): every modal backdrop names the one scrim token
// (--overlay-scrim, KAL-62) instead of re-typing rgba(13, 15, 20, 0.55).
// tokens.css is the only place the value may be written out.
test('modal backdrops use the --overlay-scrim token, not a typed colour', () => {
  const offenders = files
    .filter(({ path }) => !path.endsWith(join('styles', 'tokens.css')))
    .filter(({ text }) => /rgba\(\s*13\s*,\s*15\s*,\s*20\s*,\s*0?\.55\s*\)/.test(text))
    .map(({ path }) => path.slice(SRC.length));
  assert.deepEqual(offenders, []);
});

// 2026-10-04 (polish round 2): one corner for every centred dialog card.
// Dialogs used 8, 10 and 12; the token is 10 (the most common value).
test('the dialog corner token exists and the dialog cards use it', () => {
  const tokens = files.find(({ path }) => path.endsWith(join('styles', 'tokens.css'))).text;
  assert.match(tokens, /--radius-dialog:\s*10px;/);
  const users = [
    'components/AccountSettings.css',
    'components/ApplyRedactionsModal.css',
    'components/AuthModal.css',
    'components/PrintPanel.css',
    'components/collab/CleanupResidueReviewPanel.css',
    'components/collab/ConfirmDeleteModal.css',
    'components/collab/ReSignInModal.css',
    'components/dialogPrompts.jsx',
    'components/SaveLogBanner.jsx',
    'components/SpaceSelectionDialog.jsx',
    'components/revisions/RevisionsPanel.jsx',
    'home/AccessManagementModal.jsx',
    'home/BulkModals.jsx',
    'home/InviteAcceptPage.jsx',
    'components/ResetPasswordPage.jsx',
    'home/CreateProjectModal.jsx',
    'home/ManageTeamModal.jsx',
    'home/ShareModal.jsx',
    'home/TemplatesEditor.jsx',
    'sidebar/BookmarksPanel.jsx',
    'theme.js',
  ];
  for (const rel of users) {
    const file = files.find(({ path }) => path.endsWith(join(...rel.split('/'))));
    assert.ok(file, rel);
    assert.match(file.text, /var\(--radius-dialog\)/, rel);
  }
  for (const rel of ['NewColumnsModal', 'ExcelLockedModal', 'DuplicateUploadModal', 'CreateCategoryModal',
    'TemplateOverwriteWarningModal', 'ExcelSyncConfirmModal', 'OneDriveFileSaveModal', 'KeyboardShortcutsOverlay']) {
    const file = files.find(({ path }) => path.endsWith(`${rel}.jsx`));
    assert.match(file.text, /borderRadius: BORDERS\.radius\.dialog/, rel);
  }
});

// 2026-10-04 (polish round 2): one drop shadow for every dialog card.
test('the dialog shadow token exists and the drifted dialog cards use it', () => {
  const tokens = files.find(({ path }) => path.endsWith(join('styles', 'tokens.css'))).text;
  assert.match(tokens, /--shadow-dialog:\s*0 24px 60px rgba\(0, 0, 0, 0\.55\);/);
  const theme = files.find(({ path }) => path.endsWith('theme.js')).text;
  assert.match(theme, /xl: 'var\(--shadow-dialog\)'/);
  for (const rel of ['AccountSettings.css', 'ReSignInModal.css', 'CleanupResidueReviewPanel.css', 'CreateProjectModal.jsx',
    'SaveLogBanner.jsx', 'BookmarksPanel.jsx', 'RevisionsPanel.jsx', 'AccessManagementModal.jsx']) {
    const file = files.find(({ path }) => path.endsWith(rel));
    assert.match(file.text, /var\(--shadow-dialog\)/, rel);
  }
  const typed = files
    .filter(({ path }) => !path.endsWith(join('styles', 'tokens.css')))
    .filter(({ text }) => /0 24px 6[04]px rgba\(0,\s*0,\s*0,\s*0\.5[58]\)/.test(text))
    .map(({ path }) => path.slice(SRC.length));
  assert.deepEqual(typed, []);
});
