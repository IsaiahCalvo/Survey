/*
 * editorLayoutDecision.test.mjs — the Templates / Projects editor layout the
 * owner decided on 2026-10-01 (category rows "off, weird, random"; clicking a
 * row's empty space must open it; the name's hit box was too long; module tab
 * titles not centred; Select / "+ add" buttons looked off).
 *
 * Pins the rules that are easy to undo by accident:
 *   - section actions are quiet words, gold stays for the page's one primary;
 *   - a category row toggles on a click anywhere, the grip alone drags, and the
 *     name is a text-width field;
 *   - on a phone a closed row's name ignores taps (no surprise keyboard);
 *   - module tabs hug their label and have a touch way to rename;
 *   - the phone's duplicate "New module" header word is gone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const editor = read('src/home/TemplatesEditor.jsx');
const projects = read('src/home/ProjectsFolderTree.jsx');
const hub = read('src/home/hub.css');
const editorCss = read('src/home/TemplatesEditor.css');

test('tertiary section words are quiet, not gold', () => {
  const block = hub.slice(hub.indexOf('/* TERTIARY'), hub.indexOf('/* A destructive member'));
  assert.match(block, /\.hub-btn\.hub-btn--tertiary,[\s\S]*?color: var\(--text-2\);/);
  assert.doesNotMatch(block, /var\(--accent(-light|-press)?\)/);
  // The section headers carry the one quiet size.
  assert.match(hub, /\.survey-hub \.hub-btn\.hub-section-btn \{[^}]*font-size: 13px;/);
  // "+ Category" / "+ Entity" are quiet words now, not gold fills.
  assert.doesNotMatch(editor, /hub-btn--primary">\s*<Icon name="plus" size=\{11\} \/>New (category|entity)/);
  assert.match(editor, /aria-label="New category"/);
  assert.match(editor, /aria-label="New entity"/);
});

test('a category row toggles on a click anywhere; the grip alone drags', () => {
  const row = editor.slice(editor.indexOf('className={`tpl-cat-row'), editor.indexOf('{/* Expanded body'));
  assert.match(row, /onClick=\{\(\) => \{ if \(catEdit\) toggleCatSel\(c\.id\); else setOpenCat\(open \? -1 : i\); \}\}/);
  assert.match(row, /<DragRearrangeHandle\s+\{\.\.\.attributes\}\s+\{\.\.\.listeners\}/);
  // The listeners live on the grip only, never on the row itself.
  assert.doesNotMatch(row.slice(0, row.indexOf('<DragRearrangeHandle')), /\{\.\.\.listeners\}/);
  // The name is a text-width field that stops its click from toggling.
  assert.match(row, /className="hub-autowidth tpl-cat-name"/);
  assert.match(row, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  // ⋮ menu with Rename / Delete.
  assert.match(editor, /\{ label: 'Rename', onClick: \(\) => \{[\s\S]{0,300}data-category-name-id/);
  assert.match(editorCss, /\.ed-scope \.tpl-cat-row,\s*\.ed-scope \.tpl-entity-row \{[^}]*min-height: 40px;/);
});

test('phone: a closed row ignores taps on its name, and the disclosure stays the one direct button', () => {
  assert.match(hub, /\.templates-mobile-category-row:not\(\.is-open\) > \.templates-mobile-category-name > input,[\s\S]*?pointer-events: none;/);
  // Workflow scripts tap `.templates-mobile-category-row > button` as the
  // disclosure; the ⋮ button is wrapped so that selector stays unique.
  assert.match(editor, /<span className="templates-mobile-category-more">\s*<button/);
});

test('module tabs hug their label and can be renamed by touch', () => {
  const tab = editor.slice(editor.indexOf('function SortableModuleTab('), editor.indexOf('function SortableModuleTabs('));
  assert.match(tab, /flex: '0 0 auto',/);
  assert.match(tab, /padding: '0 12px',/);
  assert.doesNotMatch(tab, /maxWidth: 140/);
  assert.match(tab, /isOn && pointerTypeRef\.current === 'touch' && onOpenMenu/);
  assert.match(editor, /\{ label: 'Rename', onClick: \(\) => flushSync\(\(\) => setModRename\(mod\.id\)\) \}/);
  // One way to add a module on the phone: the "+" after the tabs.
  assert.doesNotMatch(editor, /<Icon name="plus" size=\{11\} \/>New module<\/button>/);
});

test('titles are text-width fields on both pages', () => {
  assert.match(editor, /className="hub-autowidth hub-title-field"/);
  assert.match(projects, /className="hub-autowidth hub-title-field"/);
  assert.match(projects, /className="hub-autowidth projects-mobile-title-field"/);
  // The phone's 16px input floor applies to the hidden sizing twin too.
  assert.match(hub, /html\[data-mobile-viewport="locked"\] \.hub-autowidth::after \{\s*font-size: max\(16px, 1em\);/);
});
