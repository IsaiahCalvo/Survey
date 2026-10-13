import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renumberCounters,
  getCounterSeriesList,
  pickNextSeriesColor,
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
  assert.equal(pickNextSeriesColor([]), '#d92626');
  assert.match(pickNextSeriesColor(['#ef4444']), /^#[0-9a-f]{6}$/);
  assert.match(pickNextSeriesColor(['#ef4444', '#22c55e', '#3b82f6']), /^#[0-9a-f]{6}$/);
  assert.match(pickNextSeriesColor(['#fff', 'not-a-color', null]), /^#[0-9a-f]{6}$/);
  // Hue ~150 → midpoint wraps into the hh>=300 hslToHex branch.
  assert.match(pickNextSeriesColor(['#00ff80']), /^#[0-9a-f]{6}$/);
});
