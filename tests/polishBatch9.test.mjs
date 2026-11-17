import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/home/TemplatesEditor.jsx', import.meta.url), 'utf8');

function menuLabels(anchor) {
  const at = src.indexOf(anchor);
  const end = src.indexOf(']}', at);
  return [...src.slice(at, end).matchAll(/\{ label: '([^']+)'/g)].map((m) => m[1]);
}

test('template editor ⋮ menus share one order: Rename first, Delete last', () => {
  const want = ['Rename', 'Duplicate', 'Move', 'Copy', 'Share', 'Delete'];
  for (const anchor of ['anchorRect={tplMenu.rect}', 'anchorRect={entityMenu.rect}', 'anchorRect={catMenu.rect}', 'anchorRect={modMenu.rect}']) {
    if (!src.includes(anchor)) continue;
    const got = menuLabels(anchor);
    assert.deepEqual(got, want.filter((l) => got.includes(l)), anchor);
  }
});

test('a module tab shows a press with no inner block behind its label', () => {
  const css = readFileSync(new URL('../src/home/TemplatesEditor.css', import.meta.url), 'utf8');
  assert.match(css, /\.ed-scope \[data-module-tab-id\]:not\(\[data-drag-lifted\]\):active \{\s*background: var\(--pressed\) !important;/);
  assert.match(css, /\.ed-scope \[data-module-tab-id\]:active > button \{ background: transparent !important; \}/);
});

test('template list rows hover and press when not chosen', () => {
  const css = readFileSync(new URL('../src/home/TemplatesEditor.css', import.meta.url), 'utf8');
  assert.match(src, /className=\{`tpl-list-row\$\{\(tplEdit \? isSel : active\) \? ' is-selected' : ''\}`\}/);
  assert.match(css, /\.ed-scope \.tpl-list-row:not\(\.is-selected\):hover \{ background: var\(--hover\) !important; \}/);
  assert.match(css, /\.ed-scope \.tpl-list-row:active:not\(:has\(button:active, input:active, \[data-drag-rearrange-handle\]:active\)\) \{\s*background: var\(--pressed\) !important;/);
});

test('project document rows hover and press', () => {
  const hub = readFileSync(new URL('../src/home/hub.css', import.meta.url), 'utf8');
  assert.match(hub, /\.projects-file-grid\[data-document-id\]:not\(:has\(\[aria-checked='true'\]\)\):hover \{ background: var\(--hover\) !important; \}/);
  assert.match(hub, /\.projects-file-grid\[data-document-id\]:active:not\(:has\(button:active, \[role='checkbox'\]:active, \[data-drag-rearrange-handle\]:active\)\) \{\s*background: var\(--pressed\) !important;/);
});

test('project list rows hover and press when not chosen', () => {
  const hub = readFileSync(new URL('../src/home/hub.css', import.meta.url), 'utf8');
  const tree = readFileSync(new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url), 'utf8');
  assert.match(tree, /className=\{`projects-list-row\$\{\(jobsEdit \? isSel : isOpen\) \? ' is-selected' : ''\}`\}/);
  assert.match(hub, /\.projects-list-row:not\(\.is-selected\):hover \{ background: var\(--hover\) !important; \}/);
});

test('search text results take the hover fill', () => {
  const css = readFileSync(new URL('../src/sidebar/searchTextPanel.css', import.meta.url), 'utf8');
  assert.match(css, /\.search-text-result:not\(\.is-active\):hover \{\s*color: var\(--text-2\);\s*background: var\(--hover\);/);
});

test('Toolbars workspaces: field edge, hint on the title edge, delete hover fill', () => {
  const css = readFileSync(new URL('../src/styles/toolBarVisibility.css', import.meta.url), 'utf8');
  assert.match(css, /\.toolbars-card__workspaces > \.page-grid-settings__hint \{ padding: 0 10px; \}/);
  assert.match(css, /\.toolbars-card__workspace-save input \{[^}]*border: 1px solid var\(--border-strong\)/);
  assert.match(css, /\.toolbars-card__workspace-delete:hover \{ background: var\(--hover\);/);
});
