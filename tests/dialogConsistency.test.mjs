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
  'src/components/dialogPrompts.jsx',
  'src/home/CreateProjectModal.jsx',
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
  'src/components/SurveyCategoryMoveDialog.jsx',
];

test('the option-row dialogs sit on the shell with hub buttons', () => {
  for (const file of SHELL_WITH_OPTION_ROWS) {
    const source = read(file);
    assert.match(source, /import DialogCard from '\.\/DialogCard\.jsx';/, file);
    assert.match(source, /<DialogCard[\s\S]*footer=\{\(\s*<>\s*<button type="button" className="hub-btn dialog-touch-pad"/, file);
    assert.doesNotMatch(source, /background: COLORS\.modal\.overlay|useFocusTrap\(/, file);
  }
});

// The survey's "Copy to a module" picker: its module rows copy on a click, so
// it is the shell with a body and no footer (2026-10-26, the last two survey
// pickers moved over).
test('the space picker sits on the shell', () => {
  const source = read('src/components/SpaceSelectionDialog.jsx');
  assert.match(source, /import DialogCard from '\.\/DialogCard\.jsx';/);
  assert.match(source, /<BodyPortal>\s*<DialogCard/);
  assert.doesNotMatch(source, /COLORS\.modal|useFocusTrap\(|className="btn btn-/);
});

// Design review 2026-10-27: Rename and the themed prompt had their own cards
// (a 44px field and buttons on a mouse, a boxed x, an ALL CAPS label, a small
// gold button). Both sit on the shell with the one dialog field now.
test('Rename and the prompt use the shell and the one dialog field', () => {
  const bulk = read('src/home/BulkModals.jsx');
  const rename = bulk.slice(bulk.indexOf('export function RenameModal'));
  const prompt = read('src/components/dialogPrompts.jsx');
  for (const [name, source] of [['Rename', rename], ['prompt', prompt]]) {
    assert.match(source, /<DialogCard\s+open=\{open\}/, name);
    assert.match(source, /className="dialog-prompt-input"[\s\S]*?style=\{DIALOG_FIELD_STYLE\}/, name);
    assert.doesNotMatch(source, /textTransform: 'uppercase'|minHeight: 44|height: 44|closeButtonStyle|useFocusTrap\(/, name);
  }
  const card = read('src/components/DialogCard.jsx');
  assert.match(card, /export const DIALOG_FIELD_STYLE = Object\.freeze\(\{[\s\S]*?height: 32,[\s\S]*?fontSize: 13,/);
  assert.match(read('src/home/hub.css'), /\.dialog-prompt-input \{\s*font-size: 16px !important;\s*height: 44px !important;/);
});

// Phone walk 2026-10-28: a card given a zIndex is one the viewer opens over
// its own layers. Mounted inside the viewer it sat in the work area's layer,
// under the phone's sheets and dock: "Survey template updated" opened behind
// the Survey sheet, so tapping a changed template looked like it did nothing.
test('a dialog card with a zIndex mounts at the screen root, open and closing', () => {
  const shell = read('src/components/DialogCard.jsx');
  assert.match(shell, /import \{ createPortal \} from 'react-dom';/);
  assert.match(shell, /const atRoot = \(node\) => \(zIndex && [^\n]*createPortal\(node, document\.body\)/);
  assert.match(shell, /if \(!open\) return atRoot\(<MotionPresence open=\{false\} \/>\);/);
  assert.match(shell, /return atRoot\(card\);/);
  assert.match(read('src/components/SurveyTemplateVersionDialog.jsx'), /zIndex=\{\d+\}/);
});
