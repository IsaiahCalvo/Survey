// Round 5 audit (2026-11-10): on the phone, "Add bookmark" opened with an
// empty Page field and Enter did nothing, so a bookmark needed a typed page
// number and a reach for the small Create button. Desktop has a "current
// page" button; the phone line now opens on the page you are looking at and
// Enter in either field creates the bookmark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/sidebar/BookmarksPanel.jsx', import.meta.url), 'utf8');
const start = src.indexOf('<div className="mobile-bookmark-editor" aria-label="New bookmark">');
const editor = src.slice(start, src.indexOf('</div>', start));

test('the phone bookmark line creates on Enter from the name and the page field', () => {
  assert.ok(start > 0, 'phone bookmark editor found');
  const enters = editor.match(/if \(event\.key === 'Enter'\) handleCreateBookmark\(\);/g) || [];
  assert.equal(enters.length, 2);
});

test('opening the phone bookmark line fills in the current page', () => {
  const add = src.slice(src.indexOf("label={isAddOpen ? 'Cancel new bookmark' : 'Add bookmark'}"));
  const click = add.slice(0, add.indexOf('/>'));
  assert.match(click, /if \(next && pageNum > 0\)/);
  assert.match(click, /const autoPage = String\(numPages \? Math\.min\(pageNum, numPages\) : pageNum\);/);
  assert.match(click, /setNewBookmarkPages\(autoPage\)/);
});

test('a line holding only the filled-in page is not kept when the sheet closes', async () => {
  assert.match(src, /const onlyAutoPage = !newBookmarkName && newBookmarkPages === autoBookmarkPagesRef\.current;/);
  assert.match(src, /newBookmarkPages: onlyAutoPage \? '' : newBookmarkPages/);
  const { readMobileBookmarkDraft, writeMobileBookmarkDraft } = await import('../src/sidebar/bookmarkDrafts.js');
  // What the panel writes for an untouched line: no name, page blanked.
  writeMobileBookmarkDraft('doc-auto', { showCreateMenu: true, newBookmarkName: '', newBookmarkPages: '' });
  assert.equal(readMobileBookmarkDraft('doc-auto'), null);
  // A typed name still keeps the line, with its page.
  writeMobileBookmarkDraft('doc-auto', { showCreateMenu: true, newBookmarkName: 'Door', newBookmarkPages: '7' });
  assert.equal(readMobileBookmarkDraft('doc-auto')?.newBookmarkPages, '7');
});
