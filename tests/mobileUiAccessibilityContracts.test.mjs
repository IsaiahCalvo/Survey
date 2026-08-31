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

test('shared mobile properties pane uses app-styled menus and names its state', () => {
  const start = mobileChrome.indexOf('export function MobileToolProperties');
  const end = mobileChrome.indexOf('export function MobilePdfViewerToolRail', start);
  const propertiesPane = mobileChrome.slice(start, end);
  assert.doesNotMatch(propertiesPane, /<select\b/);
  assert.match(propertiesPane, /ariaLabel="Font"/);
  assert.match(propertiesPane, /<strong>\{sheetTitle\} properties<\/strong>/);
  assert.doesNotMatch(propertiesPane, /Next mark defaults|Current selection|Editing text|Changes apply now/);
  assert.doesNotMatch(propertiesPane, />Reset</);
  assert.doesNotMatch(propertiesPane, />Done</);
  assert.match(propertiesPane, /aria-label="Close annotation properties"/);
  assert.doesNotMatch(propertiesPane, /Open \$\{sheetTitle\} properties|isTextTool \? 'Aa' : '•••'/);
  assert.match(propertiesPane, /isTextTool \? ' has-mode-tabs'/);
  assert.match(mobileCss, /\.mobile-pdf-text-defaults\.is-shape:not\(\.has-mode-tabs\)/);
  assert.match(mobileCss, /\.mobile-pdf-text-defaults\.has-mode-tabs \{\s*height: min\(calc\(560px \+ var\(--mobile-bottom-inset\)\)/);
  assert.match(mobileCss, /\.mobile-pdf-text-defaults\.is-text \.mobile-pdf-text-card__font-size > div \{\s*width: auto;\s*grid-template-columns: 148px 52px;/);
  assert.match(mobileCss, /\.mobile-pdf-text-defaults__tabs > button\.is-active \{[\s\S]{0,180}box-shadow: inset 0 0 0 1px/);
  assert.match(mobileCss, /\.mobile-pdf-text-defaults__tabs > button:first-child \{\s*border-radius: 16px 0 0 16px;/);
  assert.match(mobileCss, /\.mobile-pdf-text-defaults__tabs > button:last-child \{\s*border-radius: 0 16px 16px 0;/);
  assert.match(mobileCss, /\.mobile-pdf-text-card__color-tabs > button:first-child \{\s*border-radius: 16px 0 0 16px;/);
  assert.match(mobileCss, /\.mobile-pdf-text-card__color-tabs > button:last-child \{\s*border-radius: 0 16px 16px 0;/);
  assert.match(mobileCss, /\.mobile-styled-select__trigger \{[\s\S]{0,160}min-height: 44px/);
  assert.match(mobileCss, /\.mobile-styled-select__menu > button \{[\s\S]{0,120}min-height: 44px/);
});

test('compact format entry and pane controls keep 44px touch targets', () => {
  assert.match(mobileCss, /\.mobile-pdf-properties--entry \{[\s\S]{0,120}height: 44px;[\s\S]{0,50}min-height: 44px/);
  assert.match(mobileCss, /\.mobile-pdf-properties__open,[\s\S]{0,180}min-width: 44px;[\s\S]{0,50}min-height: 44px/);
  assert.match(mobileCss, /\.mobile-pdf-text-defaults__format > button \{[\s\S]{0,100}width: 44px;[\s\S]{0,50}height: 44px/);
  assert.match(mobileCss, /\.mobile-pdf-text-defaults__alignments > button \{[\s\S]{0,80}min-height: 44px/);
});

test('mobile width field matches its neighboring strip controls', () => {
  assert.match(mobileCss, /\.mobile-pdf-properties > \.mobile-pdf-properties__size-control \{\s*height: 24px;/);
  assert.match(mobileCss, /\.mobile-pdf-properties > \.mobile-pdf-properties__size-control > input \{[\s\S]{0,120}height: 22px;[\s\S]{0,40}line-height: 22px;/);
  assert.match(mobileCss, /\.mobile-pdf-properties > \.mobile-pdf-properties__size-control > \.annotation-size-control__trigger \{[\s\S]{0,120}height: 22px;/);
  assert.match(mobileCss, /\.mobile-pdf-text-defaults\.is-shape \.mobile-pdf-text-card--split \.mobile-styled-select,[\s\S]{0,240}height: 30px;[\s\S]{0,40}min-height: 30px;/);
  assert.match(mobileCss, /\.mobile-pdf-text-defaults\.is-shape \.mobile-pdf-text-card--split \.mobile-styled-select \{\s*width: 112px;[\s\S]{0,40}max-width: 100%;/);
  assert.match(mobileCss, /\.mobile-pdf-text-defaults\.is-shape \.mobile-pdf-text-card--split \.annotation-size-control > input,[\s\S]{0,180}height: 28px;[\s\S]{0,40}line-height: 28px;/);
});

test('active left-rail tools use a gold icon without a gold border', () => {
  assert.match(mobileCss, /\.mobile-pdf-tools__button\.is-active \{[\s\S]{0,120}color: var\(--accent-primary,[\s\S]{0,80}border-color: transparent;/);
});

test('mobile rail exposes export directly without a zoom menu', () => {
  const start = mobileChrome.indexOf('export function MobilePdfViewerToolRail');
  const end = mobileChrome.indexOf('export function MobilePdfViewerDock', start);
  const toolRail = mobileChrome.slice(start, end);
  assert.match(toolRail, /icon="download"\s+label="Export annotated PDF"/);
  assert.match(toolRail, /onClick=\{\(\) => bottomToolbarApi\?\.exportAnnotatedPdf\?\.\(\)\}/);
  assert.doesNotMatch(toolRail, /More document options/);
  assert.doesNotMatch(toolRail, /Zoom out|Zoom in/);
});

test('mobile viewer uses the shared navy and Helvetica design tokens', () => {
  assert.match(mobileCss, /--mobile-ink-900: #0d0f14;/);
  assert.match(mobileCss, /--mobile-ink-800: #12151c;/);
  assert.match(mobileCss, /--mobile-ink-700: #181c24;/);
  assert.match(mobileCss, /--mobile-font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;/);
  assert.match(mobileCss, /\.mobile-pdf-header \{[\s\S]{0,700}background: var\(--mobile-ink-900\);/);
  assert.match(mobileCss, /\.mobile-pdf-tools \{[\s\S]{0,300}background: var\(--mobile-ink-800\);/);
  assert.match(mobileCss, /\.mobile-pdf-properties \{[\s\S]{0,700}background: var\(--mobile-ink-700\);/);
  assert.match(mobileCss, /\.mobile-pdf-dock \{[\s\S]{0,500}background: var\(--mobile-ink-900\);/);
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
