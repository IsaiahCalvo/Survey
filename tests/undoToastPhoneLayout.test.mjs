// PR #1098 phone check: page delete, project archive and revision restore now
// run at once with an Undo toast, so on a phone that toast must size to its
// words, give Undo a 44px target, and clear an open sheet's bottom action row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/components/collab/UndoToast.css', import.meta.url), 'utf8');
const phoneStart = css.indexOf('@media screen and (max-device-width: 599px)');
const phone = css.slice(phoneStart);

test('phone media block exists', () => {
  assert.ok(phoneStart > 0);
});

test('phone Undo button is a 44px touch target', () => {
  const rule = phone.match(/\.undo-toast__action\s*\{([^}]*)\}/);
  assert.ok(rule, 'phone .undo-toast__action rule');
  assert.match(rule[1], /min-height:\s*44px/);
  assert.match(rule[1], /min-width:\s*44px/);
});

test('phone toast sizes to its words within the screen', () => {
  const rule = phone.match(/\n\s*\.undo-toast\s*\{([^}]*)\}/);
  assert.ok(rule, 'phone .undo-toast rule');
  assert.match(rule[1], /width:\s*max-content/);
  assert.match(rule[1], /max-width:\s*calc\(100vw - 32px\)/);
  assert.match(rule[1], /box-sizing:\s*border-box/);
});

test('phone toast lifts above an open sheet\'s bottom action row', () => {
  const rule = phone.match(/html\.survey-viewer-open:has\(\.mobile-pdf-sheet:not\(\.is-collapsed\)\) \.undo-toast\s*\{([^}]*)\}/);
  assert.ok(rule, 'open-sheet rule');
  assert.match(rule[1], /bottom:\s*calc\(var\(--mobile-viewer-dock-height, 62px\) \+ 64px\)/);
});
