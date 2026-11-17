// KAL-667: the tool bar's loadout gives its last tools to a More menu instead
// of running under the right-hand buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planLoadoutOverflow } from '../src/utils/loadoutOverflow.js';

const row = (n) => Array.from({ length: n }, () => 28);

test('a row that fits keeps every tool and no More', () => {
  // 8 tools: 8*28 + 7*6 = 266
  assert.deepEqual(planLoadoutOverflow({ widths: row(8), gap: 6, room: 266, moreWidth: 28 }).hidden, []);
});

test('a row too wide hides a run at its end, leaving room for More', () => {
  const { hidden } = planLoadoutOverflow({ widths: row(18), gap: 6, room: 300, moreWidth: 28 });
  // budget 300 - 28 - 6 = 266 → 8 tools shown
  assert.deepEqual(hidden, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
});

test('the armed tool is never hidden; the last that fits before it goes instead', () => {
  const { hidden } = planLoadoutOverflow({ widths: row(18), gap: 6, room: 300, moreWidth: 28, keep: 15 });
  assert.equal(hidden.includes(15), false);
  assert.deepEqual(hidden, [7, 8, 9, 10, 11, 12, 13, 14, 16, 17]);
});

test('no room at all still shows the armed tool', () => {
  assert.deepEqual(planLoadoutOverflow({ widths: row(3), gap: 6, room: 10, moreWidth: 28, keep: 1 }).hidden, [0, 2]);
  assert.deepEqual(planLoadoutOverflow({ widths: [], gap: 6, room: 10, moreWidth: 28 }).hidden, []);
});

test('AppShell draws the More menu after the loadout host and runs the hook', () => {
  const src = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(src, /useLoadoutOverflow\(loadoutSlotEl,/);
  const host = src.indexOf('id="chrome-subtools-host"');
  const more = src.indexOf('<LoadoutOverflowMenu', host);
  assert.ok(host > 0 && more > host && more - host < 400, 'More sits right after #chrome-subtools-host');
});
