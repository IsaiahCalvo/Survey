// Owner 2026-10-06: "When I'm in select mode, if nothing is selected, I
// shouldn't be able to copy, move, duplicate, share, or even delete anything.
// Those icons need to be visibly disabled ... That goes for all types of
// buttons." The enable rules (src/utils/disabledActions.js) and the ONE
// disabled look (src/styles/states.css section 6, --disabled-ink).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  selectModeActionState,
  selectAllState,
  needsState,
  zOrderMenuState,
  pageHasTransform,
} from '../src/utils/disabledActions.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('select-mode actions are off with nothing picked and say what is missing', () => {
  for (const [key, label] of [['duplicate', 'Duplicate'], ['move', 'Move'], ['copy', 'Copy'], ['share', 'Share'], ['delete', 'Delete']]) {
    const off = selectModeActionState(key, label, { count: 0 });
    assert.equal(off.enabled, false, key);
    assert.equal(off.tooltip, `Select something to ${key}`);
    assert.doesNotMatch(off.tooltip, new RegExp(`^${label}$`), 'a disabled tooltip never names the action as if it would run');
    const on = selectModeActionState(key, label, { count: 1 });
    assert.deepEqual(on, { enabled: true, tooltip: label });
  }
});

test('an action the selection does not support stays off, with its reason', () => {
  assert.deepEqual(
    selectModeActionState('share', 'Share', { count: 3, can: 'Share one project at a time' }),
    { enabled: false, tooltip: 'Share one project at a time' },
  );
  assert.deepEqual(selectModeActionState('move', 'Move', { count: 2, can: false }), { enabled: false, tooltip: "Can't move this selection" });
  assert.equal(selectModeActionState('share', 'Share', { count: 1, can: true }).enabled, true);
  // Nothing picked wins over a reason: the first thing to do is pick something.
  assert.equal(selectModeActionState('move', 'Move', { count: 0, can: 'Not available yet' }).tooltip, 'Select something to move');
});

test('"All" stays enabled whenever there is anything to pick', () => {
  assert.deepEqual(selectAllState({ total: 5 }), { enabled: true, tooltip: 'Select all' });
  assert.deepEqual(selectAllState({ total: 5, allSelected: true }), { enabled: true, tooltip: 'Select none' });
  assert.deepEqual(selectAllState({}), { enabled: true, tooltip: 'Select all' }, 'a caller that does not say keeps it on');
  assert.deepEqual(selectAllState({ total: 0 }), { enabled: false, tooltip: 'Nothing to select' });
});

test('needsState: label when it can act, reason when it cannot', () => {
  assert.deepEqual(needsState(true, 'Undo', 'Nothing to undo'), { enabled: true, tooltip: 'Undo' });
  assert.deepEqual(needsState(false, 'Undo', 'Nothing to undo'), { enabled: false, tooltip: 'Nothing to undo' });
});

test('z-order items: nothing to bring forward on the top mark, nothing to send back on the bottom one', () => {
  assert.deepEqual(zOrderMenuState({ index: 4, length: 5 }), { front: false, forward: false, backward: true, back: true });
  assert.deepEqual(zOrderMenuState({ index: 0, length: 5 }), { front: true, forward: true, backward: false, back: false });
  assert.deepEqual(zOrderMenuState({ index: 0, length: 1 }), { front: false, forward: false, backward: false, back: false });
  // Forward / backward step past the next OVERLAPPING mark; with none they do nothing.
  assert.deepEqual(zOrderMenuState({ index: 2, length: 5, overlapAbove: false, overlapBelow: true }), { front: true, forward: false, backward: true, back: true });
  // Unknown geometry keeps them on.
  assert.equal(zOrderMenuState({ index: 2, length: 5 }).forward, true);
  // Survey Markers share the stack through another planner: every item stays on.
  assert.deepEqual(zOrderMenuState({ index: 4, length: 5, hasMarkers: true }), { front: true, forward: true, backward: true, back: true });
});

test('page Reset is on only for a page with a mirror or a turn', () => {
  assert.equal(pageHasTransform(undefined), false);
  assert.equal(pageHasTransform({ rotation: 0, mirrorH: false, mirrorV: false }), false);
  assert.equal(pageHasTransform({ rotation: 90, baseRotation: 90 }), false, 'the rotation it was opened with is not a change');
  assert.equal(pageHasTransform({ rotation: 180, baseRotation: 90 }), true);
  assert.equal(pageHasTransform({ mirrorH: true }), true);
  assert.equal(pageHasTransform({ rotation: 360 }), false);
});

test('ONE disabled look: a --disabled-ink token, applied once to every button family', () => {
  const tokens = read('src/styles/tokens.css');
  assert.match(tokens, /--disabled-ink:\s*rgba\(183, 190, 201, 0\.36\);/, 'the normal --text-2 ink at 36%');
  const states = read('src/styles/states.css');
  const section = states.slice(states.indexOf('6. DISABLED'), states.indexOf('DRAG LIFT'));
  assert.ok(section.length > 100, 'states.css has the DISABLED section');
  for (const family of ["button", "[role='button']", "[role='menuitem']", "[role='tab']", "[role='option']"]) {
    assert.ok(section.includes(family), `section 6 covers ${family}`);
  }
  assert.match(section, /:is\(:disabled, \[aria-disabled='true'\]\) \{\s*color: var\(--disabled-ink\) !important;\s*cursor: not-allowed !important;/);
  assert.match(section, /\* \{\s*color: inherit !important;/, 'words and glyphs inside follow the ink');
  assert.match(section, /stroke: currentColor !important;/, 'theme-inked strokes follow the ink');
  assert.doesNotMatch(section, /opacity/i, 'never an element opacity');
});

test('the section icon button has no disabled colour of its own to be out-ranked', () => {
  const css = read('src/components/SectionIconButton.css');
  assert.doesNotMatch(css, /:disabled[^{]*\{[^}]*color:/, 'its off look comes only from states.css');
  const hub = read('src/home/hub.css');
  assert.doesNotMatch(hub, /section-icon-btn[^{]*:disabled/, 'no hub override for its off look');
});

test('select-mode buttons and Select toggles use the shared rules', () => {
  const src = read('src/components/SectionIconButton.jsx');
  assert.match(src, /selectModeActionState\(key, label, \{ count, can: can\[key\] \}\)/);
  assert.match(src, /disabled=\{!state\.enabled\}/);
  assert.match(src, /onClick=\{\(\) => \{ if \(state\.enabled\) handlers\[handler\]\(\); \}\}/, 'a disabled action never runs its handler');
  assert.match(src, /nothingToSelect/);
  // Projects and templates share ONE item at a time.
  assert.match(read('src/home/ProjectsFolderTree.jsx'), /can=\{\{ share: selCount > 1 \? 'Share one project at a time' : true \}\}/);
  assert.match(read('src/home/TemplatesEditor.jsx'), /can=\{\{ share: visibleSelCount > 1 \? 'Share one template at a time' : true \}\}/);
});
