import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCounterSeriesList,
  resolveCounterSeriesPaint,
} from '../src/utils/counterNumbering.js';

test('active counter series paint carries its fill and number colors to the toolbar', () => {
  const annotationsByPage = {
    1: {
      objects: [
        {
          type: 'circle',
          fill: '#0000ff',
          data: {
            type: 'counter',
            seriesId: 'series-4',
            createdAt: 1,
            numberColor: '#ffffff',
          },
        },
      ],
    },
  };

  const seriesList = getCounterSeriesList(annotationsByPage);
  assert.equal(seriesList[0].numberColor, '#ffffff');
  assert.deepEqual(
    resolveCounterSeriesPaint(seriesList, 'series-4'),
    { fill: '#0000ff', numberColor: '#ffffff' },
  );
});

test('a fresh counter series gets renderer defaults before its first pin exists', () => {
  assert.deepEqual(
    resolveCounterSeriesPaint([], 'new-series', '#ef4444'),
    { fill: '#ef4444', numberColor: '#ffffff' },
  );
});
