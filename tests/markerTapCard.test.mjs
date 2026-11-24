// Nightly 'marker-tap-card' (owner 2026-11-24): a tap on a Survey Marker shows
// its Category, Tag and checklist items in place of Comment / Duplicate /
// Delete, and Expand opens the Survey panel on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markerCategory, markerTapCardModel } from '../src/survey/markerTapCard.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// The shape of the owner's own Security template (two Modules, both with a Camera).
const template = {
  modules: [
    { id: 'install', name: 'Installation', categories: [
      { id: 'cam-i', name: 'Camera', checklist: [
        { id: 'a', text: 'Cable Pulled' }, { id: 'b', text: 'Stub-ups' }, { id: 'c', text: 'Camera Installed' },
        { id: 'old', text: 'Retired line', archived: true },
      ] },
      { id: 'door-i', name: 'Door', checklist: [{ id: 'd', text: 'Frame Installed & Prepped' }] },
    ] },
    { id: 'comm', name: 'Commissioning', categories: [
      { id: 'cam-c', name: 'Camera', checklist: [{ id: 'e', text: "Camera IP'd" }] },
    ] },
  ],
};

test('names the Category and Tag and lists its live checklist lines with answers', () => {
  const model = markerTapCardModel({
    moduleId: 'install', categoryId: 'cam-i', name: 'C-1-01',
    checklistResponses: { a: { selection: 'Y' }, b: { selection: '' } },
  }, template);
  assert.equal(model.categoryName, 'Camera');
  assert.equal(model.tag, 'C-1-01');
  assert.deepEqual(model.lines.map((l) => [l.text, l.answer]), [['Cable Pulled', 'Y'], ['Stub-ups', null], ['Camera Installed', null]]);
  assert.equal(model.answered, 1);
});

test('finds the Category in its own Module first, then anywhere; unknown is plain words', () => {
  assert.equal(markerCategory({ moduleId: 'comm', categoryId: 'cam-c' }, template).checklist[0].text, "Camera IP'd");
  assert.equal(markerCategory({ moduleId: 'gone', categoryId: 'door-i' }, template).name, 'Door');
  const lost = markerTapCardModel({ categoryId: 'nope' }, template);
  assert.equal(lost.categoryName, 'No Category');
  assert.deepEqual(lost.lines, []);
  assert.equal(markerTapCardModel(null, template), null);
  assert.equal(markerCategory({ categoryId: 'cam-i' }, { spaces: template.modules }).name, 'Camera', 'older templates keep Modules under spaces');
});

test('a beta flag with its migration; the quick bar and viewer are wired', () => {
  assert.equal(FEATURE_FLAGS['marker-tap-card']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261124200000_marker_tap_card_flag.sql'), /\('marker-tap-card', 'off'/);
  const bar = read('src/components/SelectionQuickBar.jsx');
  assert.match(bar, /isFeatureOn\('marker-tap-card'\)/);
  assert.match(bar, /data-selection-quick-marker-card/);
  assert.match(bar, /onOpenSurveyMarker\?\.\(/);
  assert.match(read('src/AppShell.jsx'), /onOpenSurveyMarker=\{\(id\) => rightRailApi\?\.openSurveyMarker\?\.\(id\)\}/);
  assert.match(read('src/PDFViewer.jsx'), /openSurveyMarker,/);
});
