import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/home/TemplatesEditor.css', import.meta.url), 'utf8');

test('template category and entity rows hover and press', () => {
  assert.match(css, /\.tpl-entity-row:not\(\.is-selected\):hover \{ background: var\(--hover\); \}/);
  assert.match(css, /:is\(\.tpl-cat-row, \.tpl-entity-row\):active:not\(:has\(input:active, button:active, \[data-drag-rearrange-handle\]:active\)\) \{\s*background: var\(--pressed\);/);
});

test('in the one look the template cards rest on the panel, so hover and press show', () => {
  assert.match(css, /html\[data-look="suite"\] \.ed-scope \.card-line \{ background: var\(--surface-2\); \}/);
});

test('desktop checklist line kind is the app drop-down, phones keep the wheel', () => {
  const src = readFileSync(new URL('../src/home/AnswerSetEditor.jsx', import.meta.url), 'utf8');
  const kind = src.slice(src.indexOf('export function ItemKindPicker'));
  assert.match(kind, /\{phone \? \(\s*<select\s+aria-label=\{`How "\$\{name\}" is answered`\}/);
  assert.match(kind, /<ValueSelect\s+look="pill"\s+width="auto"\s+label=\{`How "\$\{name\}" is answered`\}/);
});

test('a shut category leaves no see-through line under its header', () => {
  const src = readFileSync(new URL('../src/home/TemplatesEditor.jsx', import.meta.url), 'utf8');
  assert.match(src, /borderTop: open \? '1px solid var\(--rule\)' : 0,/);
  assert.doesNotMatch(src, /borderTop: open \? '1px solid var\(--rule\)' : '1px solid transparent'/);
});

test('PDF tools fields show their edge and ticks wear the accent', () => {
  const css = readFileSync(new URL('../src/components/PdfToolsDialog.css', import.meta.url), 'utf8');
  assert.match(css, /\.pdft-input\{[^}]*border:1px solid var\(--border-strong\)/);
  assert.match(css, /\.pdft-check input\{[^}]*accent-color:var\(--accent\)/);
});

test('joined-choice groups rest on the panel in the one look', () => {
  const bg = readFileSync(new URL('../src/components/ButtonGroup.css', import.meta.url), 'utf8');
  const lib = readFileSync(new URL('../src/markLibrary/MarkLibraryPanel.css', import.meta.url), 'utf8');
  assert.match(bg, /html\[data-look="suite"\] \.button-group \{ background: var\(--surface-2\); \}/);
  assert.match(lib, /html\[data-look="suite"\] \.mark-library__tabs \{ background: var\(--surface-2\); \}/);
});
