// Design review 2026-10-27: the action menus (things to DO) had drifted
// apart - 11, 12 and 13px text, 26, 28 and 32px rows, icons on some rows
// only, Delete in the middle. They now share one row (tokens.css --menu-*)
// and the home menus draw their rows through components/MenuRows.jsx.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrangeMenuItems, menuIconFor } from '../src/utils/menuItems.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Delete goes last, below one line; the rest keep their order', () => {
  const rows = arrangeMenuItems([
    { label: 'Rename' },
    { label: 'Delete', danger: true },
    { label: 'Share' },
    null,
    { label: 'Lock document' },
  ]);
  assert.deepEqual(rows.map((row) => (row.separator ? '---' : row.label)), ['Rename', 'Share', 'Lock document', '---', 'Delete']);
  assert.deepEqual(arrangeMenuItems([{ label: 'Delete', danger: true }]).map((row) => row.label), ['Delete']);
  assert.deepEqual(arrangeMenuItems([{ label: 'A' }, { label: 'B' }]).map((row) => row.label), ['A', 'B']);
});

test('every common home action gets an icon', () => {
  for (const label of ['Rename', 'Copy', 'Paste', 'Duplicate', 'Move to project…', 'Copy to project', 'PDF tools…',
    'Share', 'Lock document', 'Unlock document', 'Delete', 'Delete 3 documents', 'Upload files', 'Add member',
    'Get link to project', 'Manage project', 'Merge into one PDF']) {
    assert.ok(menuIconFor(label), `no icon for "${label}"`);
  }
  assert.equal(menuIconFor('Copy to project'), 'moveTo');
  assert.equal(menuIconFor('Copy'), 'copy');
});

test('the action menus read the shared menu row tokens', () => {
  const tokens = read('src/styles/tokens.css');
  assert.match(tokens, /--menu-font:\s*400 13px\/16px var\(--font-ui\)/);
  assert.match(tokens, /--menu-item-pad-x:/);
  const hubItem = read('src/home/hub.css').match(/\.hub-menu__item \{[^}]*\}/)[0];
  assert.match(hubItem, /font: var\(--menu-font\)/);
  assert.match(hubItem, /min-height: var\(--menu-item-h\)/);
  const markRow = read('src/styles/annotationContextMenu.css').match(/\.annotation-menu-row \{[^}]*\}/)[0];
  assert.match(markRow, /min-height: var\(--menu-item-h\)/);
  assert.match(markRow, /padding: 0 var\(--menu-item-pad-x\)/);
  assert.match(read('src/sidebar/PageActionsMenu.jsx'), /font: 'var\(--menu-font\)'/);
  assert.match(read('src/hooks/useAnnotationContextMenu.jsx'), /font: 'var\(--menu-font\)'/);
  assert.match(read('src/components/ExportMenu.jsx'), /className="hub-menu__item"/);
});

test('home row menus draw their rows through MenuRows, not by hand', () => {
  for (const path of ['src/home/DocumentsLedger.jsx', 'src/home/ProjectsFolderTree.jsx', 'src/components/ListItemContextMenu.jsx']) {
    const source = read(path);
    assert.match(source, /<MenuRows /, `${path} should render <MenuRows>`);
    assert.doesNotMatch(source, /items\.map\(\(it\) => \(\s*<button[\s\S]{0,120}hub-menu__item/, `${path} still maps its own menu rows`);
  }
});

test('desktop and phone name the exports the same way', () => {
  const desktop = read('src/AppShell.jsx');
  const phone = read('src/mobile/MobilePdfViewerChrome.jsx');
  for (const label of ['Export annotated PDF', 'Export markup (XFDF)', 'Export review package (ZIP)']) {
    assert.ok(desktop.includes(`'${label}'`), `desktop export menu lacks "${label}"`);
    assert.ok(phone.includes(label), `phone menu lacks "${label}"`);
  }
  assert.doesNotMatch(phone, /<Icon name="share" size=\{HEADER_GLYPH\}/, 'phone Export should use the download glyph like desktop');
});
