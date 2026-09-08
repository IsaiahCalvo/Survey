import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/documentAnnotationService.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('export async function countSurveyMarkersReferencingChecklistItem('), source.indexOf('/**\n * Delete multiple annotations'));

function countWith(result) {
  const calls = [];
  const supabase = { from(table) {
    calls.push(['from', table]);
    const query = {
      select(...args) { calls.push(['select', ...args]); return query; },
      in(...args) { calls.push(['in', ...args]); return query; },
      not(...args) { calls.push(['not', ...args]); return query; },
      filter(...args) { calls.push(['filter', ...args]); return query; },
      limit(...args) { calls.push(['limit', ...args]); return query; },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
    return query;
  } };
  const count = new Function('supabase', 'SURVEY_MARKER_TYPE_VALUES', 'console', body.replace('export async', 'async') + '\nreturn countSurveyMarkersReferencingChecklistItem;')(supabase, ['survey-marker', 'surveyMarker'], { warn() {} });
  return { count, calls };
}

test('failed checklist usage reads reject without downloading annotation JSON', async () => {
  const error = new Error('offline');
  const h = countWith({ error });
  await assert.rejects(h.count('item-a'), error);
  assert.equal(h.calls.filter(c => c[0] === 'from').length, 1);
  assert.deepEqual(h.calls.find(c => c[0] === 'select'), ['select', 'annotation_id', { count: 'exact', head: true }]);
});

test('only a complete nonnegative count can authorize a delete decision', async () => {
  for (const count of [undefined, null, '0', -1, NaN, Infinity, 0.5]) {
    await assert.rejects(countWith({ count, error: null }).count('item-a'));
  }
  assert.equal(await countWith({ count: 0 }).count('item-a'), 0);
  assert.equal(await countWith({ count: 7 }).count('item-a'), 7);
});

test('checks key presence across documents and rejects unsafe JSON path ids', async () => {
  const h = countWith({ count: 4 });
  assert.equal(await h.count('item-a'), 4);
  assert.ok(h.calls.some(c => JSON.stringify(c) === JSON.stringify(['not', 'annotation_data->checklistResponses->item-a', 'is', null])));
  assert.ok(!h.calls.some(c => c.includes('document_id')));
  for (const id of ['', null, 'a->b', 'a,b', 'a.b', 'a"b', '0', '-1']) await assert.rejects(h.count(id));
});

test('Dashboard preserves an unknown signed-in usage check instead of returning zero', async () => {
  const dashboard = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  const start = dashboard.indexOf('  const hubGetChecklistItemUsageCount =');
  const end = dashboard.indexOf('  }, [user]);', start) + '  }, [user]);'.length;
  assert.ok(start > 0 && end > start);
  const getCount = new Function('useCallback', 'user', 'countSurveyMarkersReferencingChecklistItem', dashboard.slice(start, end) + '\nreturn hubGetChecklistItemUsageCount;')(fn => fn, { id: 'actor-a' }, async () => { throw new Error('offline'); });
  await assert.rejects(getCount('item-a'), /offline/);
});
