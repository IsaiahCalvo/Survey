// KAL-652 polish, batch 3 (2026-11-16): faults found by looking at each screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('a plain-text hub subtitle gets its own element, so a phone header can order it after the title', () => {
  // My library passed "Synced" as bare text. On phones the subtitle row
  // dissolves into the header row, and bare text there sat before the title.
  assert.match(read('src/home/HubShell.jsx'), /typeof subtitle === 'string' \? <span>\{subtitle\}<\/span> : subtitle/);
});

test('a phone hub header with no work row is one row tall', () => {
  const css = read('src/home/hub.css');
  assert.match(css, /\.survey-hub:not\(:has\(\.header > \.actions > \*\)\) \{\s*--mobile-header-h: calc\(\(var\(--mobile-header-pad-y\) \* 2\) \+ var\(--mobile-header-row-h\) \+ 1px\);/);
  assert.match(css, /\.survey-hub \.header > \.actions:empty \{\s*display: none;/);
});

test('Settings buttons: the plain one rests clear so hover lightens, and Delete account changes under the pointer', () => {
  const css = read('src/components/AccountSettings.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector) => new RegExp(`${selector.replace(/[.:()]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] || '';
  assert.match(rule('.account-btn-secondary'), /background: transparent;/);
  const rest = /background: ([^;]+);/.exec(rule('.account-btn-danger'))[1];
  const hover = /background: ([^;]+);/.exec(rule('.account-btn-danger:hover:not(:disabled)'))[1];
  assert.notEqual(hover, rest, 'Delete account repaints its resting fill on hover');
  // On a touch screen the three kinds are one height.
  // (Main's rule lists every Settings button in one block; the train kept it.)
  const coarse = /@media \(pointer: coarse\) \{([^}]*)\{ min-height: 44px; \}/.exec(css)?.[1] || '';
  for (const kind of ['.account-btn-danger', '.account-btn-primary', '.account-btn-secondary']) {
    assert.ok(coarse.includes(kind), `${kind} is 44px on touch`);
  }
});

test('Keyboard shortcuts wears the one dialog close button', () => {
  const src = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(src, /aria-label="Close keyboard shortcuts"\s*className="hub-icon-btn"/);
  assert.doesNotMatch(src, /onMouseEnter/);
});

test('Photos groups by day, week or month with the shared joined picker', () => {
  const src = read('src/projectPhotos/ProjectPhotosPanel.jsx');
  assert.match(src, /<ButtonGroup label="Group photos by"/);
  assert.doesNotMatch(read('src/projectPhotos/projectPhotos.css'), /\.photo-grouping/);
});

test('the Search text field is the height and inset of the other panel search fields', () => {
  const src = read('src/sidebar/SearchTextPanel.jsx');
  assert.match(src, /className="search-text-panel__input"[\s\S]{0,700}height: '30px'/);
  assert.match(src, /padding: '8px 8px 0'/);
  assert.match(read('src/sidebar/MarkupsPanel.css'), /\.markups-panel__search \{[^}]*height: 30px;/);
});

test('the project and file menus are placed by their measured width, so a wide menu stays on a phone screen', () => {
  const src = read('src/home/ProjectsFolderTree.jsx');
  const menu = src.slice(src.indexOf('function PopupMenu('), src.indexOf('export default function ProjectsFolderTree('));
  assert.match(menu, /useLayoutEffect\(\(\) => \{[\s\S]*?const width = el\.offsetWidth;[\s\S]*?window\.innerWidth - width - 8/);
});

test('the issue Labels field is the height of the fields above it', () => {
  assert.match(read('src/projectItems/projectItems.css'), /\.item-tag-input \{ height: 30px;/);
});
