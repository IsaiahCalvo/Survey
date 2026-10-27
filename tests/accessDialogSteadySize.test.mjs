// Owner 2026-10-27: windows must not jump or change size after they open.
// Document access and Manage team opened short ("Loading…"), then grew ~100px
// and jumped up (they are centred) when the people came in; a reopen of
// Document access showed the last list plus "Loading…" (57px taller) and
// shrank back. The list now keeps room for three rows, and Document access
// shows "Loading" only before this document's own rows first arrive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const css = read('home/hub.css');
const access = read('home/AccessManagementModal.jsx');
const team = read('home/ManageTeamModal.jsx');

test('the access list keeps room for three rows in both dialogs', () => {
  assert.match(css, /\.access-list \{ min-height: min\(172px, 30vh\); \}/);
  for (const [name, source] of [['Document access', access], ['Manage team', team]]) {
    const list = source.match(/<div className="slim-scroll access-list" style=\{\{([^}]*)\}\}>/);
    assert.ok(list, `${name}: the scrolling list wears access-list`);
    // An inline minHeight would beat the class.
    assert.doesNotMatch(list[1], /minHeight/, `${name}: no inline minHeight on the list`);
  }
});

test('Document access shows only rows loaded for this document, and "Loading" only before them', () => {
  assert.match(access, /const fresh = list\.documentId != null && list\.documentId === documentId;/);
  assert.match(access, /const members = fresh \? list\.members : NO_LIST\.members;/);
  assert.match(access, /const invites = fresh \? list\.invites : NO_LIST\.invites;/);
  assert.match(access, /setList\(\{\s*documentId,/);
  assert.match(access, /\{loading && !fresh && <div[^>]*>Loading collaborators…<\/div>\}/);
  assert.doesNotMatch(access, /\{loading && <div/);
  assert.doesNotMatch(access, /setMembers|setInvites|setOwnerProfile/);
});
