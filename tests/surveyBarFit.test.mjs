// 2026-10-07 (survey bar, narrow windows): at 1024px with the left panel and
// the Survey panel both open, the survey bar's template name was cut and the
// module pill ran over the category chips. The bar now gives ground in a fixed
// order (src/utils/responsiveToolbar.js planSurveyBarStep, measured by
// src/hooks/useSurveyBarFit.js). These pin the order and the widths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SURVEY_BAR_STEPS,
  SURVEY_BAR_PARTS,
  planSurveyBarStep,
  surveyBarLook,
  surveyBarWidths,
} from '../src/utils/responsiveToolbar.js';

// The sample the bug was found with: "surveyA Template" (100px of 12px text),
// longest module "Existing Survey Data" (107px of 11px text), three chips (96).
const SAMPLE = { templateText: 100, moduleText: 107, categories: 96 };
const roomAt = (window, { left = false, right = false } = {}) => window - 96 - 16 - (left ? 272 : 0) - (right ? 320 : 0);

test('the order: template name, then module name, then Reuse / module / template into More, chips last', () => {
  assert.deepEqual(SURVEY_BAR_STEPS, ['full', 'short-template', 'glyph-template', 'short-module', 'fold-reuse', 'fold-module', 'fold-template', 'scroll-categories']);
  const looks = SURVEY_BAR_STEPS.map((step) => surveyBarLook(step));
  assert.deepEqual(looks.map((l) => l.template), ['full', 'short', 'glyph', 'glyph', 'glyph', 'glyph', 'more', 'more']);
  assert.deepEqual(looks.map((l) => l.module), ['full', 'full', 'full', 'short', 'short', 'more', 'more', 'more']);
  assert.deepEqual(looks.map((l) => l.reuse), ['bar', 'bar', 'bar', 'bar', 'more', 'more', 'more', 'more']);
  assert.deepEqual(looks.map((l) => l.more), [false, false, false, false, true, true, true, true]);
  // Only the last resort lets the chips scroll; they never leave the bar.
  assert.deepEqual(looks.map((l) => l.scroll), [false, false, false, false, false, false, false, true]);
});

test('each step is narrower than the one before (so a narrowing window only ever gives ground)', () => {
  const totals = SURVEY_BAR_STEPS.map((step) => surveyBarWidths(step, SAMPLE).total);
  for (let i = 1; i < totals.length; i += 1) assert.ok(totals[i] <= totals[i - 1], `${SURVEY_BAR_STEPS[i]} ${totals[i]} > ${totals[i - 1]}`);
  // The full bar: template 147 + 8 + module 149 + rule 17, chips 96, rule 17 + Reuse 67 + 8 + Done 50.
  assert.equal(surveyBarWidths('full', SAMPLE).total, 147 + 8 + 149 + 17 + 96 + 17 + 67 + 8 + 50);
});

test('the reported case and its neighbours pick the expected step', () => {
  // 1024px, both panels open (the bug): the module menu and Reuse fold into More.
  assert.equal(planSurveyBarStep(roomAt(1024, { left: true, right: true }), SAMPLE).step, 'fold-module');
  // 1024px with one panel, and every width from 1280 with both: nothing gives.
  assert.equal(planSurveyBarStep(roomAt(1024, { left: true }), SAMPLE).step, 'full');
  assert.equal(planSurveyBarStep(roomAt(1024, { right: true }), SAMPLE).step, 'full');
  assert.equal(planSurveyBarStep(roomAt(1280, { left: true, right: true }), SAMPLE).step, 'full');
  assert.equal(planSurveyBarStep(roomAt(1180, { left: true, right: true }), SAMPLE).step, 'glyph-template');
  // 900px, both panels open (212px of bar): only the chips, More and Done.
  const tiny = planSurveyBarStep(roomAt(900, { left: true, right: true }), SAMPLE);
  assert.equal(tiny.step, 'fold-template');
  assert.equal(tiny.fits, true);
});

test('long names give ground first; many chips in a tiny span scroll as the last resort', () => {
  const long = { templateText: 334, moduleText: 268, categories: 232 };
  // Names are capped (template 260, module 220) before any step is taken.
  assert.equal(surveyBarWidths('full', long).templateMin, SURVEY_BAR_PARTS.templateMax);
  assert.equal(surveyBarWidths('full', long).moduleMin, SURVEY_BAR_PARTS.moduleMax);
  const plan = planSurveyBarStep(roomAt(1024, { left: true, right: true }), long);
  assert.equal(plan.step, 'scroll-categories');
  // A short name is never "shortened" to wider than itself.
  assert.equal(surveyBarWidths('short-template', { templateText: 20 }).templateMin, SURVEY_BAR_PARTS.templateChrome + 20);
});

test('the plan depends only on the room and the names, never on the look drawn now', () => {
  for (let room = 150; room <= 900; room += 7) {
    const a = planSurveyBarStep(room, SAMPLE);
    const b = planSurveyBarStep(room, SAMPLE);
    assert.deepEqual(a, b);
    if (a.fits) assert.ok(a.widths.total + SURVEY_BAR_PARTS.slack <= room);
  }
});

test('the viewer draws the plan: compact template, More menu, step attribute', () => {
  const viewer = fs.readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /useSurveyBarFit\(\{/);
  assert.match(viewer, /data-survey-bar-step=\{look\.step\}/);
  assert.match(viewer, /compact=\{!inMore && look\.template === 'glyph'\}/);
  assert.match(viewer, /<ToolbarOverflowMenu items=\{moreItems\}/);
  // Done is drawn unconditionally (never folded).
  assert.match(viewer, /aria-label="Leave Survey"/);
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.survey-subrow:not\(\[data-survey-bar-step='full'\]\)/);
  assert.match(css, /min-width: var\(--survey-template-min, 0px\)/);
  assert.match(css, /min-width: var\(--survey-module-min, 0px\)/);
});

test('rows under the tool bar draw a hairline at each rail edge, desktop only', () => {
  const shell = fs.readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /data-row-edges=\{isMobileViewer \? undefined : 'true'\}/);
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /#chrome-sub-toolbar-host\[data-row-edges='true'\]::before,\s*#chrome-sub-toolbar-host\[data-row-edges='true'\]::after \{[^}]*width: 1px;[^}]*background: var\(--border\);/);
});
