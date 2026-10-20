// Owner 2026-10-13: "When you enter survey mode and open the survey panel,
// the panel pushes the sub-toolbar out of place ... The sub-toolbar must
// remain fixed." / "The things in the center should stay in the center. The
// peripherals on the left and right, like the templates dropdown and the done
// button, those can move in and out." The survey bar's centre group (module
// menu, category chips, Reuse) is pinned to the tool bar's centre; only the
// end pieces (template menu, Done) follow the panels and give ground first
// (src/utils/responsiveToolbar.js planSurveyBar, measured by
// src/hooks/useSurveyBarFit.js). These pin the plan.
// (Was: the 2026-10-07 plan that inset the WHOLE bar by an open panel and
// re-centred it in what was left - the very shift the owner reported.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SURVEY_BAR_STEPS,
  SURVEY_BAR_PARTS,
  planSurveyBar,
  surveyBarCentreWidth,
  surveyBarLook,
  surveyRowMaxFor,
  surveyRowWidth,
} from '../src/utils/responsiveToolbar.js';

// "surveyA Template" (100px of 12px text), longest module "Existing Survey
// Data" (107px of 11px text), three 28px chips (96 on 6px gutters).
const SAMPLE = { templateText: 100, moduleText: 107, categoryCount: 3 };
// The bar spans the column between the two 48px rails; the tool bar's icons
// centre on it.
const bar = (window) => ({ barWidth: window - 96, centre: (window - 96) / 2 });
const at = (window, { left = false, right = false } = {}, sizes = SAMPLE) => planSurveyBar({
  ...bar(window), insetLeft: left ? 272 : 0, insetRight: right ? 320 : 0, ...sizes,
});
const COMBOS = [{}, { left: true }, { right: true }, { left: true, right: true }];

test('the centre gives ground in this order, and never drops the chips', () => {
  assert.deepEqual(SURVEY_BAR_STEPS, ['full', 'short-module', 'compact-reuse', 'fold', 'tight', 'fewer']);
  const looks = SURVEY_BAR_STEPS.map((step) => surveyBarLook(step));
  assert.deepEqual(looks.map((l) => l.module), ['full', 'short', 'short', 'more', 'more', 'more']);
  assert.deepEqual(looks.map((l) => l.reuse), ['full', 'full', 'compact', 'more', 'more', 'more']);
  assert.deepEqual(looks.map((l) => l.tight), [false, false, false, false, true, true]);
  assert.deepEqual(looks.map((l) => l.fewer), [false, false, false, false, false, true]);
  const widths = SURVEY_BAR_STEPS.map((step) => surveyBarCentreWidth(step, SAMPLE).centre);
  // module 149 + rule 17, chips 96, rule 17 + Reuse 67; folded, the chips alone
  // (the module menu and Reuse wait in More at the left end).
  assert.equal(widths[0], 149 + 17 + 96 + 17 + 67);
  assert.equal(widths[3], 96);
  assert.equal(widths[4], 92); // 4px gutters
  for (let i = 1; i < 5; i += 1) assert.ok(widths[i] < widths[i - 1], `${SURVEY_BAR_STEPS[i]} ${widths[i]}`);
});

test('opening or closing either side panel never changes the centre group (1440 and 1100)', () => {
  for (const window of [1440, 1280, 1100, 1024]) {
    const plans = COMBOS.map((combo) => at(window, combo));
    assert.ok(plans.every((p) => p.stable), `${window} stable`);
    assert.equal(new Set(plans.map((p) => p.step)).size, 1, `${window}: ${plans.map((p) => p.step)}`);
    assert.equal(new Set(plans.map((p) => p.centreWidth)).size, 1);
    assert.ok(plans.every((p) => p.rowMax === 8 && p.entityRowMax === 8));
  }
  assert.equal(at(1440).step, 'full');
  assert.equal(at(1100).step, 'compact-reuse');
  assert.equal(at(1024).step, 'fold');
});

test('the end pieces move with the panels and give ground first', () => {
  // 1440: everything at full size whatever is open.
  for (const combo of COMBOS) {
    const p = at(1440, combo);
    assert.equal(p.template, 'full');
    assert.equal(p.done, 'word');
  }
  // The template's room shrinks by exactly the left panel; the centre does not move.
  assert.equal(at(1440).templateRoom, SURVEY_BAR_PARTS.templateMax);
  assert.equal(at(1440, { left: true }).templateRoom, Math.floor(672 - 346 / 2 - 8 - 8 - 272));
  // 1100 with both panels: Done becomes its check, the name ellipsises.
  const both = at(1100, { left: true, right: true });
  assert.equal(both.done, 'glyph');
  assert.equal(both.template, 'full');
  assert.ok(both.templateRoom < SURVEY_BAR_PARTS.templateChrome + SAMPLE.templateText);
});

test('nothing overlaps or runs under a panel, at any width and panel state', () => {
  const P = SURVEY_BAR_PARTS;
  for (let window = 721; window <= 2200; window += 13) {
    for (const combo of COMBOS) {
      const p = at(window, combo);
      const { barWidth, centre } = bar(window);
      const l = combo.left ? 272 : 0;
      const r = combo.right ? 320 : 0;
      const half = p.centreWidth / 2;
      // No room even for "All N" alone beside the open panels (under ~800px).
      if (p.step === 'fewer' && p.rowMax === 1 && p.centreWidth + P.slack > 2 * Math.min(
        centre - l - P.inset - P.templateGlyph - P.moreGap - P.more - P.gap,
        barWidth - r - P.inset - P.doneGlyph - P.gap - centre,
      )) continue;
      // The centre stays inside the visible span, clear of the end pieces' smallest looks.
      const startMin = P.templateGlyph + (surveyBarLook(p.step).more ? P.moreGap + P.more : 0);
      assert.ok(centre - half >= l + P.inset + startMin + P.gap - 0.5, `${window} ${JSON.stringify(combo)} left`);
      assert.ok(centre + half <= barWidth - r - P.inset - P.doneGlyph - P.gap + 0.5, `${window} ${JSON.stringify(combo)} right`);
      if (p.done === 'word') assert.ok(centre + half + P.gap + P.done <= barWidth - r - P.inset + 0.5);
    }
  }
});

test('long rows: 7 chips and "All N" fit at 1100 with both panels open, never a hidden scroll', () => {
  // The count rule's widest row: 7 chips + "All 40" (45px) on 6px gutters.
  assert.equal(surveyRowWidth({ count: 40, item: 28, gap: 6, allChip: 45 }), 7 * 34 + 45);
  assert.equal(surveyRowWidth({ count: 8, item: 28, gap: 6 }), 8 * 28 + 7 * 6);
  assert.equal(surveyRowWidth({ count: 0, item: 28, gap: 6, empty: 80 }), 80);
  assert.equal(surveyRowMaxFor(1000, { count: 40, item: 28, gap: 6, allChip: 45 }), 8);
  assert.equal(surveyRowMaxFor(40, { count: 40, item: 28, gap: 6, allChip: 45 }), 0);
  // 8 categories: all eight, folded, at 1100 in all four panel states.
  for (const combo of COMBOS) {
    const p = at(1100, combo, { ...SAMPLE, categoryCount: 8 });
    assert.equal(p.step, 'fold', JSON.stringify(combo));
    assert.equal(p.rowMax, 8);
  }
  // 9 or 40: the same in all four states (one chip fewer before "All N").
  for (const n of [9, 40]) {
    const plans = COMBOS.map((combo) => at(1100, combo, { ...SAMPLE, categoryCount: n, allChip: 45 }));
    assert.ok(plans.every((p) => p.stable && p.step === 'fewer' && p.rowMax === 7), JSON.stringify(plans.map((p) => [p.step, p.rowMax])));
  }
  // 1440: the whole count-rule row at full size, both panels open.
  assert.equal(at(1440, { left: true, right: true }, { ...SAMPLE, categoryCount: 40, allChip: 45 }).step, 'full');
  assert.ok(!SURVEY_BAR_STEPS.some((step) => /scroll/.test(step)));
});

test('a narrow window plans for the panels actually open, and only loses chips to them', () => {
  // 900px: not even 4 chips and "All N" sit beside both panels, so the plan
  // follows the open panels: everything while they are shut...
  const shut = at(900);
  assert.equal(shut.stable, false);
  assert.equal(shut.step, 'full');
  assert.equal(shut.rowMax, 8);
  // ...and fewer chips before "All N" (never a scroll) with both open.
  const both = at(900, { left: true, right: true });
  assert.equal(both.step, 'fewer');
  assert.ok(both.rowMax >= 1 && both.rowMax < 8, JSON.stringify(both));
  // The entity bar follows the same rule in its own room.
  assert.equal(at(1100, { left: true, right: true }, { ...SAMPLE, entityCount: 40 }).entityRowMax, 8);
  assert.ok(at(900, { left: true, right: true }, { ...SAMPLE, entityCount: 40 }).entityRowMax < 8);
});

test('the entity row is planned with the swatch gutter as drawn (a touch tablet opens it to 18px)', () => {
  // iPad portrait, Survey panel open: 928px bar, centre 464, 136px each side
  // of it before the Survey panel. 10 entities: on 6px gutters 7 + "All 10"
  // fit; on the tablet's 18px gutters they would run ~50px under the panel.
  const ipad = { barWidth: 928, centre: 464, insetLeft: 208, insetRight: 320, ...SAMPLE, entityCount: 10, entityAllChip: 45 };
  const desk = planSurveyBar(ipad);
  const tablet = planSurveyBar({ ...ipad, swatchGap: 18 });
  assert.equal(desk.entityRowMax, 8);
  assert.ok(tablet.entityRowMax < desk.entityRowMax, JSON.stringify(tablet));
  const row = (max, gap) => surveyRowWidth({ count: 10, item: SURVEY_BAR_PARTS.swatch, gap, allChip: 45, max });
  assert.ok(row(tablet.entityRowMax, 18) <= 2 * (928 - 320 - SURVEY_BAR_PARTS.inset - 464));
  // Left out or junk: the 6px gutter.
  assert.deepEqual(planSurveyBar({ ...ipad, swatchGap: undefined }), desk);
  assert.deepEqual(planSurveyBar({ ...ipad, swatchGap: NaN }), desk);
  // The hook reads the gutter off the drawn entity row.
  assert.match(fs.readFileSync(new URL('../src/hooks/useSurveyBarFit.js', import.meta.url), 'utf8'), /getComputedStyle\(entityRowEl\)\.columnGap/);
});

test('the plan depends only on its inputs (never on what is drawn now)', () => {
  for (let window = 721; window <= 2000; window += 37) {
    assert.deepEqual(at(window, { right: true }), at(window, { right: true }));
  }
});

test('the viewer draws the plan: a pinned centre group, end pieces, entity bar', () => {
  const viewer = fs.readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /useSurveyBarFit\(\{/);
  assert.match(viewer, /data-survey-bar-step=\{look\.step\}/);
  assert.match(viewer, /className="survey-subrow__centre"/);
  assert.match(viewer, /compact=\{surveyBarFit\.plan\.template === 'glyph'\}/);
  assert.match(viewer, /<ToolbarOverflowMenu items=\{moreItems\}/);
  assert.match(viewer, /<SurveyEntityBar/);
  assert.match(viewer, /max=\{surveyBarFit\.plan\.rowMax\}/);
  assert.match(viewer, /max=\{surveyBarFit\.plan\.entityRowMax\}/);
  // Done is drawn unconditionally (never folded).
  assert.match(viewer, /aria-label="Leave Survey"/);
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const centre = css.slice(css.indexOf('.survey-subrow__centre {'));
  assert.match(centre.slice(0, centre.indexOf('}')), /left: var\(--survey-centre-x, 50%\);\s*transform: translateX\(-50%\);/);
  const entity = css.slice(css.indexOf('.survey-entitybar .survey-entitybar__centre {'));
  assert.match(entity.slice(0, entity.indexOf('}')), /left: var\(--survey-centre-x, 50%\);/);
  // The hook reads the tool bar's own centre (the group icons), as rows 2/3.
  const hook = fs.readFileSync(new URL('../src/hooks/useSurveyBarFit.js', import.meta.url), 'utf8');
  assert.match(hook, /#chrome-top-host \[data-tool-toolbar\]/);
  assert.match(hook, /setProperty\('--survey-centre-x'/);
});

test('rows under the tool bar draw a hairline at each rail edge, desktop only', () => {
  const shell = fs.readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /data-row-edges=\{isMobileViewer \? undefined : 'true'\}/);
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /#chrome-sub-toolbar-host\[data-row-edges='true'\]::before,\s*#chrome-sub-toolbar-host\[data-row-edges='true'\]::after \{[^}]*width: 1px;[^}]*background: var\(--border\);/);
});
