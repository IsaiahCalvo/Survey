import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renumberCounters,
  getCounterSeriesList,
  pickNextSeriesColor,
  COUNTER_SERIES_PALETTE,
} from '../src/utils/counterNumbering.js';

function counter(seriesId, createdAt, extras = {}) {
  return {
    fill: extras.fill || '#ef4444',
    data: {
      type: 'counter',
      seriesId,
      createdAt,
      seriesStart: extras.seriesStart,
      displayNumber: 999,
    },
  };
}

test('renumberCounters assigns display numbers by createdAt within series', () => {
  const pages = {
    1: {
      objects: [
        counter('a', 30, { seriesStart: 5 }),
        counter('a', 10, { seriesStart: 5 }),
        { data: { type: 'other' } },
      ],
    },
    2: { objects: [counter('a', 20)] },
  };
  const out = renumberCounters(pages);
  assert.equal(out, pages);
  const nums = pages['1'].objects
    .concat(pages['2'].objects)
    .filter((o) => o.data?.type === 'counter')
    .map((o) => o.data.displayNumber)
    .sort((a, b) => a - b);
  assert.deepEqual(nums, [5, 6, 7]);
  assert.equal(renumberCounters(null), null);
});

test('getCounterSeriesList orders series and skips legacy pins', () => {
  const pages = {
    1: {
      objects: [
        counter('newer', 100, { fill: '#00ff00' }),
        counter(null, 1),
        counter('older', 10, { fill: '#0000ff' }),
      ],
    },
  };
  const list = getCounterSeriesList(pages);
  assert.equal(list.length, 2);
  assert.equal(list[0].seriesId, 'older');
  assert.equal(list[0].label, 'Count 1');
  assert.equal(list[1].seriesId, 'newer');
  assert.deepEqual(getCounterSeriesList(null), []);
});

test('pickNextSeriesColor chooses first red then fills largest hue gap', () => {
  assert.equal(pickNextSeriesColor([]), '#ff0000');
  assert.match(pickNextSeriesColor(['#ef4444']), /^#[0-9a-f]{6}$/);
  assert.match(pickNextSeriesColor(['#ef4444', '#22c55e', '#3b82f6']), /^#[0-9a-f]{6}$/);
  assert.match(pickNextSeriesColor(['#fff', 'not-a-color', null]), /^#[0-9a-f]{6}$/);
  // Hue ~150 → midpoint wraps into the hh>=300 hslToHex branch.
  assert.match(pickNextSeriesColor(['#00ff80']), /^#[0-9a-f]{6}$/);
});

test('a new count always takes a colour the picker shows, never one already used', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/components/CompactColorPicker.jsx', import.meta.url), 'utf8');
  const presets = /PRESET_COLORS = Object\.freeze\(\[([^\]]+)\]/.exec(source)[1].match(/#[0-9a-fA-F]{6}/g).map((c) => c.toLowerCase());
  // The grid's 56% row, built the way CompactColorPicker builds it.
  const toPair = (v) => `0${Math.round(Math.max(0, Math.min(255, v))).toString(16)}`.slice(-2);
  const hsl = (h, s, l) => {
    const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100; const hp = h / 60; const x = c * (1 - Math.abs((hp % 2) - 1));
    const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    const m = l / 100 - c / 2; return `#${toPair((r + m) * 255)}${toPair((g + m) * 255)}${toPair((b + m) * 255)}`;
  };
  const cells = new Set([...presets, ...[0, 1, 2, 3, 4, 5, 6].map((i) => hsl(Math.round(i * 360 / 7), 85, 56))]);
  for (const hex of COUNTER_SERIES_PALETTE) assert.ok(cells.has(hex), `${hex} is not a picker cell`);
  const used = [];
  for (let i = 0; i < COUNTER_SERIES_PALETTE.length; i += 1) {
    const next = pickNextSeriesColor(used);
    assert.ok(cells.has(next), `${next} is not a picker cell`);
    assert.ok(!used.includes(next), `${next} was already used`);
    used.push(next);
  }
  assert.ok(cells.has(pickNextSeriesColor(used)));
});

test('getCounterSeriesList gives each count the start number of its earliest pin', () => {
  const pages = {
    1: { objects: [
      { type: 'circle', fill: '#f00', data: { type: 'counter', seriesId: 's', createdAt: 20, seriesStart: 1 } },
      { type: 'circle', fill: '#f00', data: { type: 'counter', seriesId: 's', createdAt: 10, seriesStart: 7 } },
      { type: 'circle', fill: '#00f', data: { type: 'counter', seriesId: 't', createdAt: 30 } },
    ] },
  };
  const list = getCounterSeriesList(pages);
  assert.equal(list.find((s) => s.seriesId === 's').start, 7);
  assert.equal(list.find((s) => s.seriesId === 't').start, 1);
});
