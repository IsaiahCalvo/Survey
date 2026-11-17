import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('page menus: words in their own span so the app-wide press shows; thumbnail menu on the panel colour', () => {
  assert.match(read('src/sidebar/PageActionsMenu.jsx'), /<span>\{label\}<\/span>/);
  const pages = read('src/sidebar/PagesPanel.jsx');
  assert.match(pages, /top: contextMenu\.y,\s*\/\/[^\n]*\n\s*background: 'var\(--surface-2\)',/);
  assert.match(pages, /dangerHoverBg=\{mobileMode \? 'var\(--surface-2\)' : 'var\(--hover\)'\}/);
  const viewer = read('src/hooks/useAnnotationContextMenu.jsx');
  assert.match(viewer, /hoverBg=\{isMobileMenu \? 'var\(--surface-2\)' : 'var\(--hover\)'\}/);
});

test('menus with the gliding hover strip show a press; pressed-2 from the suite colour table', () => {
  const glide = read('src/components/MenuGlide.css');
  assert.match(glide, /\.menu-glide:not\(\[data-danger\]\):has\(~ :is\(\[role='menuitem'\][^)]*\):active:not\(:disabled\):not\(\[aria-disabled='true'\]\)\) \{\s*background: var\(--pressed-2, var\(--pressed\)\);/);
  const tokens = read('src/styles/tokens.css');
  assert.match(tokens, /--pressed: #131315;\n[\s\S]{0,200}--pressed-2: #131315;/);
  assert.match(tokens, /--pressed: #ebebeb;\n\s*--pressed-2: #e0e0e0;/);
});

test('a chosen item shows a press in the light one look (pressed-2)', () => {
  const states = read('src/styles/states.css');
  assert.match(states, /:is\(\[aria-selected='true'\], \[aria-pressed='true'\], \[aria-checked='true'\], \[aria-current\]:not\(\[aria-current='false'\]\), \.is-selected, \.is-active, \.active\):active:not\(:disabled\)[^{]*:not\(\.primary\)[^{]*\{\s*background-color: var\(--pressed-2, var\(--pressed\)\) !important;/);
  assert.match(read('src/home/hub.css'), /\.projects-list-row\.is-selected:active:not\([^{]*\{\s*background: var\(--pressed-2, var\(--pressed\)\) !important;/);
  assert.match(read('src/home/TemplatesEditor.css'), /:is\(\.tpl-list-row, \.tpl-cat-row, \.tpl-entity-row\)\.is-selected:active/);
});

test('every mark menu row carries an icon (Edit subject, Dock / Float bar)', () => {
  const src = read('src/hooks/useAnnotationContextMenu.jsx');
  assert.match(src, /editSubject: 'edit', dockSelectionBar: 'alignBottom', floatSelectionBar: 'alignBottom' \};/);
});

test('Settings: chosen joined-choice options press, switches hover and press, the close glyph presses', () => {
  assert.match(read('src/styles/states.css'), /:is\(\[aria-selected='true'\], \[aria-pressed='true'\], \[aria-checked='true'\],/);
  const css = read('src/components/AccountSettings.css');
  assert.match(css, /\.account-settings-close:active > svg \{ transform: scale\(0\.88\); transition: none; \}/);
  assert.match(css, /\.account-switch:not\(:disabled\):hover \.account-switch-track \{ box-shadow: inset 0 0 0 1px var\(--text-3\); \}/);
  assert.match(css, /\.account-switch:not\(:disabled\):active \.account-switch-track \{ background: var\(--pressed-2, var\(--pressed\)\); transition: none; \}/);
  assert.match(css, /\.account-switch\[aria-checked='true'\]:not\(:disabled\):active \.account-switch-track \{ background: var\(--accent-press\); \}/);
});
