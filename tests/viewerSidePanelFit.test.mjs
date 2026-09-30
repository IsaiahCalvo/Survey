import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  compensateScrollLeftForSideRoom,
  computeSideOverlayInsets,
  getViewerSideOccluders,
  registerViewerSideOccluder,
  resolveBandCentreScrollLeft,
  resolveSideRoom,
  shouldAutoRefit,
  subscribeViewerSideOccluders,
} from '../src/utils/viewerSideOverlay.js';

/*
 * RULED 2026-09-23 (coordinator: auto refits keep the view; fits use the band
 * between panels). Found by the w22 verifier after the right-rail audit and the
 * toolbar scroll-room merges, measured at 1280x800 on "Package 2 - Rev 4 -- IC":
 *   1. in Fit page mode, opening the desktop Survey panel mid page moved page 10
 *      by +101px; scrolled into the strip room it moved page 1 by -36px; on the
 *      phone closing the survey sheet halved the zoom and snapped the page. The
 *      panel toggles run the layout re-fit, and every fit landed the page.
 *   2. desktop fits ignored the open Survey panel (right 272px of the viewer)
 *      and Pages panel (left 224px), so a landscape sheet sat partly under them.
 *   3. phone: Fit width switched Pan to Select and opened the settings strip.
 * Live after the fix (1280x800, same document): Survey panel open / collapse /
 * expand mid page and in the strip room: page moves 0px, zoom 89% throughout;
 * Pages panel open: 0px. With both panels open Fit page on the landscape sheet
 * is 53% with 20px either side inside the 688px band; Fit page on the portrait
 * cover 72.5px either side. Phone 390x844: survey sheet open, template pick and
 * close, hub open and close: 0px, zoom 53% throughout; Fit width keeps Pan.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const scroller = { top: 69, bottom: 800, left: 48, right: 1232 };

test('side panels: the open Survey and Pages panels are measured as side insets', () => {
  // Survey panel: 960..1280, full height; the scroller ends at 1232.
  assert.deepEqual(computeSideOverlayInsets(scroller, [{ left: 960, right: 1280, top: 69, bottom: 800 }]), { left: 0, right: 272 });
  // Pages panel: 0..272 (its 48px icon column sits outside the scroller).
  assert.deepEqual(computeSideOverlayInsets(scroller, [{ left: 0, right: 272, top: 69, bottom: 800 }]), { left: 224, right: 0 });
  assert.deepEqual(
    computeSideOverlayInsets(scroller, [{ left: 0, right: 272, top: 69, bottom: 800 }, { left: 960, right: 1280, top: 69, bottom: 800 }]),
    { left: 224, right: 272 },
  );
  // The collapsed 48px Survey rail lies outside the viewer: nothing covered.
  assert.deepEqual(computeSideOverlayInsets(scroller, [{ left: 1232, right: 1280, top: 69, bottom: 800 }]), { left: 0, right: 0 });
  // A short popover at the edge is not a side panel.
  assert.deepEqual(computeSideOverlayInsets(scroller, [{ left: 1100, right: 1232, top: 500, bottom: 800 }]), { left: 0, right: 0 });
  // Never covers everything.
  assert.deepEqual(computeSideOverlayInsets(scroller, [{ left: 0, right: 700, top: 69, bottom: 800 }, { left: 640, right: 1280, top: 69, bottom: 800 }]), { left: 0, right: 0 });
});

test('side room: grows at once, and gives back only what is off screen', () => {
  // A panel opens: the room takes its width at once.
  assert.deepEqual(resolveSideRoom({ room: { left: 0, right: 0 }, inset: { left: 224, right: 272 }, scrollLeft: 0 }), { left: 224, right: 272 });
  // The Pages panel closes while the page sits centred (scrolled past the
  // 224px left room): all of it is off screen, so all of it goes back.
  assert.deepEqual(resolveSideRoom({ room: { left: 224, right: 0 }, inset: { left: 0, right: 0 }, scrollLeft: 224, pageScrollMax: 224 }), { left: 0, right: 0 });
  // Scrolled fully left (the left room on screen): it stays until scrolled off.
  assert.deepEqual(resolveSideRoom({ room: { left: 224, right: 0 }, inset: { left: 0, right: 0 }, scrollLeft: 0, pageScrollMax: 224 }), { left: 224, right: 0 });
  assert.deepEqual(resolveSideRoom({ room: { left: 224, right: 0 }, inset: { left: 0, right: 0 }, scrollLeft: 100, pageScrollMax: 224 }), { left: 124, right: 0 });
  // The Survey panel closes after a fit centred the page in the band
  // (scrollLeft 248 with 224 left room): 24px of right room is on screen.
  assert.deepEqual(resolveSideRoom({ room: { left: 224, right: 272 }, inset: { left: 224, right: 0 }, scrollLeft: 248, pageScrollMax: 224 }), { left: 224, right: 24 });
  // Page centred in the full viewer: the right room is entirely off screen.
  assert.deepEqual(resolveSideRoom({ room: { left: 0, right: 272 }, inset: { left: 0, right: 0 }, scrollLeft: 0, pageScrollMax: 0 }), { left: 0, right: 0 });
  // Left-room changes move scrollLeft by the same amount, so the page holds still.
  assert.equal(compensateScrollLeftForSideRoom(0, 0, 224), 224);
  assert.equal(compensateScrollLeftForSideRoom(248, 224, 0), 24);
});

test('a fit you pick centres the page in the band between the panels', () => {
  // Landscape sheet at 53% (648px wide) with both panels open in a 1184px
  // viewer: band 224..912, page left in content = 224 room + (1184-648)/2.
  const pageLeft = 224 + (1184 - 648) / 2;
  const sl = resolveBandCentreScrollLeft({ pageLeft, pageWidth: 648, viewportWidth: 1184, insets: { left: 224, right: 272 }, maxScrollLeft: 496 });
  assert.equal(sl, 248);
  const onScreenLeft = pageLeft - sl;
  assert.equal(onScreenLeft - 224, 20, '20px from the Pages panel');
  assert.equal((1184 - 272) - (onScreenLeft + 648), 20, '20px from the Survey panel');
  // No panels: the page stays centred with no horizontal scroll.
  assert.equal(resolveBandCentreScrollLeft({ pageLeft: (1184 - 900) / 2, pageWidth: 900, viewportWidth: 1184 }), 0);
});

test('an automatic re-fit only acts on a real change of the viewer or the page', () => {
  const last = { mode: 'fit', viewW: 1184, viewH: 731, pageW: 1085.8, pageH: 702.6 };
  // A floating panel opened or closed: the viewer is the same size — nothing to do.
  assert.equal(shouldAutoRefit(last, { ...last }), false);
  assert.equal(shouldAutoRefit(last, { ...last, viewW: 1184.3 }), false);
  // Window resize, rotation / late page sizes, a different mode, no fit yet.
  assert.equal(shouldAutoRefit(last, { ...last, viewW: 1084 }), true);
  assert.equal(shouldAutoRefit(last, { ...last, pageW: 702.6, pageH: 1085.8 }), true);
  assert.equal(shouldAutoRefit(last, { ...last, mode: 'fitw' }), true);
  assert.equal(shouldAutoRefit(null, last), true);
});

test('side-panel registry notifies the viewer', () => {
  const element = {};
  let calls = 0;
  const unsubscribe = subscribeViewerSideOccluders(() => { calls += 1; });
  const release = registerViewerSideOccluder(element);
  assert.ok(getViewerSideOccluders().includes(element));
  release();
  assert.ok(!getViewerSideOccluders().includes(element));
  assert.equal(calls, 2);
  unsubscribe();
});

test('wiring: auto re-fits are marked and never land; user fits use the band', () => {
  const container = read('../src/components/PdfjsViewerContainer.jsx');
  const zoomTo = container.slice(container.indexOf('const zoomToScale = useCallback('), container.indexOf('const goToPage = useCallback('));
  assert.match(zoomTo, /const auto = isFit && options\?\.auto === true;/);
  assert.match(zoomTo, /if \(auto && !shouldAutoRefit\(lastFit, fitRecord\)\) return;/);
  assert.match(zoomTo, /viewportW: bandW,/);
  assert.match(zoomTo, /if \(!isFit \|\| auto \|\| !dimsPtRef\.current\.length\) return;/, 'an automatic re-fit stops before landing');
  assert.match(zoomTo, /resolveBandCentreScrollLeft\(/);
  assert.match(container, /refitAfterLayoutChange: \(target\) => \{[\s\S]{0,160}zoomToScale\(target, \{ auto: true \}\)/);
  // The room is part of every page's left edge, the scroll range and the content width.
  // 2026-09-30: pages share one centre line and one scroll range
  // (src/utils/pdfPageColumn.js, tests/pdfPageColumn.test.mjs).
  assert.match(container, /resolveCentredPageLeft\(\{[\s\S]{0,120}sideLeft: sideRoomRef\.current\.left,/);
  assert.match(container, /resolveDocumentScrollLeftMax\(\{[\s\S]{0,160}sideLeft: sideRoomRef\.current\.left,\s*sideRight: sideRoomRef\.current\.right,/);
  assert.match(container, /const contentW = columnW \+ sideRoom\.left \+ sideRoom\.right;/);
  assert.match(container, /compensateScrollLeftForSideRoom\(base, previous\.left, sideRoom\.left\)/);

  const viewer = read('../src/PDFViewer.jsx');
  assert.match(viewer, /handleZoomModeSelectRef\.current\?\.\(currentMode, \{ auto: true \}\);/);
  assert.match(viewer, /if \(options\?\.auto === true && typeof magnification\.refitAfterLayoutChange === 'function'\)/);

  // Both desktop panels register as side panels.
  const rail = read('../src/SurveySpacesRail.jsx');
  assert.match(rail, /ref=\{mobileMode \? undefined : sideOccluderRef\}\s*data-viewer-occluder=\{!mobileMode && !isSurveyPanelCollapsed \? 'side' : undefined\}/);
  const sidebar = read('../src/PDFSidebar.jsx');
  assert.match(sidebar, /data-viewer-occluder=\{isCollapsed \? undefined : \(mobileMode \? 'sheet' : 'side'\)\}\s*ref=\{mobileMode \? undefined : sideOccluderRef\}/);
});

test('phone Fit width: a tap on chrome over the page never picks an annotation', () => {
  const viewer = read('../src/PDFViewer.jsx');
  const quickClick = viewer.slice(viewer.indexOf('// UX: pan-mode quick-click → select annotation'), viewer.indexOf('// UX: Escape and grey-page backdrop clicks'));
  const guard = quickClick.indexOf("if (!e.target?.closest?.('[data-mobile-pdf-surface]')) return;");
  assert.ok(guard > 0, 'the pan quick-click only reads presses on the PDF surface');
  assert.ok(guard < quickClick.indexOf('const hit = resolveAnnotationAt(e);'), 'checked before the position hit test');
});
