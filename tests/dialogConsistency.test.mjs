// Owner 2026-10-26: "modals that pop up need to feel integrated ... They need
// to all follow the same design." DialogCard is the one shell; the dialogs
// moved onto it must stay on it, and none may bring back the old look
// (COLORS.modal cards, `btn btn-*` buttons, a hand-made scrim).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const ON_THE_SHELL = [
  'src/home/BulkModals.jsx',
  'src/components/SurveyTemplateVersionDialog.jsx',
  'src/components/TemplateOverwriteWarningModal.jsx',
  'src/components/ExcelLockedModal.jsx',
  'src/components/DuplicateUploadModal.jsx',
  'src/components/ApplyRedactionsModal.jsx',
];

test('the shell is the ConfirmModal look: scrim, card, header, footer bar', () => {
  const card = read('src/components/DialogCard.jsx');
  assert.match(card, /background: C\.scrim,\s*backdropFilter: 'blur\(8px\)'/);
  assert.match(card, /borderRadius: 'var\(--radius-dialog\)', boxShadow: 'var\(--shadow-dialog\)'/);
  assert.match(card, /borderTop: `1px solid \$\{C\.rule\}`, background: C\.deep/);
  assert.match(card, /useFocusTrap\(cardRef, open, \{ onEscape: busy \? undefined : onClose \}\)/);
  assert.match(card, /className="hub-icon-btn"><Icon name="close"/);
});

test('these dialogs use the shell and the hub buttons, never the old look', () => {
  for (const file of ON_THE_SHELL) {
    const source = read(file);
    assert.match(source, /import DialogCard from '(\.\/|\.\.\/components\/)DialogCard\.jsx';/, file);
    assert.doesNotMatch(source, /COLORS\.modal|className="btn btn-|onMouseEnter=\{\(e\) => \{\s*e\.currentTarget\.style/, file);
  }
  assert.match(read('src/home/BulkModals.jsx'), /export function ConfirmModal[\s\S]*?<DialogCard/);
});

// These keep their own option rows inside, but the card, header and footer
// are the shell's.
const SHELL_WITH_OPTION_ROWS = [
  'src/components/CreateCategoryModal.jsx',
  'src/components/ExcelSyncConfirmModal.jsx',
  'src/components/NewColumnsModal.jsx',
  'src/components/OneDriveFileSaveModal.jsx',
  'src/components/SurveyMarkerTransferDialog.jsx',
];

test('the option-row dialogs sit on the shell with hub buttons', () => {
  for (const file of SHELL_WITH_OPTION_ROWS) {
    const source = read(file);
    assert.match(source, /import DialogCard from '\.\/DialogCard\.jsx';/, file);
    assert.match(source, /<DialogCard[\s\S]*footer=\{\(\s*<>\s*<button type="button" className="hub-btn dialog-touch-pad"/, file);
    assert.doesNotMatch(source, /background: COLORS\.modal\.overlay|useFocusTrap\(/, file);
  }
});
