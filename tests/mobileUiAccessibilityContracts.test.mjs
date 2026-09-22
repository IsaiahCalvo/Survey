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
  // RULED CHANGE 2026-09-21 (pass 7, boards 1-7 + 15). The pill PAINTS 20px and is
  // HIT at 44px through a transparent pad - the painted-20/box-44 trick every
  // control on this bar uses - where it used to paint a 44px box. And a menu row
  // is 26px on board 15, not 44: a menu is a list you are already inside, its rows
  // are adjacent so there is no dead lane to miss into, and 44px rows made a
  // six-option arrowhead menu taller than the sheet it opened over.
  assert.match(mobileCss, /\n\.mobile-styled-select__trigger \{[\s\S]{0,200}height: var\(--mobile-strip-control-h\)/);
  /* RULED CHANGE 2026-09-22 (owner, phone review: "Strip controls measure 40px
     tall, not 44 — raise the strip hit box to 44"). The pad was SYMMETRIC (-12px)
     and hit-tested at 37-40px, because the header's own 44px pads reach 8px below
     the 34px header and win that overlap. Measured from y=37 down instead:
     -5px / -19px on a control sitting at y=42..62 is 37..81, a clear 44. Same
     contract, same painted 20px — see tests/mobileToolPropertiesReach for the
     full set. */
  assert.match(
    mobileCss,
    /\.mobile-pdf-properties > \.mobile-styled-select \.mobile-styled-select__trigger::after \{[\s\S]{0,160}inset-block: -5px -19px/,
    'the pill must still be a 44px target: 20px painted, and the pad measured from y=37 down',
  );
  assert.match(mobileCss, /\.mobile-styled-select__menu > button \{[\s\S]{0,120}height: 26px/);
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
 *
 * RULED CHANGE 2026-09-16 (r5 phone pass; owner brief "the page must get every
 * tap below the painted bar"): the target is 36px, not 44px, and the assertions
 * that pinned 44 say 36 now. Why: the 44px came from pads hanging 8px BELOW the
 * painted bar, and that 8px strip lies over the top of the page. The bar cannot
 * give it up by going `pointer-events: none` - A/B'd on the simulator in r4,
 * WebKit will not scroll a scroll container that is not hit-testable - so every
 * tap and every pan that began in those 8px, across the full width, went to the
 * bar instead of the document. The bar now clips itself (`clip-path`) to the
 * 36px it paints, which hands that strip back to the page and caps every pad at
 * 36px. 36px of control against a page that answers its own taps: the page
 * wins. Apple's 44px is a floor for a control in open space, and 36px with
 * 5px lanes and no neighbour overlap still clears every control by a finger.
 */
/*
 * RULED CHANGE 2026-09-21 (pass 7, boards 1-7). Four pinned values moved, all of
 * them because the approved boards changed what this bar IS:
 *   - controls paint 20px, not 24 ("controls 20px, discs 16px in 22px buttons");
 *   - the bar is CENTRED and does not scroll, so `overflow-x: auto` is gone and
 *     with it the clip-path that a scroll container forced;
 *   - the right padding is the plain 8px the boards draw, not "rail + 8", which
 *     existed only to centre a row on the VIEWPORT; the boards centre it in the
 *     strip's own band;
 *   - the bar takes NO pointer events (its children take them back), which the
 *     old comment correctly said would break a scrolling bar - and the bar no
 *     longer scrolls, so it is now the right answer: the 8px of box that lies
 *     over the page hands those taps to the document in every lane between
 *     controls, and each control's pad reaches the full 44px.
 * So the target is 44px again, not the 36px the scroll era capped it at.
 */
test('the fitted tool strip paints 20px controls and hits them at 44px', () => {
  assert.match(mobileCss, /\.mobile-pdf-properties \{[\s\S]{0,1600}height: 44px;[\s\S]{0,60}min-height: 44px/);
  assert.match(mobileCss, /\.mobile-pdf-properties \{[\s\S]{0,2600}justify-content: center/);
  assert.doesNotMatch(mobileCss, /\.mobile-pdf-properties \{[\s\S]{0,2600}overflow-x: auto/);
  assert.match(mobileCss, /--mobile-strip-control-h: 20px;/);
  assert.match(mobileCss, /\.mobile-pdf-properties \{[\s\S]{0,1800}padding: 0 8px 8px;/);
  // The painted bar is still 36px: the gradient stops there and the rest of the
  // box is transparent.
  // DELIBERATE ASSERTION CHANGE (2026-09-17, revision-2 palette approved by the
  // owner): the two stops are the shared --surface-1 (the bar) and --surface-0
  // (the hairline under it) instead of #202126 and #090a0d, which were this one
  // stylesheet's own greys. The GEOMETRY this assertion exists for — paint to
  // 35px, a 1px rule to 36px, transparent after — is byte-for-byte unchanged.
  assert.match(mobileCss, /\.mobile-pdf-properties \{[\s\S]{0,3000}background: linear-gradient\(to bottom, var\(--surface-1\) 0 35px, var\(--surface-0\) 35px 36px, transparent 36px\);/);
  // The 8px below the painted bar belongs to the page: the bar clips itself to
  // its painted band, which removes that strip from hit testing as well as from
  // painting, while leaving the bar a scroll container.
  const barRule = /\.mobile-pdf-properties \{([\s\S]*?)\n\}/.exec(mobileCss);
  assert.notEqual(barRule, null, '.mobile-pdf-properties rule not found');
  const barDeclarations = barRule[1].replace(/\/\*[\s\S]*?\*\//g, '');
  // The 8px below the painted bar belongs to the page, and the bar gets there by
  // taking no pointer events rather than by clipping itself. A clip removed that
  // strip from hit testing but also capped every pad at 36px; pointer-events lets
  // a pad reach 44px and still hands the page every lane between controls. The
  // scrolling bar could not do this (WebKit will not scroll a container that is
  // not hit-testable); the fitted bar does not scroll, so it can.
  assert.doesNotMatch(barDeclarations, /clip-path/);
  assert.match(barDeclarations, /pointer-events: none;/);
  assert.match(
    mobileCss,
    /\.mobile-pdf-properties > \* \{[\s\S]{0,80}pointer-events: auto/,
    'the controls must take back the pointer events the bar drops',
  );
  // The one bar that still scrolls keeps both: its own pointer events, and the
  // clip that a scroll container forces.
  assert.match(
    mobileCss,
    /\.mobile-pdf-properties--text \{[\s\S]{0,320}pointer-events: auto;[\s\S]{0,80}clip-path: inset\(0 0 8px 0\)/,
  );
  // RULED CHANGE 2026-09-16 (r4 phone pass): 20px, not 8. The bar faded its last
  // 20px so a control sliced by the screen edge read as "there is more this
  // way"; with only 8px of runway the fade still lay over the Text-alignment
  // dropdown once the row was scrolled all the way, so a control the user had
  // successfully reached looked half-rendered. Every other variant already
  // cleared the fade (the base right inset is the 40px rail plus 8px). The
  // assertion moved from "8px" to "enough runway to clear the fade".
  // 2026-09-17 (owner ruling): the fade itself is GONE - the bar paints to the
  // screen edge, pinned by tests/mobileStripEdgeFade.test.mjs. The assertion
  // below is unchanged and still earns its keep as trailing runway: it is what
  // keeps the rich-text strip's last control off the screen edge.
  const textPad = mobileCss.match(/\.mobile-pdf-properties--text \{[\s\S]{0,650}?padding-right: (\d+)px;/);
  assert.notEqual(textPad, null, '.mobile-pdf-properties--text must declare padding-right');
  assert.ok(
    Number(textPad[1]) >= 20,
    `the rich-text strip ends ${textPad[1]}px from its edge, inside the bar's own 20px `
    + 'trailing fade, so its last control still looks cut off at the end of the scroll',
  );
  // RULED CHANGE 2026-09-21 (pass 7). The pill's height used to be overridden
  // per strip variant - one rule for the tool strips, another for the rich-text
  // one - because the rich-text bar was the only 44px-tall dropdown in the app.
  // Both variants take the shared control token now, so the base rule (asserted
  // at the top of this file) sets it once and there is no per-variant override
  // left to pin. What is still per-variant is the PAD, and it must be: the fitted
  // strips reach 44px (-12px), the scrolling rich-text bar is clipped to the
  // painted band and reaches 36px (-8px).
  assert.match(
    mobileCss,
    /\.mobile-pdf-properties--text \.mobile-pdf-properties__color::after,[\s\S]{0,240}inset-block: -8px/,
    'the scrolling rich-text bar is clipped to its painted band, so its pads stop at 36px',
  );
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
