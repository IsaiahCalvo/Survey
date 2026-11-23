import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { menuIconFor } from '../src/utils/menuItems.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const states = read('src/styles/states.css');
// The two app-wide press rules (plain and chosen) end with the same list.
const pressEnds = (cls) => (states.match(new RegExp(`:not\\(${cls}\\)[^{]*\\{\\n\\s*background-color: var\\(--pressed`, 'g')) || []).length;

test('phone pass: the chosen coral filter chip presses to the darker coral, never a grey', () => {
  assert.equal(pressEnds('\\.home-filter-chip\\.is-on'), 2);
  assert.match(states, /\.mobile-survey-notes-save, \.home-filter-chip\.is-on\):active:not\(:disabled\)/);
  const css = read('src/home/homeLibrary.css');
  assert.match(css, /\.home-filter-chip\.is-on:hover:not\(:active\) \{ background: var\(--accent-light\);/);
});

test('phone pass: document review chips rest on raised and press a step past hover', () => {
  const css = read('src/home/documentReview.css');
  assert.match(css, /html\[data-look='suite'\] \.doc-review-chip \{ background: var\(--hover\); \}/);
  assert.match(css, /html\[data-look='suite'\] \.doc-review-chip:not\(\[aria-pressed='true'\]\):hover:not\(:active\) \{ background: var\(--surface-3\); \}/);
  assert.match(css, /:root \.doc-review-chip:not\(:disabled\):active \{ background: var\(--pressed-2, var\(--pressed\)\);/);
  assert.equal(pressEnds('\\.doc-review-chip'), 2);
  assert.match(states, /:not\(\.chrome-pill\):not\(\.doc-review-chip\)/);
});

test('phone pass: the line width and style pills press to pressed-2', () => {
  const css = read('src/mobile/mobilePdfViewer.css');
  assert.match(css, /\.mobile-styled-select__trigger:not\(:disabled\):active \{ background: var\(--pressed-2, var\(--pressed\)\);/);
  assert.equal(pressEnds('\\.mobile-styled-select__trigger'), 2);
});

test('phone pass: Edit details and label rows carry icons like the rest of the menu', () => {
  assert.equal(menuIconFor('Edit details…'), 'editList');
  assert.equal(menuIconFor('Add label…'), 'tag');
  assert.equal(menuIconFor('Edit labels…'), 'tag');
  assert.equal(menuIconFor('Add labels…'), 'tag');
  assert.equal(menuIconFor('Rename'), 'edit');
});

test('phone pass: the back buttons rest on the panel colour so a dark press shows', () => {
  const css = read('src/home/hub.css');
  assert.match(css, /html\[data-look='suite'\] \.survey-hub \.projects-mobile-back-button,\nhtml\[data-look='suite'\] \.survey-hub \.templates-mobile-back-button \{ background: var\(--surface-2\); \}/);
});

test('tablet pass: the Documents header search gives way so Upload stays on screen', () => {
  const css = read('src/home/hub.css');
  assert.match(css, /\.survey-hub \.header > \.actions \{ min-width: 0; \}/);
  assert.match(css, /\.survey-hub \.header > \.actions > \.documents-desktop-search \{ min-width: 140px; \}/);
  assert.match(css, /\.documents-desktop-search > \.hub-search \{ max-width: 100%; \}/);
  assert.match(css, /\(min-device-width: 600px\) and \(min-device-height: 600px\) and \(max-width: 800px\) \{\n\s*\.survey-hub \.header:has\(> \.actions > \.documents-desktop-search\) \{ flex-wrap: wrap; row-gap: 8px; \}/);
});

test('tablet pass: review pickers stack in a narrow preview pane', () => {
  assert.match(read('src/home/documentReview.css'), /\.doc-review-fields \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(120px, 1fr\)\);/);
});

test('tablet pass: the template header drops its layout pickers under the name', () => {
  assert.match(read('src/home/TemplatesEditor.jsx'), /className="templates-editor-head"/);
  const css = read('src/home/TemplatesEditor.css');
  assert.match(css, /\.templates-editor-head \{ flex-wrap: wrap; row-gap: 10px; \}/);
  assert.match(css, /\.templates-editor-head > div:nth-child\(2\) \{ flex: 1 1 200px !important; \}/);
  assert.match(css, /\.templates-editor-head > \.micro \{ margin-left: auto; max-width: 100% !important; \}/);
});

test('tablet pass: project and file rows press under a finger, and the previewed document row presses', () => {
  const css = read('src/home/hub.css');
  assert.doesNotMatch(css, /@media \(pointer: fine\) \{\n\s*\.survey-hub \.projects-list-row:active/);
  assert.doesNotMatch(css, /@media \(pointer: fine\) \{\n\s*\.survey-hub \.projects-file-grid\[data-document-id\]:active/);
  assert.match(css, /\n\.survey-hub \.projects-list-row:active:not\(:has\(/);
  assert.match(css, /\.survey-hub \.documents-ledger-row\.is-selected:not\(\.is-dragging\):active,/);
});

test('ground steps: an idle top tab hovers and presses on the suite ground steps, for mouse and finger', () => {
  const tokens = read('src/styles/tokens.css');
  assert.match(tokens, /--hover-ground: #242426;\n\s*--pressed-ground: #0b0b0c;/);
  assert.match(tokens, /--hover-ground: #ebebeb;\n\s*--pressed-ground: #e0e0e0;/);
  const tabs = read('src/TabBar.jsx');
  assert.match(tabs, /const TAB_HOVER_BG = 'var\(--hover-ground, var\(--hover\)\)';/);
  assert.match(tabs, /const TAB_PRESSED_BG = 'var\(--pressed-ground, var\(--pressed\)\)';/);
  assert.match(tabs, /isActive \? TAB_ACTIVE_PRESSED_BG : TAB_PRESSED_BG/);
  const css = read('src/styles.css');
  assert.match(css, /\[data-app-tab\]:not\(\[data-tab-active\]\):not\(\[aria-pressed='true'\]\):not\(:has\(:is\(button, \[role='button'\]\):active\)\):active \{\n\s*background: var\(--pressed-ground, var\(--pressed\)\) !important;/);
  assert.equal(pressEnds('\\[data-app-tab\\]'), 2);
  const rules = read('docs/suite/SUITE-RULES.md');
  assert.match(rules, /\| ground-pressed \| Press on a control that rests on ground \| `#0b0b0c` \| `#e0e0e0` \|/);
});
