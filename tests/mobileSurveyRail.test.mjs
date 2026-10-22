// Phone survey round (owner 2026-10-13: "We'll have to figure out a way to
// implement this into mobile as well properly, understanding what's going to
// happen if the user has a ton of templates, a ton of checklists, a ton of
// entities"). The phone tool rail takes the desktop survey bars' long-list
// rules (listDebate/DECISION.md): up to 8 discs all show, above 8 7 discs +
// "All N" opening a sheet; a short screen gives up discs (longer column
// first) instead of hiding them below the fold. An entity disc changes a
// selected marker's entity through the desktop entity bar's write. The rail's
// Survey Marker shape chip picks Rectangle / Freehand (Smart fill with a
// provider), and a freehand marker needs a real drag (gesture contract D2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SURVEY_RAIL_MIN_SLOTS,
  SURVEY_ROW_MAX_ITEMS,
  pickSurveyRowItems,
  planPhoneSurveyRail,
} from '../src/utils/surveyPickLists.js';
import {
  RAIL_COLUMN_EXTRA,
  RAIL_COLUMN_SEPARATOR,
  RAIL_DISC_PITCH,
  railDiscSlots,
} from '../src/mobile/mobileSurveyRailFit.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const list = (n) => Array.from({ length: n }, (_, i) => ({ id: `x${i + 1}` }));
const drawn = (count, max) => pickSurveyRowItems(list(count), { max }).shown.length + (count > max ? 1 : 0);

test('not measured yet: the plain count rule (8)', () => {
  assert.deepEqual(planPhoneSurveyRail({ categoryCount: 40, entityCount: 40, slots: null }), { categoryMax: 8, entityMax: 8 });
});

test('room for everything: every disc (3 + 3) and 7 + All above 8 (9, 40)', () => {
  assert.deepEqual(planPhoneSurveyRail({ categoryCount: 3, entityCount: 3, slots: 13 }), { categoryMax: 8, entityMax: 8 });
  for (const n of [9, 40]) {
    const plan = planPhoneSurveyRail({ categoryCount: n, entityCount: n, slots: 30 });
    assert.equal(plan.categoryMax, SURVEY_ROW_MAX_ITEMS);
    assert.equal(drawn(n, plan.categoryMax), 8, '7 discs + All');
  }
});

test('a short rail: the columns never draw more discs than fit, longer column gives first', () => {
  for (const slots of [4, 6, 9, 11, 12, 13, 16]) {
    for (const [c, e] of [[3, 3], [8, 8], [9, 9], [40, 40], [2, 40], [40, 2], [8, 0], [0, 9]]) {
      const plan = planPhoneSurveyRail({ categoryCount: c, entityCount: e, slots });
      const total = drawn(c, plan.categoryMax) + drawn(e, plan.entityMax);
      const floor = Math.min(c, SURVEY_RAIL_MIN_SLOTS) + Math.min(e, SURVEY_RAIL_MIN_SLOTS);
      assert.ok(total <= Math.max(slots, floor), `${c}/${e} in ${slots}: ${total} discs`);
      // nothing is lost: every item is a disc or behind "All N"
      if (c > 0) assert.ok(drawn(c, plan.categoryMax) >= Math.min(c, 2));
    }
  }
  // 390 x 844 with the shape chip: 11 slots -> 5 + All | 4 + All
  assert.deepEqual(planPhoneSurveyRail({ categoryCount: 40, entityCount: 40, slots: 11 }), { categoryMax: 6, entityMax: 5 });
  // a short column keeps every disc; the long one gives
  assert.deepEqual(planPhoneSurveyRail({ categoryCount: 3, entityCount: 40, slots: 9 }), { categoryMax: 8, entityMax: 6 });
  // never below 3 slots (2 discs + All): the rail scrolls instead (owner 2026-10-01)
  assert.deepEqual(planPhoneSurveyRail({ categoryCount: 40, entityCount: 40, slots: 2 }), { categoryMax: 3, entityMax: 3 });
});

test('slot math matches the rail CSS tokens', () => {
  const css = read('../src/mobile/mobilePdfViewer.css');
  const token = (name) => Number(css.match(new RegExp(`${name}:\\s*(\\d+)px`))[1]);
  assert.equal(RAIL_DISC_PITCH, token('--mobile-rail-disc') + token('--mobile-rail-sub-gap'));
  assert.equal(RAIL_COLUMN_EXTRA, 2 * 3 + 2 - token('--mobile-rail-sub-gap'));
  assert.equal(RAIL_COLUMN_SEPARATOR, 2 * token('--mobile-rail-gap') + 1 + 2 * 3);
  // 3 + 3 discs measured on the phone: column 88px each, 17px apart
  assert.equal(3 * RAIL_DISC_PITCH + RAIL_COLUMN_EXTRA, 88);
  assert.equal(railDiscSlots(2 * 88 + 17), 6);
  assert.equal(railDiscSlots(88, { bothColumns: false }), 3);
  assert.equal(railDiscSlots(Number.NaN), null);
});

test('rail wiring: columns, All sheet, shape chip; same tap rules as before', () => {
  const chrome = read('../src/mobile/MobilePdfViewerChrome.jsx');
  const rail = read('../src/mobile/MobileSurveyRail.jsx');
  assert.match(chrome, /<MobileMarkerShapeChip /);
  assert.match(chrome, /<MobileSurveyCategoryColumn[\s\S]{0,200}max=\{surveyPlan\.categoryMax\}/);
  assert.match(chrome, /<MobileSurveyEntityColumn[\s\S]{0,200}max=\{surveyPlan\.entityMax\}/);
  assert.match(chrome, /<MobileSurveyAllSheet/);
  assert.match(chrome, /planPhoneSurveyRail\(/);
  // The All sheet: the shared phone sheet motion + the desktop's list, 44px variant.
  assert.match(rail, /useMobileSheetMotion\(onClose, \{ open, expandable: true \}\)/);
  assert.match(rail, /<SurveyPickList[\s\S]{0,60}variant="sheet"/);
  // Recents share the desktop keys.
  assert.match(rail, /useSurveyRecents\('category', toolbar\?\.templateId/);
  assert.match(rail, /useSurveyRecents\('entity', toolbar\?\.templateId/);
  assert.match(rail, /useSurveyRecents\('template', 'all'/);
  // From 15 templates the strip's template menu opens the list sheet.
  assert.match(chrome, /\(survey\.templates \|\| \[\]\)\.length >= SURVEY_LIST_SEARCH_FROM/);
});

test('entity disc with a selected marker: the entity bar write, next marker too', () => {
  const rail = read('../src/mobile/MobileSurveyRail.jsx');
  assert.match(rail, /if \(markerIds\.length\) \{\s*toolbar\?\.onApplyEntity\?\.\(entity\.id, markerIds\);\s*return;/);
  const viewer = read('../src/PDFViewer.jsx');
  assert.match(viewer, /const handleMobileSurveyEntityApply = useCallback\(\(entityId, markerIds = \[\]\) => \{\s*setMobileSurveyEntityId\(entityId \|\| null\);\s*handleSurveyEntityBarPick\(entityId, markerIds\);/);
  assert.match(viewer, /onApplyEntity: handleMobileSurveyEntityApply,/);
  // A category from another module keeps the entity (as the desktop chips do).
  assert.match(viewer, /const handleMobileSurveyCategoryPick = useCallback\(\(categoryId, moduleId\) => \{\s*if \(moduleId\) setSelectedModuleId\(moduleId\);\s*setSelectedCategoryId\(categoryId \|\| null\);/);
  const bar = read('../src/components/SurveyEntityBar.jsx');
  assert.match(bar, /export function useSelectedSurveyMarkerIds\(\)/);
});

test('marker shape on the phone: the chip is the picker, a finger needs a real drag for freehand', () => {
  const rail = read('../src/mobile/MobileSurveyRail.jsx');
  assert.match(rail, /setMarkerModeToolsShown\(true\);\s*return \(\) => setMarkerModeToolsShown\(false\);/);
  assert.match(rail, /provider\.id === 'smartFill'/);
  const svg = read('../src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /tool: 'survey-marker-freehand', gestureId, pointerId: e\.pointerId, tick: 0, pressFallback,\s*startClient: \{ x: e\.clientX, y: e\.clientY \}, pointerType: e\.pointerType, passed: false,/);
  assert.match(svg, /draft\.passed === false && draft\.startClient\s*&& hasPassedShapeDragThreshold\(draft\.startClient/);
  // A finger tap places nothing; a mouse click or pen tap places a dot (2026-10-22).
  assert.match(svg, /const tapped = state\.passed === false;/);
  assert.match(svg, /const markerBounds = tapped\s*\? \(tapPicks \|\| state\.pointerType === 'touch'\s*\? null\s*: buildDotMarkerBounds\(/);
});

test('phone Survey sheet template list: Recent from 15 templates', () => {
  const rail = read('../src/SurveySpacesRail.jsx');
  assert.match(rail, /surveyTemplateSections\(availableSurveyTemplates, recentTemplateIds\)/);
  assert.match(rail, /const recentTemplateIds = useSurveyRecents\('template', 'all', selectedTemplate\?\.id \?\? null\);/);
});

test('the tab-strip dialog host never takes page height (phone frame)', () => {
  // hub.css pins every #root child to 100% height on a phone; an in-flow
  // dialog host pushed the whole viewer one screen down (2026-10-13).
  const shell = read('../src/AppShell.jsx');
  assert.match(shell, /<div data-tab-strip-dialogs="" style=\{\{ position: 'absolute', top: 0, left: 0, width: 0, zIndex: 6500 \}\}>/);
});
