// Survey pins (Nightly 'survey-mode-tools', owner 2026-11-23): Survey mode's
// pinned tools bar holds the marker kinds and the template's entities,
// modules and categories (src/pinnedTools/surveyPins.js), and Survey mode
// shows a chip in the tool bar to see and leave it (SurveyModeChip.jsx).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  armSurveyPin,
  choiceIsPinned,
  matchSurveyPinChoices,
  surveyPinChoices,
  surveyPinDescription,
  surveyPinStatus,
} from '../src/pinnedTools/surveyPins.js';
import { createPinnedToolsStore, makePin, pinDescription, pinFaceColor, sanitizePinnedToolsState } from '../src/pinnedTools/pinnedTools.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const memory = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
};

function toolbar(overrides = {}) {
  const calls = [];
  return {
    calls,
    templateId: 't1',
    templateName: 'Security walk',
    modules: [
      { id: 'm-sec', name: 'Security', categories: [{ id: 'c-cam', name: 'Camera' }, { id: 'c-rdr', name: 'Card Reader' }] },
      { id: 'm-net', name: 'Network', categories: [{ id: 'c-ap', name: 'Access Point' }] },
    ],
    entities: [{ id: 'e-gc', name: 'GC', color: '#E53935' }, { id: 'e-el', name: 'Electrical', color: '#43A047' }],
    selectedModuleId: 'm-sec',
    selectedCategoryId: 'c-cam',
    selectedEntityId: 'e-gc',
    onArmMarker: () => calls.push(['arm']),
    onSelectEntity: (id) => calls.push(['entity', id]),
    onSelectModule: (id) => calls.push(['module', id]),
    onPickCategory: (id, moduleId) => calls.push(['category', id, moduleId]),
    ...overrides,
  };
}

test('the flag is a Nightly beta', () => {
  assert.equal(FEATURE_FLAGS['survey-mode-tools'].stage, 'beta');
});

test('survey pins keep what they name, and drop a pin that names nothing', () => {
  const cat = makePin('survey-category', { strokeColor: '#ff0000' }, 'p1', { categoryId: 'c-cam', moduleId: 'm-sec', name: 'Camera', junk: 1 });
  assert.deepEqual(cat, { id: 'p1', kind: 'survey-category', style: {}, ref: { name: 'Camera', categoryId: 'c-cam', moduleId: 'm-sec' } });
  assert.equal(makePin('survey-entity', {}, 'p2', { name: 'GC' }), null, 'an entity pin needs its entity');
  assert.deepEqual(makePin('survey-rect', { strokeWidth: 4 }, 'p3'), { id: 'p3', kind: 'survey-rect', style: {} });
  const entity = makePin('survey-entity', {}, 'p4', { entityId: 'e-gc', name: 'GC', color: '#E53935' });
  assert.equal(pinFaceColor(entity), '#e53935');
  assert.equal(pinDescription(entity), 'GC (entity)');
  assert.equal(surveyPinDescription(makePin('survey-freehand', {})), 'Freehand marker');

  const state = sanitizePinnedToolsState({ surveyPins: [cat, { id: 'bad', kind: 'survey-module', style: {}, ref: {} }, { id: 'x', kind: 'survey-smartfill' }] });
  assert.deepEqual(state.surveyPins.map((pin) => pin.id), ['p1', 'x']);
});

test('a marker pin arms the Survey Marker tool in its drawing way', () => {
  const bar = toolbar();
  const modes = [];
  assert.equal(armSurveyPin(makePin('survey-freehand', {}), bar, { setDrawMode: (mode) => modes.push(mode) }), true);
  assert.deepEqual(modes, ['freehand']);
  assert.deepEqual(bar.calls, [['arm']]);
  assert.equal(surveyPinStatus(makePin('survey-freehand', {}), { toolbar: bar, activeTool: 'survey-marker', shownMode: 'freehand' }).pressed, true);
  assert.equal(surveyPinStatus(makePin('survey-freehand', {}), { toolbar: bar, activeTool: 'pen', shownMode: 'freehand' }).pressed, false);
  // Smart fill only where its provider is there.
  const smart = makePin('survey-smartfill', {});
  assert.equal(surveyPinStatus(smart, { toolbar: bar }).available, false);
  assert.equal(armSurveyPin(smart, bar, { setDrawMode: () => assert.fail('no provider') }), false);
  assert.equal(surveyPinStatus(smart, { toolbar: bar, smartFillReady: true }).available, true);
});

test('entity, module and category pins pick through the survey bar handlers', () => {
  const bar = toolbar();
  armSurveyPin(makePin('survey-entity', {}, 'e', { entityId: 'e-el', name: 'Electrical' }), bar);
  armSurveyPin(makePin('survey-category', {}, 'c', { categoryId: 'c-ap', moduleId: 'stale', name: 'Access Point' }), bar);
  // A module pin picks its first category and keeps the entity, as the
  // desktop module menu does.
  armSurveyPin(makePin('survey-module', {}, 'm', { moduleId: 'm-net', name: 'Network' }), bar);
  assert.deepEqual(bar.calls, [['entity', 'e-el'], ['category', 'c-ap', 'm-net'], ['category', 'c-ap', 'm-net']]);

  const camera = makePin('survey-category', {}, 'c2', { categoryId: 'c-cam', name: 'Camera' });
  assert.deepEqual(surveyPinStatus(camera, { toolbar: bar, activeTool: 'survey-marker' }), { available: true, pressed: true });
  assert.deepEqual(surveyPinStatus(camera, { toolbar: bar, activeTool: 'select' }), { available: true, pressed: false });
});

test('a pin whose thing is not in the template in use is dimmed and does nothing', () => {
  const bar = toolbar();
  const gone = makePin('survey-category', {}, 'g', { categoryId: 'c-door', name: 'Door' });
  assert.deepEqual(surveyPinStatus(gone, { toolbar: bar, activeTool: 'survey-marker' }), { available: false, pressed: false });
  assert.equal(armSurveyPin(gone, bar), false);
  assert.deepEqual(bar.calls, []);
  // Outside Survey (no survey bar) nothing is usable.
  assert.equal(surveyPinStatus(makePin('survey-rect', {}), { toolbar: null }).available, false);
});

test('the Pin a tool list offers the markers, then entities, modules and categories', () => {
  const bar = toolbar();
  const choices = surveyPinChoices(bar);
  assert.deepEqual([...new Set(choices.map((choice) => choice.group))], ['Survey markers', 'Entities', 'Modules', 'Categories']);
  assert.deepEqual(choices.filter((c) => c.group === 'Survey markers').map((c) => c.label), ['Rectangle marker', 'Freehand marker']);
  assert.equal(surveyPinChoices(bar, { smartFillReady: true }).some((c) => c.kind === 'survey-smartfill'), true);
  const cam = choices.find((c) => c.key === 'survey-category:c-cam');
  assert.equal(cam.sub, 'Security');
  assert.deepEqual(matchSurveyPinChoices('card', choices).map((c) => c.label), ['Card Reader']);
  assert.deepEqual(matchSurveyPinChoices('freehand', choices).map((c) => c.kind), ['survey-freehand']);
  const pinned = [makePin(cam.kind, {}, 'p', cam.ref), makePin('survey-rect', {})];
  assert.equal(choiceIsPinned(cam, pinned), true);
  assert.equal(choiceIsPinned(choices.find((c) => c.kind === 'survey-rect'), pinned), true);
  assert.equal(choiceIsPinned(choices.find((c) => c.key === 'survey-category:c-ap'), pinned), false);
});

test('the survey set gets the marker pins once, in front, taking nothing away', () => {
  const storage = memory();
  const store = createPinnedToolsStore({ storage, key: 'k' });
  store.addPin(makePin('pen', { strokeColor: '#ff0000', strokeWidth: 2 }));
  store.seedSurveyMarkerPins();
  assert.deepEqual(store.getState().pins.map((p) => p.kind), ['pen'], 'never in the markup set');
  store.setPinSet('survey');
  store.seedSurveyMarkerPins();
  assert.deepEqual(store.getState().pins.map((p) => p.kind), ['survey-rect', 'survey-freehand', 'pen']);
  store.removePin(store.getState().pins[0].id);
  store.seedSurveyMarkerPins();
  assert.deepEqual(store.getState().pins.map((p) => p.kind), ['survey-freehand', 'pen'], 'once only');
  const again = createPinnedToolsStore({ storage, key: 'k' });
  again.setPinSet('survey');
  again.seedSurveyMarkerPins({ smartFill: true });
  assert.deepEqual(again.getState().pins.map((p) => p.kind), ['survey-freehand', 'pen'], 'remembered across reloads');
  // A browser that already had the Rectangle marker pinned does not get a second.
  const other = createPinnedToolsStore({ storage: memory(), key: 'k' });
  other.setPinSet('survey');
  other.addPin(makePin('survey-rect', {}));
  other.seedSurveyMarkerPins({ smartFill: true });
  assert.deepEqual(other.getState().pins.map((p) => p.kind), ['survey-freehand', 'survey-smartfill', 'survey-rect']);
});

test('Survey mode chip: in the Undo / Redo block, behind the flag; the survey bar drops Done under it', () => {
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /isFeatureOn\('survey-mode-tools'\)/);
  const undoBlock = shell.slice(shell.indexOf('data-undo-redo-controls="true"'), shell.indexOf('data-tool-toolbar="true"'));
  assert.match(undoBlock, /<SurveyModeChip/);
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /\(!surveyModeToolsOn \|\| mobileMode\) && \(\s*<button\s+type="button"\s+className="survey-subrow__done"/);
  assert.match(viewer, /onLeaveSurvey: handleLeaveSurvey/);
  const chip = readFileSync(new URL('../src/components/SurveyModeChip.jsx', import.meta.url), 'utf8');
  assert.match(chip, /aria-label="Exit Survey mode"/);
});
