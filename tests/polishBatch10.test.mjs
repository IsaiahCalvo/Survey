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

test('card switch rows (Toolbars, Snapping, grid, layers) hover and press on the track, not the row', () => {
  const css = read('src/components/PageGridSettings.css');
  assert.match(css, /\.page-grid-settings__switch:not\(:disabled\):hover \.page-grid-settings__knob \{ box-shadow: inset 0 0 0 1px var\(--text-3\); \}/);
  assert.match(css, /\.page-grid-settings__switch\[aria-checked="true"\]:not\(:disabled\):hover \.page-grid-settings__knob \{ background: var\(--accent-light\); box-shadow: none; \}/);
  assert.match(css, /\.page-grid-settings__switch:not\(:disabled\):active \{ background: transparent !important; \}/);
  assert.match(css, /\.page-grid-settings__switch\[aria-checked="true"\]:not\(:disabled\):active \.page-grid-settings__knob \{ background: var\(--accent-press\); \}/);
});

test('template editor: Add checklist item hovers and presses, entity dots keep their colour when pressed and ring on hover', () => {
  const jsx = read('src/home/TemplatesEditor.jsx');
  assert.match(jsx, /<Icon name="plus" size=\{13\} \/> <span>Add checklist item<\/span>/);
  assert.match(read('src/home/hub.css'), /button\[aria-label="Edit color"\]:has\(> span\):active,\n\.hub-btn\.hub-btn--icon/);
  assert.match(read('src/styles/states.css'), /\[data-glyph-only\]\[data-glyph-only\]:not\(\.mobile-pdf-dock__side\):not\(\.mobile-pdf-dock__center\):not\(:is\(\[aria-label='Edit color'\], \[title='Edit color'\]\):empty\):active \{/);
  assert.match(read('src/home/TemplatesEditor.css'), /\.tpl-entity-row > button\[aria-label="Edit color"\]:hover \{ box-shadow: 0 0 0 2px var\(--border-strong\); \}/);
});

test('a setting pill shows a press in the light one look (pressed-2)', () => {
  assert.match(read('src/styles.css'), /\.chrome-pill:not\(:disabled\):active \{\n\s*background-color: var\(--pressed-2, var\(--pressed\)\) !important;/);
});

test('the Pages tab page dot (actions) shows a press', () => {
  assert.match(read('src/styles.css'), /\.pages-panel-more:active > span \{\n\s*background: var\(--pressed-2, var\(--pressed\)\);\n\s*transition: none;/);
});

test('History: legend filters and rows take the hover fill; Spotlight me hovers to the hover fill so its press shows', () => {
  const jsx = read('src/components/revisions/RevisionsPanel.jsx');
  assert.match(jsx, /\.dh-legend > button:not\(\[aria-pressed='true'\]\):hover \{ color: var\(--text-1\); background: var\(--hover\); border-radius: 4px; \}/);
  assert.match(jsx, /\.dh-row:not\(\.sel\):hover \{ background: var\(--hover\); \}/);
  assert.match(read('src/spotlight/spotlight.css'), /@media \(hover: hover\) \{ \.spotlight-me:hover \{ background: var\(--hover\); \} \}/);
});
