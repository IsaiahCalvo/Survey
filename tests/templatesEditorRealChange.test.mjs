// Owner 2026-10-02: "If I don't make a change, what's the point in saving?"
// The Templates editor's Save / Cancel bar (and every other save prompt in the
// app) asks only when something really differs from what was loaded / saved.
// Also pins the one rename look (straight dotted underline, no box, no gold).
//
// Part A runs the REAL pure helpers (src/home/templatesEditorReload.js).
// Part B is source tripwires over the wiring Node cannot render.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  fingerprintTemplates,
  workingCopyDiffers,
  resolveEntityStyle,
  seedColorMaps,
} from '../src/home/templatesEditorReload.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const editor = read('src/home/TemplatesEditor.jsx');
const hubCss = read('src/home/hub.css');
const editorCss = read('src/home/TemplatesEditor.css');

const tpl = () => ({
  id: 't1',
  name: 'Paging',
  modules: [
    { id: 'm1', name: 'Existing', categories: [{ id: 'c1', name: 'Speaker', items: [{ id: 'i1', text: 'Mounted' }, { id: 'i2', text: 'Labelled' }] }] },
    { id: 'm2', name: 'New', categories: [] },
  ],
  roster: [{ id: 'e1', role: 'GC', color: '#C293E6', opacity: 0.35, borderColor: null, borderOpacity: null, matchFill: false }],
});

/* ---------------- Part A ---------------- */

test('a rebuilt copy with the same content is not a change', () => {
  const base = fingerprintTemplates([tpl()]);
  assert.equal(workingCopyDiffers(fingerprintTemplates([tpl()]), base), false);
});

test('rename, reorder and colour are changes; changing back is not', () => {
  const base = fingerprintTemplates([tpl()]);
  const renamed = tpl(); renamed.modules[0].name = 'Old';
  assert.equal(workingCopyDiffers(fingerprintTemplates([renamed]), base), true);
  renamed.modules[0].name = 'Existing';
  assert.equal(workingCopyDiffers(fingerprintTemplates([renamed]), base), false);

  const moved = tpl(); moved.modules.reverse();
  assert.equal(workingCopyDiffers(fingerprintTemplates([moved]), base), true);
  moved.modules.reverse();
  assert.equal(workingCopyDiffers(fingerprintTemplates([moved]), base), false);

  const items = tpl(); items.modules[0].categories[0].items.reverse();
  assert.equal(workingCopyDiffers(fingerprintTemplates([items]), base), true);

  const maps = { roleColors: { e1: { color: '#ff0000', opacity: 0.35 } } };
  assert.equal(workingCopyDiffers(fingerprintTemplates([tpl()], maps), base), true);
});

test('the colour maps seeded from the entity itself are not a change (open picker, close)', () => {
  const rich = [tpl()];
  const base = fingerprintTemplates(rich);
  assert.equal(workingCopyDiffers(fingerprintTemplates(rich, seedColorMaps(rich)), base), false);
  // Colour case and opacity float noise are not changes either.
  const maps = { roleColors: { e1: { color: '#c293e6', opacity: 0.35000000001 } } };
  assert.equal(workingCopyDiffers(fingerprintTemplates(rich, maps), base), false);
});

test('template list order never counts (it is its own, instantly saved preference)', () => {
  const a = { ...tpl(), id: 'a' };
  const b = { ...tpl(), id: 'b', name: 'Security' };
  assert.equal(workingCopyDiffers(fingerprintTemplates([b, a]), fingerprintTemplates([a, b])), false);
});

test('an added or removed template is a change', () => {
  const base = fingerprintTemplates([tpl()]);
  assert.equal(workingCopyDiffers(fingerprintTemplates([tpl(), { ...tpl(), id: 't2' }]), base), true);
  assert.equal(workingCopyDiffers(fingerprintTemplates([]), base), true);
  assert.equal(workingCopyDiffers(fingerprintTemplates([tpl()]), null), true);
});

test('a fresh blank checklist row is left out until typed into', () => {
  const base = fingerprintTemplates([tpl()]);
  const withBlank = tpl(); withBlank.modules[0].categories[0].items.push({ id: 'blank', text: '' });
  assert.equal(workingCopyDiffers(fingerprintTemplates([withBlank], {}, new Set(['blank'])), base), false);
  assert.equal(workingCopyDiffers(fingerprintTemplates([withBlank]), base), true);
});

test('resolveEntityStyle: matched border follows the fill, maps win over fields', () => {
  const e = { id: 'e1', color: '#111111', opacity: 0.5, borderColor: '#222222', borderOpacity: 0.7 };
  assert.deepEqual(resolveEntityStyle(e), { color: '#111111', opacity: 0.5, borderColor: '#222222', borderOpacity: 0.7, matchFill: false });
  assert.deepEqual(resolveEntityStyle(e, { matchFill: { e1: true }, roleColors: { e1: { color: '#333333', opacity: 0.2 } } }),
    { color: '#333333', opacity: 0.2, borderColor: '#333333', borderOpacity: 0.2, matchFill: true });
});

/* ---------------- Part B — wiring ---------------- */

test('the Save bar reads edit flag AND a real difference from the baseline', () => {
  assert.match(editor, /const dirty = editFlag && workingCopyDiffers\(workingFingerprint, baseline\);/);
  assert.match(editor, /const saveRowVisible = dirty \|\| titleDirty;/);
  // every authoritative reload resets the baseline with the dirty flag
  assert.match(editor, /setDirty\(false\);\s*\n\s*setBaseline\(fingerprintTemplates\(next, seeded, freshBlankItemsRef\.current\)\);/);
  // a landed save becomes the baseline (only the latest request may set it)
  const landed = editor.match(/if \(saveReqSeqRef\.current === req\) setBaseline\(savedBaseline\);/g) || [];
  assert.equal(landed.length, 3);
});

test('mutators that would write back the same value do nothing', () => {
  assert.match(editor, /if \(!tpl\.modules\.some\(\(m\) => m\.id === id && m\.name !== v\)\) \{ setModRename\(null\); return; \}/);
  assert.match(editor, /if \(tpl\?\.modules\?\.\[moduleIndex\]\?\.categories\?\.\[ci\]\?\.name === v\) return;/);
  assert.match(editor, /if \(tpl\.roster\.some\(\(r\) => r\.id === eid && r\.role === v\)\) return;/);
  assert.match(editor, /if \(tpl\.roster\.some\(\(r\) => r\.id === eid && r\.color === color\)\) return;/);
  assert.equal((editor.match(/if \(sameEntityColour\(activeData, color, opacity\)\) return;/g) || []).length, 2);
});

test('other save prompts in the app skip unchanged values', () => {
  assert.match(read('src/home/BulkModals.jsx'), /disabled=\{!trimmed \|\| unchanged\}/);
  assert.match(read('src/sidebar/SpacesPanel.jsx'), /if \(labelToSave !== editingRegionStartRef\.current\.trim\(\)\) \{/);
  assert.match(read('src/sidebar/BookmarksPanel.jsx'), /if \(!unchanged\) onBookmarkUpdate\?\.\(item\.id, result\.updates\);/);
  assert.match(read('src/components/AccountSettings.jsx'), /disabled=\{loading \|\| !hasProfileChanges\}/);
});

test('one rename look: straight dotted line, no box, no radius, no gold', () => {
  const rule = hubCss.slice(hubCss.indexOf('.survey-hub input.hub-rename {'));
  const block = rule.slice(0, rule.indexOf('}'));
  assert.match(block, /border-bottom: 1px dotted transparent;/);
  assert.match(block, /border-top: 1px dotted transparent;/);
  assert.match(block, /border-radius: 0;/);
  assert.match(hubCss, /\.survey-hub input\.hub-rename:focus \{\s*background: transparent;\s*border-bottom-color: var\(--text-3\);/);
  assert.match(hubCss, /\.survey-hub input\.hub-rename:hover \{ border-bottom-color: var\(--border-strong\); \}/);
  // the rounded box + hover plate on category / entity names is gone
  assert.doesNotMatch(editorCss, /tpl-cat-name > input[^{]*\{[^}]*border-radius/);
  assert.doesNotMatch(editorCss, /tpl-cat-name > input:hover/);
  // every in-place rename field carries the shared class
  assert.equal((editor.match(/className="inline-edit cat-title hub-rename"/g) || []).length, 3);
  assert.equal((editor.match(/className="inline-edit hub-rename"/g) || []).length, 2);
  assert.equal((editor.match(/className="templates-mobile-inline-input hub-rename"/g) || []).length, 3);
  assert.match(editor, /className="templates-mobile-title-input hub-rename"/);
  const projects = read('src/home/ProjectsFolderTree.jsx');
  assert.match(projects, /className="projects-mobile-title-input hub-rename"/);
  assert.doesNotMatch(projects, /borderBottom = '1px solid var\(--gold\)'/);
});
