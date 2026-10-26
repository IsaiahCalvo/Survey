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
  'src/components/MeasureScaleDialog.jsx',
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
