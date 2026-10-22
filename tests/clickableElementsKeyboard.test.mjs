import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanSource, scanTree } from './helpers/clickableElementScan.mjs';

// KAL-66: a control you can click must also work from the keyboard. These are
// the only mouse-only clickable <div>/<span>s left in src/, and every one is
// NOT a control:
//   - a dialog's scrim / backdrop (Escape and the dialog's own Close button
//     do the same thing from the keyboard),
//   - a click-through container (a toolbar that closes its dropdown after a
//     pick, the viewer's page overlay, a search box that focuses its input),
//   - a listbox row whose list owns the keyboard (Search results, Revisions),
//   - a drag grip that takes dnd-kit's own keyboard attributes,
//   - a toast (it dismisses itself), a redaction mark drawn on the page,
//   - the Space card head, whose chevron <button> already opens and folds it,
//   - dead split-menu carets in PDFViewer (showCaret / the text-markup menu
//     are switched off; the parent <button> owns the keyboard),
//   - the mark context menu's rows (role="menuitem", tabIndex -1): the menu's
//     own window keydown handler owns arrows / Enter / Escape,
//   - the throwaway FeatureSpike prototype.
// A new mouse-only control raises a count here and fails this test: give it
// keyboardControlProps (src/utils/keyboardActivation.js), clickableProps /
// checkboxProps (src/utils/keyActivate.js), or make it a button.
const ALLOWED = {
  'src/AppShell.jsx': 1,
  'src/PDFViewer.jsx': 7,
  'src/PageAnnotationLayer.jsx': 1,
  'src/SurveySpacesRail.jsx': 1,
  'src/components/AccountSettings.jsx': 1,
  'src/components/AuthModal.jsx': 1,
  'src/components/CreateCategoryModal.jsx': 1,
  'src/components/DuplicateUploadModal.jsx': 1,
  'src/components/ExcelLockedModal.jsx': 1,
  'src/components/ExcelSyncConfirmModal.jsx': 1,
  'src/components/KeyboardShortcutsOverlay.jsx': 1,
  'src/components/NewColumnsModal.jsx': 1,
  'src/components/OneDriveFileSaveModal.jsx': 1,
  'src/components/PdfToolsDialog.jsx': 1,
  'src/components/PdfjsRedactionMarkLayer.jsx': 1,
  'src/components/PrintPanel.jsx': 2,
  'src/components/SaveLogBanner.jsx': 1,
  'src/components/SpaceSelectionDialog.jsx': 1,
  'src/components/SurveyCategoryMoveDialog.jsx': 1,
  'src/components/SurveyMediaCapture.jsx': 1,
  'src/components/SurveyMediaStrip.jsx': 1,
  'src/components/SurveyTemplateVersionDialog.jsx': 1,
  'src/components/TemplateOverwriteWarningModal.jsx': 1,
  'src/components/ToastHost.jsx': 1,
  'src/components/collab/ConfirmDeleteModal.jsx': 1,
  'src/components/dialogPrompts.jsx': 1,
  'src/components/revisions/RevisionsPanel.jsx': 3,
  'src/home/AccessManagementModal.jsx': 1,
  'src/home/BulkModals.jsx': 3,
  'src/home/CreateProjectModal.jsx': 1,
  'src/home/DocumentsLedger.jsx': 1,
  'src/home/HubShell.jsx': 2,
  'src/home/ManageTeamModal.jsx': 3,
  'src/home/ShareModal.jsx': 1,
  'src/home/TemplatesEditor.jsx': 4,
  'src/hooks/useAnnotationContextMenu.jsx': 3,
  'src/prototype/FeatureSpike.jsx': 1,
  'src/reorder/DragRearrangeHandle.jsx': 1,
  'src/sidebar/BookmarksPanel.jsx': 2,
  'src/sidebar/SearchTextPanel.jsx': 1,
  'src/sidebar/SpacesPanel.jsx': 1,
};

const root = fileURLToPath(new URL('..', import.meta.url));

test('no new mouse-only clickable element in src/', () => {
  const found = scanTree(root);
  const over = [];
  for (const [file, hits] of Object.entries(found)) {
    const allowed = ALLOWED[file] || 0;
    if (hits.length > allowed) {
      over.push(`${file}: ${hits.length} mouse-only (allowed ${allowed}) at lines ${hits.map((h) => h.line).join(', ')}`);
    }
  }
  assert.deepEqual(over, [], over.join('\n'));
});

test('the scan sees a mouse-only div and accepts the keyboard-ready ones', () => {
  assert.equal(scanSource('<div onClick={() => go()} style={{}}>x</div>').length, 1);
  assert.equal(scanSource("<div\n  // it's a comment with an apostrophe\n  onClick={go}\n>x</div>").length, 1);
  assert.equal(scanSource('<div onClick={go} {...keyboardControlProps()}>x</div>').length, 0);
  assert.equal(scanSource('<div onClick={go} tabIndex={0} onKeyDown={k}>x</div>').length, 0);
  assert.equal(scanSource('<span {...clickableProps(go)}>x</span>').length, 0);
  assert.equal(scanSource('<span {...checkboxProps(on, go, l)} onClick={go}>x</span>').length, 0);
  assert.equal(scanSource('<div onClick={(e) => e.stopPropagation()}>x</div>').length, 0);
  assert.equal(scanSource('<button onClick={go}>x</button>').length, 0);
});

// The controls this ticket fixed, by kind. Each must carry the shared props.
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const count = (src, re) => (src.match(re) || []).length;

test('sort headers, rows, select boxes, option cards and menu items are keyboard-ready', () => {
  // Main's src/utils/keyActivate.js helpers (clickableProps / checkboxProps)
  // count the same as keyboardControlProps.
  const ready = /(keyboardControlProps|clickableProps)\(/g;
  const box = /checkboxProps\(|role: 'checkbox'/g;
  assert.equal(count(read('src/home/DocumentsLedger.jsx'), /onHeaderClick\('\w+'\)\)/g), 4);
  assert.equal(count(read('src/home/DocumentsLedger.jsx'), /clickableProps\(\(\) => onHeaderClick\('\w+'\)\)/g), 4);
  assert.equal(count(read('src/home/ManageTeamModal.jsx'), ready), 5);
  assert.equal(count(read('src/home/ManageTeamModal.jsx'), box), 1);
  assert.equal(count(read('src/home/ProjectsFolderTree.jsx'), ready), 5);
  assert.equal(count(read('src/home/ProjectsFolderTree.jsx'), box), 5);
  assert.equal(count(read('src/home/TemplatesEditor.jsx'), ready), 5);
  assert.equal(count(read('src/home/TemplatesEditor.jsx'), box), 4);
  assert.equal(count(read('src/RegionSelectionTool.jsx'), /role: 'menuitem'/g), 5);
  assert.equal(count(read('src/SurveySpacesRail.jsx'), /role: 'menuitem'/g), 5);
  assert.equal(count(read('src/hooks/useAnnotationContextMenu.jsx'), /role: 'menuitem', disabled: it\.disabled/g), 1);
  for (const file of ['src/components/CreateCategoryModal.jsx', 'src/components/NewColumnsModal.jsx', 'src/components/ExcelSyncConfirmModal.jsx']) {
    assert.match(read(file), /role="radiogroup"/, file);
    assert.match(read(file), /role: 'radio'/, file);
  }
  assert.match(read('src/sidebar/BookmarksPanel.jsx'), /keyboardControlProps\(null, \{ enterOnly: true \}\)/);
});

test('a keyboard-ready element keeps its own look (no generic press or hub hover fill)', () => {
  const states = read('src/styles/states.css');
  const press = states.split('\n').find((line) => line.startsWith(":where(button, [role='button'], [role='tab'], [role='option']):active"));
  assert.ok(press && press.includes(':not([data-keyboard-control])'), 'press fill skips keyboard controls');
  assert.match(states, /\.survey-hub \[role='button'\]:not\(\[data-keyboard-control\]\)/, 'hub hover skips keyboard controls');
});
