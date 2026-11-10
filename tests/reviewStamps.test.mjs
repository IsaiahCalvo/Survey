// Ready-made review stamps (Nightly flag 'review-stamps', Drawboard Projects
// round 2): twelve bordered text boxes that fill in name and date when placed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { planLibraryPlacement, sanitizeLibraryPayload } from '../src/markLibrary/markLibraryModel.js';
import { REVIEW_STAMPS, isReviewStampItem, reviewStampItems, reviewStampPreviewItem } from '../src/markLibrary/reviewStamps.js';

test('twelve stamps, each one bordered bold centred text in its colour', () => {
  const items = reviewStampItems();
  assert.equal(items.length, 12);
  assert.equal(new Set(items.map((i) => i.id)).size, 12);
  for (const item of items) {
    assert.ok(isReviewStampItem(item));
    assert.ok(sanitizeLibraryPayload(item.payload), `${item.name} payload is a valid library payload`);
    const [entry] = item.payload.items;
    const o = entry.object;
    assert.equal(o.type.toLowerCase(), 'textbox');
    assert.equal(o.fontWeight, 'bold');
    assert.equal(o.textAlign, 'center');
    assert.equal(o.stroke, item.color);
    assert.equal(o.fill, item.color);
    assert.ok(o.strokeWidth > 0);
    assert.ok(o.width > 150 && o.height > 30);
    assert.match(o.text, /^[A-Z -]+\n\{\{author\.name\}\} · \{\{date\}\}$/);
    assert.deepEqual(item.payload.extent, { left: 0, top: 0, width: o.width, height: o.height });
  }
  assert.deepEqual(REVIEW_STAMPS.map((s) => s.label).slice(0, 4), ['Approved', 'For review', 'Revise and resubmit', 'Rejected']);
});

test('placing one fills in the placer and the date, centred on the click', () => {
  const approved = reviewStampItems()[0];
  const plan = planLibraryPlacement(approved.payload, {
    point: { x: 300, y: 400 },
    pageWidth: 612,
    pageHeight: 792,
    pageNumber: 2,
    tokens: { authorName: 'Olive Owner', now: new Date(2026, 10, 10, 9, 0) },
  });
  const object = plan.clipboard.items[0].object;
  assert.equal(object.text, 'APPROVED\nOlive Owner · Nov 10, 2026');
  assert.ok(Math.abs(plan.dx + object.width / 2 - 300) < 1e-9);
  // The built-in payload itself is left alone.
  assert.match(approved.payload.items[0].object.text, /\{\{author\.name\}\}/);
});

test('the card pictures the filled-in stamp', () => {
  const item = reviewStampItems()[3];
  const preview = reviewStampPreviewItem(item, { now: new Date(2026, 0, 2) });
  assert.equal(preview.payload.items[0].object.text, 'REJECTED\nYour name · Jan 2, 2026');
  assert.notEqual(preview.id, item.id);
});

test('flag is beta with a migration row', () => {
  assert.equal(FEATURE_FLAGS['review-stamps'].stage, 'beta');
  const migration = fs.readFileSync('supabase/migrations/20261110130000_review_stamps_flag.sql', 'utf8');
  assert.match(migration, /'review-stamps', 'off'/);
});
