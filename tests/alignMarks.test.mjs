// Align and distribute picked marks (Nightly flag 'align-marks').
import test from 'node:test';
import assert from 'node:assert/strict';
import { isNoopPlan, planAlign, planDistribute, unionBox } from '../src/utils/alignMarks.js';

const box = (left, top, width, height) => ({ left, top, width, height });

test('the box around all marks', () => {
  assert.deepEqual(unionBox([box(10, 20, 30, 40), box(100, 5, 10, 10)]), box(10, 5, 100, 55));
  assert.equal(unionBox([]), null);
});

test('align lines marks up on the edges and centre lines of the group', () => {
  const boxes = [box(10, 10, 20, 20), box(50, 40, 40, 10), box(30, 100, 10, 30)];
  assert.deepEqual(planAlign(boxes, 'left'), [{ dx: 0, dy: 0 }, { dx: -40, dy: 0 }, { dx: -20, dy: 0 }]);
  assert.deepEqual(planAlign(boxes, 'right'), [{ dx: 60, dy: 0 }, { dx: 0, dy: 0 }, { dx: 50, dy: 0 }]);
  assert.deepEqual(planAlign(boxes, 'center'), [{ dx: 30, dy: 0 }, { dx: -20, dy: 0 }, { dx: 15, dy: 0 }]);
  assert.deepEqual(planAlign(boxes, 'top'), [{ dx: 0, dy: 0 }, { dx: 0, dy: -30 }, { dx: 0, dy: -90 }]);
  assert.deepEqual(planAlign(boxes, 'bottom'), [{ dx: 0, dy: 100 }, { dx: 0, dy: 80 }, { dx: 0, dy: 0 }]);
  assert.deepEqual(planAlign(boxes, 'middle'), [{ dx: 0, dy: 50 }, { dx: 0, dy: 25 }, { dx: 0, dy: -45 }]);
});

test('one mark, a bad mode or a broken box moves nothing', () => {
  assert.ok(isNoopPlan(planAlign([box(1, 2, 3, 4)], 'left')));
  assert.ok(isNoopPlan(planAlign([box(1, 2, 3, 4), box(9, 9, 1, 1)], 'diagonal')));
  const withBroken = planAlign([box(0, 0, 10, 10), { left: NaN }, box(50, 0, 10, 10)], 'left');
  assert.deepEqual(withBroken[1], { dx: 0, dy: 0 });
  assert.deepEqual(withBroken[2], { dx: -50, dy: 0 });
});

test('distribute spaces the middle marks evenly; the ends stay', () => {
  // Input order is not position order.
  const boxes = [box(100, 0, 20, 10), box(0, 0, 10, 10), box(30, 0, 10, 10)];
  const moves = planDistribute(boxes, 'horizontal');
  // Span 0..120, sizes 10+10+20=40, gap 40: middle box starts at 50.
  assert.deepEqual(moves, [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 20, dy: 0 }]);
  const v = planDistribute([box(0, 0, 10, 10), box(0, 12, 10, 10), box(0, 90, 10, 10), box(0, 40, 10, 10)], 'vertical');
  // Span 0..100, sizes 40, gap 20: tops at 0, 30, 60, 90.
  assert.deepEqual(v, [{ dx: 0, dy: 0 }, { dx: 0, dy: 18 }, { dx: 0, dy: 0 }, { dx: 0, dy: 20 }]);
  assert.ok(isNoopPlan(planDistribute([box(0, 0, 1, 1), box(5, 0, 1, 1)], 'horizontal')), 'two marks cannot be spaced');
});

test('evenly spaced marks are a no-op', () => {
  const even = [box(0, 0, 10, 10), box(20, 0, 10, 10), box(40, 0, 10, 10)];
  assert.ok(isNoopPlan(planDistribute(even, 'horizontal')));
  assert.ok(isNoopPlan(planAlign([box(0, 0, 10, 10), box(0, 50, 10, 10)], 'left')));
});

test('the mark menu folds the align items into one Align row; the flag is beta and seeded', async () => {
  const { layoutContextMenuItems } = await import('../src/utils/contextMenuLayout.js');
  const { FEATURE_FLAGS } = await import('../src/featureFlags.js');
  const { readFileSync } = await import('node:fs');
  const it = (key, disabled = false) => ({ key, label: key, disabled, onClick() {} });
  const layout = layoutContextMenuItems([
    it('duplicate'), it('cut'), it('copy'), it('paste'), it('delete'), it('lock'),
    it('alignLeft'), it('alignCenter'), it('distributeHorizontal', true),
    it('bringToFront'), it('sendToBack'),
  ]);
  assert.deepEqual(layout.rows.map((r) => r.key), ['lock', 'align', 'arrange']);
  const align = layout.rows.find((r) => r.key === 'align');
  assert.deepEqual(align.submenu.map((s) => s.key), ['alignLeft', 'alignCenter', 'distributeHorizontal']);
  assert.equal(align.disabled, false);
  assert.equal(FEATURE_FLAGS['align-marks'].stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261110101000_align_marks_flag.sql', import.meta.url), 'utf8');
  assert.match(sql, /'align-marks', 'off'/);
});
