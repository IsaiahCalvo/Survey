/*
 * bookmarksPanelIntegratedList.test.mjs — source-assertion guard for the
 * 2026-09-23 owner rulings on the Bookmarks panel (desktop AND phone):
 *   - "These should not look like individual cards … look how we made
 *     documents, projects, and templates look": rows are lines in the panel
 *     with an edge-to-edge hairline, no bordered card per row, and the app's
 *     grip icon instead of a ☰ text glyph;
 *   - the gold footer bar gone and no title ("the tab already says it");
 *     the header's Add and Edit were words ("Add with a + sign on the left …
 *     Edit on the right") until the owner's 2026-10-02 ruling that section
 *     header actions are ICONS, right-aligned, Add last: [Edit] [Add];
 *   - phone rows show rename/delete only in Edit mode, like desktop.
 * No React render harness exists for BookmarksPanel, so it is read as text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../src/sidebar/BookmarksPanel.jsx', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url)), 'utf8');

const desktopRow = source.slice(source.indexOf('const BookmarkTreeRow = ('), source.indexOf('const MobileBookmarkRow = ('));
const mobileRow = source.slice(source.indexOf('const MobileBookmarkRow = ('), source.indexOf('const BookmarksPanel = ('));
const mobileBranch = source.slice(source.indexOf('if (mobileMode) {'), source.lastIndexOf('<DndContext'));
const desktopPanel = source.slice(source.lastIndexOf('<DndContext') - 4000);

test('desktop rows are divided lines, not bordered cards', () => {
  assert.match(desktopRow, /borderBottom: '1px solid var\(--border\)'/);
  assert.doesNotMatch(desktopRow, /border: '1px solid var\(--border\)'/);
  assert.match(desktopRow, /borderRadius: 0/);
});

test('both rows use the shared grip icon, never the ☰ glyph', () => {
  assert.match(desktopRow, /<Icon name="grip"/);
  assert.match(mobileRow, /<Icon name="grip"/);
  assert.doesNotMatch(desktopRow, /☰/);
  assert.doesNotMatch(mobileRow, /☰/);
});

test('a row without children keeps no empty fold-arrow gap', () => {
  assert.match(desktopRow, /\{isFolder && item\.children\?\.length \? \(/);
  assert.match(mobileRow, /\{isFolder && item\.children\?\.length \? \(/);
});

// Changed 2026-10-02 (owner: "The icons looked way better"): the header's
// words became the shared section icons, right-aligned, [Edit] then [Add].
test('desktop header is [Edit] [Add] icons at the right, no title, no gold footer bar', () => {
  const header = source.slice(source.indexOf('UX 2026-09-23 (owner, desktop Bookmarks header)'), source.indexOf('{/* Bookmarks List with Drag-and-Drop */}'));
  assert.ok(header.length > 0);
  assert.match(header, /justifyContent: 'flex-end'/);
  assert.match(header, /<SectionIconButton\s+action="edit"\s+icon="edit"[\s\S]*?tooltip=\{isEditMode \? 'Done' : 'Edit'\}[\s\S]*?<SectionIconButton\s+action="add"\s+label="Add bookmark"/);
  assert.doesNotMatch(header, /<h3/);
  assert.doesNotMatch(header, /\{isEditMode \? 'Done' : 'Edit'\}\s*<\/button>/);
  assert.doesNotMatch(desktopPanel, /Add Button at Bottom/);
});

test('phone header matches: [Edit] [Add] icons, no title; rename/delete only in Edit mode', () => {
  assert.match(mobileBranch, /<SectionIconActions phone className="mobile-bookmark-actions">\s*<SectionIconButton\s+phone\s+action="edit"[\s\S]*?label=\{isEditMode \? 'Done editing bookmarks' : 'Edit bookmarks'\}[\s\S]*?action="add"[\s\S]*?label=\{isAddOpen \? 'Cancel new bookmark' : 'Add bookmark'\}/);
  assert.doesNotMatch(mobileBranch, /mobile-bookmark-add tertiary|mobile-bookmark-edit tertiary/);
  assert.doesNotMatch(mobileBranch, /mobile-bookmark-heading/);
  assert.match(mobileRow, /\{isEditMode && \(\s*<div className="mobile-bookmark-moves">/);
});

test('phone rows are one list with edge-to-edge hairlines, no card per row', () => {
  const row = css.match(/\.mobile-bookmark-row \{[^}]*\}/)?.[0] || '';
  assert.match(row, /border-bottom: 1px solid var\(--border\);/);
  assert.doesNotMatch(row, /border-radius/);
  assert.doesNotMatch(row, /\bborder: 1px/);
  const list = css.match(/\.mobile-bookmark-list \{[^}]*\}/)?.[0] || '';
  assert.doesNotMatch(list, /gap:/);
  assert.match(list, /padding: 0 0 /);
});
