// The new-Survey-Marker card (owner 2026-10-22): it opens beside the marker
// just drawn, never on top of it, and the marker always has an entity.
import assert from 'node:assert/strict';
import test from 'node:test';
import { placeSurveyMarkerCard } from '../src/survey/markerPlacementCard.js';
import { resolveNextSurveyEntity } from '../src/survey/nextSurveyEntity.js';

const viewport = { width: 1400, height: 900 };
const card = { width: 280, height: 240 };
const overlaps = (pos, rect) => !(pos.left >= rect.right || pos.left + card.width <= rect.left
  || pos.top >= rect.bottom || pos.top + card.height <= rect.top);

test('the card opens to the right of the marker when it fits', () => {
  const rect = { left: 300, top: 200, right: 500, bottom: 260 };
  assert.deepEqual(placeSurveyMarkerCard(rect, card, viewport), { left: 512, top: 200 });
});

test('a marker near the right edge gets the card on its left', () => {
  const rect = { left: 1100, top: 400, right: 1300, bottom: 460 };
  const pos = placeSurveyMarkerCard(rect, card, viewport);
  assert.equal(pos.left, 1100 - 12 - 280);
  assert.equal(overlaps(pos, rect), false);
});

test('a marker as wide as the window gets the card below it', () => {
  const rect = { left: 20, top: 100, right: 1380, bottom: 300 };
  const pos = placeSurveyMarkerCard(rect, card, viewport);
  assert.equal(pos.top, 312);
  assert.equal(overlaps(pos, rect), false);
});

test('the card stays inside the window near the bottom edge', () => {
  const rect = { left: 300, top: 820, right: 400, bottom: 880 };
  const pos = placeSurveyMarkerCard(rect, card, viewport);
  assert.equal(pos.top, 900 - 240 - 8);
});

test('no marker on screen: the card is centred', () => {
  assert.deepEqual(placeSurveyMarkerCard(null, card, viewport), { left: 560, top: 330 });
});

const entities = [{ id: 'gc', name: 'GC' }, { id: 'el', name: 'Electrical' }, { id: 'lv', name: 'Low Voltage' }];

test('the next marker uses the entity picked last', () => {
  assert.equal(resolveNextSurveyEntity(entities, null, 'el').id, 'el');
  assert.equal(resolveNextSurveyEntity(entities, 'lv', 'el').id, 'lv');
});

test('with nothing picked (or a picked entity since removed) it is the first entity', () => {
  assert.equal(resolveNextSurveyEntity(entities, null, null).id, 'gc');
  assert.equal(resolveNextSurveyEntity(entities, 'gone', null).id, 'gc');
});

test('a template with no entities has none', () => {
  assert.equal(resolveNextSurveyEntity([], 'el'), null);
  assert.equal(resolveNextSurveyEntity(undefined), null);
});
