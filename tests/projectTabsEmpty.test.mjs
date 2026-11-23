// Project Issues, Tasks and Photos with nothing in them (KAL-652, batch 18).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const items = readFileSync(new URL('../src/projectItems/ProjectItemsPanel.jsx', import.meta.url), 'utf8');
const photos = readFileSync(new URL('../src/projectPhotos/ProjectPhotosPanel.jsx', import.meta.url), 'utf8');

test('Issues and Tasks: nothing yet hides the controls with nothing to act on', () => {
  assert.match(items, /const nothingYet = !data\.loading && listItems\.length === 0 && !archived;/);
  assert.match(items, /canEdit && !nothingYet && \(\s*<button type="button" className="btn primary hub-new-btn"/, 'one coral New, in the empty state');
  assert.match(items, /\{!nothingYet && <div className="hub-search item-search">/);
  assert.match(items, /\{!nothingYet && <div className="project-items__chips" data-item-chips>/);
});

test('Issues and Tasks: no match and no archived get the empty state with a way back', () => {
  assert.ok(!items.includes('match these filters.`}</div>'), 'the bare grey line is gone');
  assert.match(items, /secondaryLabel="Clear filters"\s*onSecondary=\{clearFilters\}/);
  assert.match(items, /line=\{`No archived \$\{k\.many\.toLowerCase\(\)\}`\}/);
});

test('Photos: no second Add photo over the empty state; the file input stays', () => {
  assert.match(photos, /\{\(!empty \|\| uploading > 0\) && \(\s*<div className="project-photos__bar">/);
  const inputAt = photos.indexOf('data-photo-input');
  assert.ok(inputAt > 0 && inputAt < photos.indexOf('<div className="project-photos__bar">'), 'the input sits outside the bar');
  assert.match(photos, /line="No photos match these filters" secondaryLabel="Clear filters"/);
});
