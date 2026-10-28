// Owner 2026-10-28: the drop-downs take the look and motion of four 21st.dev
// components he picked. Each one lives in ONE shared piece, so every place
// that uses it changes together:
//   - smooth dropdown -> MenuGlide (a hover strip with a short bar that glides
//     from row to row) + action menus that grow out of their button and rows
//     that arrive one after another (motion.css);
//   - SmoothUI basic dropdown (his "accordion" link, really a select) ->
//     AnnotationDropdown / ValueSelect: the list unrolls under its field and
//     the chevron turns over while it is open;
//   - shadcn button group -> ButtonGroup, the joined choice buttons in dialogs;
//   - activity dropdown -> Expander, a section that folds open in place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every action menu and value list carries the gliding hover strip', () => {
  assert.match(read('src/components/MenuRows.jsx'), /\[<MenuGlide key="menu-glide" \/>, \.\.\.rows\.map/);
  assert.match(read('src/components/AnnotationDropdown.jsx'), /role="listbox" aria-label=\{label\}>\s*<MenuGlide \/>/);
  assert.match(read('src/components/ExportMenu.jsx'), /<MenuGlide \/>/);
  assert.match(read('src/hooks/useAnnotationContextMenu.jsx'), /className="annotation-menu-body">\s*<MenuGlide \/>/);
  // The rows' hosts are positioned, so the strip measures rows against them.
  assert.match(read('src/components/AnnotationDropdown.css'), /\.annotation-dropdown__body \{\s*\/\*[^*]*\*\/\s*position: relative;/);
  assert.match(read('src/styles/annotationContextMenu.css'), /\.annotation-menu-body \{\s*position: relative;/);
});

test('the hover strip is neutral ink, red on a danger row, never gold', () => {
  const css = read('src/components/MenuGlide.css');
  assert.doesNotMatch(css, /--accent|--gold/);
  assert.match(css, /\.menu-glide\[data-danger\] \.menu-glide__bar \{\s*background: var\(--danger-text\);/);
  assert.match(css, /transform var\(--motion-glide\) var\(--ease-glide\)/);
  // A finger gets the row's own press colour, not the strip.
  assert.match(read('src/components/MenuGlide.jsx'), /event\.pointerType === 'touch'\) return;/);
});

test('the drop-down motion tokens exist and are instant under reduced motion', () => {
  const tokens = read('src/styles/tokens.css');
  for (const name of ['--motion-menu-open', '--motion-menu-row', '--motion-menu-stagger', '--motion-glide']) {
    assert.match(tokens, new RegExp(`${name}:\\s*\\d+ms;`), name);
    assert.match(tokens, new RegExp(`${name}:\\s*0ms;`), `${name} under reduced motion`);
  }
  assert.match(tokens, /--ease-glide:\s*cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
});

test('action menus grow from their button; rows arrive one after another', () => {
  const motion = read('src/styles/motion.css');
  assert.match(motion, /:where\(\.hub-menu\) \{\s*animation: sv-menu-grow var\(--motion-menu-open\) var\(--ease-glide\);\s*transform-origin: var\(--menu-origin, top right\);/);
  assert.match(motion, /animation-delay: calc\(min\(var\(--menu-row, 0\), 10\) \* var\(--motion-menu-stagger\)\);/);
  assert.match(read('src/components/MenuRows.jsx'), /style=\{\{ '--menu-row': index \}\}/);
  assert.match(read('src/components/AnnotationDropdown.jsx'), /style=\{\{ '--menu-row': index, \.\.\.option\.style \}\}/);
  assert.match(read('src/home/hub.css'), /\.hub-menu\.documents-row-menu \{\s*animation: sv-menu-grow/);
});

test('a value list unrolls under its field and its chevron turns over', () => {
  const css = read('src/components/AnnotationDropdown.css');
  assert.match(css, /animation: annotation-dropdown-in var\(--motion-menu-open\) var\(--ease-glide\);/);
  assert.match(css, /\[data-side='top'\] \{\s*animation-name: annotation-dropdown-in-up;/);
  assert.match(css, /\.annotation-dropdown__trigger\[data-state='open'\] \.annotation-dropdown__chevron \{\s*rotate: 180deg;/);
});

test('dialog choice rows are the one ButtonGroup, chosen = gold ink only', () => {
  for (const path of ['src/components/PdfToolsDialog.jsx', 'src/components/ExportPdfDialog.jsx',
    'src/components/PageGridSettings.jsx', 'src/components/PrintPanel.jsx']) {
    assert.match(read(path), /<ButtonGroup\b/, `${path} should use ButtonGroup`);
  }
  for (const path of ['src/components/PdfToolsDialog.css', 'src/components/PrintPanel.css']) {
    assert.doesNotMatch(read(path), /\.pdft-seg|\.pp-seg/, `${path} still styles its own segmented row`);
  }
  const css = read('src/components/ButtonGroup.css');
  const chosen = css.match(/\[aria-checked='true'\] \{[^}]*\}/)[0];
  assert.match(chosen, /color: var\(--accent\);/);
  assert.doesNotMatch(chosen, /background|border|box-shadow/);
  assert.match(read('src/components/ButtonGroup.jsx'), /onKeyDown=\{moveGroupFocus\}/);
});

test('a space folds open in place (Expander) and its regions rise in', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  assert.match(panel, /<Expander open=\{isExpanded\}>\s*<div className="space-card__body">/);
  assert.match(panel, /data-expander-row=""\s*style=\{\{ '--expander-row': rowIndex \}\}/);
  const css = read('src/components/Expander.css');
  assert.match(css, /grid-template-rows var\(--motion-collapse\) var\(--ease-glide\)/);
  assert.match(read('src/components/Expander.jsx'), /inert=\{shown \? undefined : ''\}/);
});

test('arrow keys in a choice group skip a disabled choice', async () => {
  const { moveGroupFocus } = await import('../src/utils/radioGroupKeys.js');
  const make = (disabled = false) => ({ disabled, getAttribute: () => null, focus() { globalThis.document.activeElement = this; } });
  const [a, b, c] = [make(), make(true), make()];
  globalThis.document = { activeElement: a };
  const event = { key: 'ArrowRight', currentTarget: { querySelectorAll: () => [a, b, c] }, preventDefault() {} };
  moveGroupFocus(event);
  assert.equal(globalThis.document.activeElement, c);
  moveGroupFocus({ ...event, key: 'ArrowLeft' });
  assert.equal(globalThis.document.activeElement, a);
  delete globalThis.document;
});

test('style menus are plain lists: no paper sample, slider or tile cards (owner 2026-10-28)', () => {
  const shell = read('src/AppShell.jsx');
  assert.doesNotMatch(shell, /LineStyleCard|ArrowEndsCard|stroke-card-popover/);
  assert.match(shell, /data-arrow-both-ends="true"/);
  const cards = read('src/components/StrokeStyleCards.jsx');
  assert.doesNotMatch(cards, /export function (LineStyleCard|ArrowEndsCard)/);
  const size = read('src/components/AnnotationSizeControl.jsx');
  assert.doesNotMatch(size, /type="range"|data-size-card-sample/);
});
