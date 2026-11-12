/*
 * listContextMenu.test.mjs — owner 2026-11-12: "when I right-click on anything
 * (a space, a region), I should be able to delete it or move and copy it ...
 * That goes for all list things." And: a click on a space title must type in
 * it at once, no Edit mode first.
 *
 * Pins the pure rules (src/utils/listContextMenu.js) and the wiring in the
 * lists that had no right-click menu before (Spaces, regions, Bookmarks,
 * Layers) plus the Spaces click-to-rename.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  contextMenuPointerType,
  isTypingTarget,
  listMenuPointFrom,
  shouldOpenListMenu,
} from '../src/utils/listContextMenu.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function fakeEvent({ tagName = 'DIV', pointerType, readOnly = false, x = 40, y = 60 } = {}) {
  const target = { tagName, readOnly, isContentEditable: false };
  const calls = { prevented: 0, stopped: 0 };
  return {
    target,
    pointerType,
    clientX: x,
    clientY: y,
    preventDefault: () => { calls.prevented += 1; },
    stopPropagation: () => { calls.stopped += 1; },
    calls,
  };
}

test('a mouse right-click opens the row menu at the pointer and stops the browser menu', () => {
  const event = fakeEvent({ x: 120, y: 300 });
  assert.deepEqual(listMenuPointFrom(event, { activeElement: null }), { x: 120, y: 300 });
  assert.equal(event.calls.prevented, 1);
  assert.equal(event.calls.stopped, 1);
});

test('a held finger opens it in the desktop layout but not on the phone (drag / slide there)', () => {
  assert.equal(contextMenuPointerType(fakeEvent({ pointerType: 'touch' })), 'touch');
  assert.equal(shouldOpenListMenu(fakeEvent({ pointerType: 'touch' }), { mobileMode: false, activeElement: null }), true);
  const phone = fakeEvent({ pointerType: 'touch' });
  assert.equal(listMenuPointFrom(phone, { mobileMode: true, activeElement: null }), null);
  // No browser menu over the row on the phone either.
  assert.equal(phone.calls.prevented, 1);
  // A mouse in the phone layout (a narrow window) still gets the menu.
  assert.equal(shouldOpenListMenu(fakeEvent(), { mobileMode: true, activeElement: null }), true);
});

test('a field being typed in is left to the app text menu (cut, copy, paste), not the row menu', () => {
  const field = fakeEvent({ tagName: 'INPUT' });
  assert.equal(isTypingTarget(field, field.target), true);
  assert.equal(listMenuPointFrom(field, { activeElement: field.target }), null);
  assert.equal(field.calls.prevented, 0);
  // A name field that is not focused (or read-only) is part of the row.
  const resting = fakeEvent({ tagName: 'INPUT' });
  assert.equal(isTypingTarget(resting, null), false);
  const readOnly = fakeEvent({ tagName: 'INPUT', readOnly: true });
  assert.equal(isTypingTarget(readOnly, readOnly.target), false);
});

test('Spaces: the space name types on a click without Edit mode, and so does a region name', () => {
  const src = read('src/sidebar/SpacesPanel.jsx');
  assert.match(src, /readOnly=\{!canManageSpaces\}/);
  assert.doesNotMatch(src, /readOnly=\{!editMode\}/);
  assert.doesNotMatch(src, /if \(editMode\) handleRegionEditClick/);
  assert.match(src, /handleRegionEditClick\(page\.pageId, regionLabel\);/);
  // A new space no longer turns Edit mode on just to name it.
  assert.doesNotMatch(src, /setEditMode\(true\);\s*setNameToFocus/);
});

test('Spaces: spaces and regions open the shared menu with the Edit-mode actions', () => {
  const src = read('src/sidebar/SpacesPanel.jsx');
  assert.match(src, /import ListItemContextMenu from '..\/components\/ListItemContextMenu.jsx'/);
  assert.match(src, /setRowMenu\(\{ kind: 'space'/);
  assert.match(src, /setRowMenu\(\{ kind: 'region'/);
  for (const label of ["'Rename'", "'Add pages'", "'Delete'", "'Move or copy'", "'Remove'"]) {
    assert.ok(src.includes(`label: ${label}`), `Spaces menu has ${label}`);
  }
});

test('Bookmarks, Layers and the Survey panel use the same menu and rules', () => {
  for (const path of ['src/sidebar/BookmarksPanel.jsx', 'src/sidebar/LayersPanel.jsx', 'src/SurveySpacesRail.jsx']) {
    const src = read(path);
    assert.match(src, /ListItemContextMenu/, `${path} draws the shared menu`);
    assert.match(src, /listMenuPointFrom\(/, `${path} uses the shared open rule`);
    assert.match(src, /label: 'Rename'/, `${path} offers Rename`);
  }
});
