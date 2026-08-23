import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Desktop collapsed-rail Expand Survey panel (48 → 320) + Collapse.
// Live proof: debug/scenarios/e2e-expand-survey-panel.spec.mjs
// Distinct from leftover-18 / remapped-after-CW / dismiss-family /
// Zoom in/out click / left-rail History Collapse sidebar / Y/N/N-A.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SurveySpacesRail Expand/Collapse are type=button; Collapse ignores dblclick rebound', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /aria-label="Expand Survey panel"/);
  assert.match(rail, /aria-label="Collapse Survey panel"/);
  assert.match(rail, /isSurveyPanelCollapsed \? '48px' : '320px'/);
  assert.match(rail, /const \[isSurveyPanelCollapsed, setIsSurveyPanelCollapsed\] = useState\(true\)/);

  const expandIdx = rail.indexOf('aria-label="Expand Survey panel"');
  const expandWindow = rail.slice(rail.lastIndexOf('<button', expandIdx), expandIdx + 40);
  assert.match(expandWindow, /type="button"/);
  assert.match(expandWindow, /setIsSurveyPanelCollapsed\(false\)/);

  const collapseIdx = rail.indexOf('aria-label="Collapse Survey panel"');
  const collapseWindow = rail.slice(rail.lastIndexOf('<button', collapseIdx), collapseIdx + 40);
  assert.match(collapseWindow, /type="button"/);
  assert.match(collapseWindow, /if \(event\.detail > 1\) return/);
  assert.match(collapseWindow, /dismissSurveySheet\(\)/);

  const surveyIdx = rail.indexOf('aria-label="Survey"');
  const surveyWindow = rail.slice(rail.lastIndexOf('<button', surveyIdx), surveyIdx + 40);
  assert.match(surveyWindow, /type="button"/);
  assert.match(rail, /Only the survey-mode flag should expand/);
  assert.match(rail, /Only the key should re-open/);
  assert.match(rail, /\}, \[showSurveyPanel\]\);/);
  assert.match(rail, /\}, \[expandRequestKey\]\);/);
  assert.doesNotMatch(rail, /\[markSurveySheetOpen, showSurveyPanel\]/);
  assert.doesNotMatch(rail, /\[expandRequestKey, markSurveySheetOpen\]/);

  const sidebar = read('src/PDFSidebar.jsx');
  assert.match(sidebar, /aria-label=\{isCollapsed \? 'Expand sidebar' : 'Collapse sidebar'\}/);
  assert.match(sidebar, /type="button"/);
});

test('390 Open survey is the mobile leftover, not the 48px chevron', () => {
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /aria-label="Open survey"/);
  assert.match(mobile, /onClick=\{onOpenSurvey\}/);
  assert.doesNotMatch(mobile, /Expand Survey panel/);
});

test('live spec covers Expand Survey intended + break + edge; skip leftover-18 and Zoom replay', () => {
  const spec = read('debug/scenarios/e2e-expand-survey-panel.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Expand Survey panel intended \+ break \+ edge/);
  assert.match(spec, /390 Open survey sheet edge/);
  assert.match(spec, /collapsed rail Expand Survey must be live/);
  assert.match(spec, /Expand click must show Collapse Survey/);
  assert.match(spec, /expanded survey panel is 320/);
  assert.match(spec, /Collapse click must restore Expand Survey/);
  assert.match(spec, /Escape must not collapse Survey/);
  assert.match(spec, /Space must not collapse Survey/);
  assert.match(spec, /double-click Expand must stay expanded/);
  assert.match(spec, /hubPreview Expand Survey 0/);
  assert.match(spec, /page-1 rect must survive Expand Survey/);
  assert.match(spec, /Pen-armed Expand invents 0/);
  assert.match(spec, /Expand Survey must not change page/);
  assert.match(spec, /390 Expand Survey 0 until Open survey/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Control\+=/);
  assert.doesNotMatch(spec, /Zoom in click must raise zoom %/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);
  assert.doesNotMatch(spec, /surveyTransitionE2E=1/);
  assert.doesNotMatch(spec, /unplacedRows=/);
});

test('hunt goes beyond exclusive-layer Zoom hunt and skips leftover-18 / Zoom replay', () => {
  const hunt = read('debug/scenarios/e2e-after-zoom-buttons-independent-hunt.spec.mjs');
  assert.match(hunt, /independent hunt after Zoom in\/out click leftover/);
  assert.match(hunt, /e2e-after-exclusive-layer-independent-hunt/);
  assert.match(hunt, /Expand Survey panel/);
  assert.match(hunt, /Collapse sidebar/);
  assert.match(hunt, /Open survey/);
  assert.match(hunt, /testPdf=clickable-link-test\.pdf/);
  assert.match(hunt, /hubPreview=1/);
  assert.match(hunt, /file\.id/);
  assert.doesNotMatch(hunt, /file\.id\s*=/);
  assert.doesNotMatch(hunt, /Zoom in click must raise zoom %/);
  assert.doesNotMatch(hunt, /Control\+=/);
  assert.doesNotMatch(hunt, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(hunt, /VITE_DEV_AUTO_LOGIN/);
});
