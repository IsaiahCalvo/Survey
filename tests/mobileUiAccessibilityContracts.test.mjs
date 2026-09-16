import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const mobileChrome = read('../src/mobile/MobilePdfViewerChrome.jsx');
const mobileCss = read('../src/mobile/mobilePdfViewer.css');
const picker = read('../src/components/CompactColorPicker.jsx');
const documents = read('../src/home/DocumentsLedger.jsx');
const templates = read('../src/home/TemplatesEditor.jsx');
const hubCss = read('../src/home/hub.css');

test('live text formatting uses only app-styled menus', () => {
  const start = mobileChrome.indexOf('if (api.richTextEditor)');
  const end = mobileChrome.indexOf("if (api.activeTool === 'pan'", start);
  const liveTextFormatting = mobileChrome.slice(start, end);
  assert.doesNotMatch(liveTextFormatting, /<select\b/);
  assert.match(liveTextFormatting, /ariaLabel="Font"/);
  assert.match(liveTextFormatting, /ariaLabel="Text alignment"/);
  assert.match(mobileCss, /\.mobile-styled-select__trigger \{[\s\S]{0,160}min-height: 44px/);
  assert.match(mobileCss, /\.mobile-styled-select__menu > button \{[\s\S]{0,120}min-height: 44px/);
});

/*
 * 2026-09-16 phone sizing pass (owner ruling: every phone control takes its
 * height, glyph and gap from Drawboard's ratios, through shared tokens). Two
 * pinned numbers moved with the tokens and are re-pinned here, same intent:
 *   - the strip's compact visual height is now --mobile-strip-control-h, whose
 *     value is still 24px, so "24px visuals" is unchanged;
 *   - the strip's right padding used to be the literal 52px, which was only
 *     ever "rail width + left padding" for a 44px rail. The rail is 40px now,
 *     so the rule states the relationship instead of a number.
 *
 * RULED CHANGE 2026-09-16 (phone sweep; owner ruling "sizing follows
 * Drawboard's ratios uniformly ... everything reads a little big", plus the
 * measured defect that the Arrow and Callout bars pushed controls off a 375px
 * screen with no scroll path). HOW the 44px target is delivered changed, so the
 * assertions that pinned the old delivery had to change with it:
 *   - the bar now SCROLLS sideways, and a scroll container clips both axes, so
 *     `overflow: visible` could no longer let a pad escape a 36px bar. Instead
 *     the BOX is 44px with only its top 36px painted (a gradient, plus 8px of
 *     bottom padding so the controls still centre in the painted band), and the
 *     pads reach the bottom of that box: -6px above, -14px below. Same 44px,
 *     nothing clipped, and the bar looks identical.
 *   - the rich-text bar was the one strip that painted 44px controls in a 52px
 *     band. It paints 24px in the shared 36px band now, like every other tool,
 *     and takes the same transparent pads.
 * What this test exists to protect - a 24px visual with a full 44px target - is
 * still exactly what is asserted.
 */
test('compact eraser and shape selects keep 24px visuals with unclipped 44px targets', () => {
  assert.match(mobileCss, /\.mobile-pdf-properties \{[\s\S]{0,1600}height: 44px;[\s\S]{0,60}min-height: 44px/);
  assert.match(mobileCss, /\.mobile-pdf-properties \{[\s\S]{0,2600}overflow-x: auto/);
  assert.match(mobileCss, /--mobile-strip-control-h: 24px;/);
  assert.match(mobileCss, /\.mobile-pdf-properties \{[\s\S]{0,1800}padding: 0 calc\(var\(--mobile-rail-w\) \+ 8px\) 8px 8px;/);
  // The painted bar is still 36px: the gradient stops there and the rest of the
  // box is transparent.
  assert.match(mobileCss, /\.mobile-pdf-properties \{[\s\S]{0,3000}background: linear-gradient\(to bottom, #202126 0 35px, #090a0d 35px 36px, transparent 36px\);/);
  assert.match(mobileCss, /\.mobile-pdf-properties--text \{[\s\S]{0,350}padding-right: 8px;/);
  assert.match(mobileCss, /\.mobile-pdf-properties:not\(\.mobile-pdf-properties--text\) > \.mobile-styled-select[\s\S]{0,140}height: var\(--mobile-strip-control-h\);[\s\S]{0,60}min-height: var\(--mobile-strip-control-h\)/);
  assert.match(mobileCss, /\.mobile-pdf-properties:not\(\.mobile-pdf-properties--text\)[\s\S]{0,320}\.mobile-styled-select__trigger::after[\s\S]{0,120}inset-block: -6px -14px/);
  assert.match(mobileCss, /\.mobile-pdf-properties--text > \.mobile-styled-select,[\s\S]{0,180}height: var\(--mobile-strip-control-h\);[\s\S]{0,60}min-height: var\(--mobile-strip-control-h\)/);
  assert.match(mobileCss, /\.mobile-pdf-properties--text > \.mobile-styled-select \.mobile-styled-select__trigger::after[\s\S]{0,120}inset-block: -6px -14px/);
});

test('shared color picker uses captured pointer gestures for touch and mouse', () => {
  assert.match(picker, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(picker, /onPointerDown=\{\(event\) => beginPointerDrag\('sv', event\)\}/);
  assert.match(picker, /onPointerMove=\{\(event\) => movePointerDrag\('hue', event\)\}/);
  assert.match(picker, /touchAction: 'none'/);
  assert.doesNotMatch(picker, /onMouseDown=\{handleMouseDown(?:SV|Hue)\}/);
});

test('mobile detail and Entities dialogs use the shared focus trap', () => {
  for (const source of [documents, templates]) {
    assert.match(source, /useModalFocusTrap\(\{/);
    assert.match(source, /aria-modal="true"/);
    assert.match(source, /tabIndex=\{-1\}/);
  }
  assert.match(documents, /initialFocusRef: mobileDetailCloseRef/);
  assert.match(templates, /initialFocusRef: mobileEntitiesCloseRef/);
  assert.match(templates, /active: Boolean\(moveModal\)[\s\S]{0,180}initialFocusRef: moveModalCloseRef/);
});

test('nested Entities actions and picker use explicit top-layer ownership', () => {
  const share = read('../src/home/ShareModal.jsx');
  const focusTrap = read('../src/home/useModalFocusTrap.js');
  assert.match(share, /useModalFocusTrap\(\{[\s\S]{0,180}initialFocusRef: closeRef/);
  assert.match(share, /role="dialog"[\s\S]{0,100}data-modal-focus-layer="true"/);
  assert.match(templates, /aria-label="Move or copy items"[\s\S]{0,100}data-modal-focus-layer="true"/);
  assert.match(picker, /data-modal-focus-layer="true"/);
  assert.match(focusTrap, /hasActiveNestedLayer\(\)/);
});

test('styled selects close on Tab and announce their selected value', () => {
  assert.match(mobileChrome, /else if \(event\.key === 'Tab'\) \{[\s\S]{0,80}closeAndMoveFocus\(event\)/);
  assert.match(mobileChrome, /aria-label=\{`\$\{ariaLabel\}: \$\{currentLabel\}`\}/);
});

test('named compact mobile controls expose 44px hit areas without resizing header rows', () => {
  assert.match(hubCss, /\.survey-hub \.hub-mobile-primary-action::after,[\s\S]{0,900}inset-block: -8px/);
  assert.match(hubCss, /\.survey-hub \.hub-mobile-primary-action::after,[\s\S]{0,300}inset-block: -16px 0/);
  assert.match(hubCss, /\.survey-hub \.documents-mobile-filter \{[\s\S]{0,120}height: 44px/);
  assert.match(hubCss, /\.survey-hub \.documents-mobile-filter-visual \{[\s\S]{0,120}height: 28px/);
  assert.match(hubCss, /\.survey-hub \.mobile-profile \.who > button \{[\s\S]{0,100}width: 44px !important;[\s\S]{0,50}height: 44px/);
  assert.match(hubCss, /\.survey-hub button\[title="More"\] \{[\s\S]{0,100}width: 44px !important;[\s\S]{0,50}height: 44px !important/);
  assert.match(hubCss, /\.survey-hub \[data-drag-rearrange-handle\] \{[\s\S]{0,100}width: 44px !important;[\s\S]{0,50}height: 44px !important/);
  assert.match(hubCss, /button\[title="Edit color"\] \{[\s\S]{0,100}width: 44px;[\s\S]{0,50}height: 44px/);
  assert.match(hubCss, /\.survey-hub \.mobile-header-select-row \{[\s\S]{0,120}height: 44px;[\s\S]{0,80}margin-block: -8px/);
  assert.match(hubCss, /\.survey-hub \.documents-mobile-select-main \{[\s\S]{0,100}height: 44px;[\s\S]{0,80}margin-block: -8px/);
});

test('mobile list lead controls align by role without moving row copy', () => {
  assert.match(hubCss, /\.survey-hub \.mobile-doc-card > :first-child,[\s\S]{0,260}\.survey-hub \.templates-mobile-row\.reorderable > :first-child \{[\s\S]{0,100}transform: translateX\(-8px\)/);
  assert.match(hubCss, /\.survey-hub \.archive-mobile-card-head > :first-child \{[\s\S]{0,100}transform: none/);
});

test('desktop Documents preview uses Share, not an ellipsis glyph', () => {
  assert.match(documents, /title="Share"[\s\S]{0,120}<Icon name="share"/);
  assert.doesNotMatch(documents, /title="Share"[\s\S]{0,120}<Icon name="more"/);
});
