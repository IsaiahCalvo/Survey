import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * Phone sizing pass (owner ruling 2026-09-16: "everything is a little big — use
 * Drawboard's ratios as the page, uniformly, and never move or add a control").
 * Reference numbers come from Drawboard PDF measured on an iPhone the same day:
 * rail 40.4pt wide with a 34.7pt pitch and ~28pt chips, top-bar control row
 * 27-30pt, bottom bar 59-70pt with 24-33pt controls.
 *
 * These assertions guard the shape of the rule, not a taste: one token per tier,
 * every control reading its token, and the two arrangements that were visibly
 * wrong before (a rail that scrolled sideways, dock buttons hanging outside the
 * bar they belong to).
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/mobile/mobilePdfViewer.css');
const chrome = read('../src/mobile/MobilePdfViewerChrome.jsx');

// Pull one declaration block so a size assertion can't be satisfied by an
// unrelated rule elsewhere in the sheet. `skip` steps over earlier rules that
// share the selector text (a grouped selector, or a second rule for the same
// element).
const block = (source, selector, skip = 0) => {
  let at = -1;
  for (let i = 0; i <= skip; i += 1) {
    at = source.indexOf(`${selector} {`, at + 1);
    assert.notEqual(at, -1, `missing rule ${skip ? `#${skip + 1} ` : ''}for ${selector}`);
  }
  const open = source.indexOf('{', at);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
};

/*
 * RULED CHANGE 2026-09-21 (pass 7). The owner approved a board per tool and the
 * boards restate every phone number, so five of the nine tokens below moved:
 *   --mobile-rail-w          40 -> 36   board 1 ("rail 36px wide")
 *   --mobile-rail-chip       30 -> 28   board 1 ("chips 28px / icon 17px")
 *   --mobile-control-h       26 -> 28   board 1 (28px header controls)
 *   --mobile-strip-control-h 24 -> 20   boards 1-7 ("controls 20px")
 *   --mobile-strip-dropdown-w 80 -> 72  DESIGN-SYSTEM.md ("Line-width pill: 72px")
 * What this test guards is unchanged: ONE token per tier, and every control
 * reading its token rather than inventing a size.
 */
test('one token per tier drives every phone control size', () => {
  const root = block(css, ':root');
  for (const token of [
    '--mobile-rail-w: 36px',
    '--mobile-rail-chip: 28px',
    '--mobile-rail-gap: 5px',
    '--mobile-rail-sub-chip: 24px',
    '--mobile-rail-sub-gap: 4px',
    '--mobile-control-h: 28px',
    '--mobile-strip-control-h: 20px',
    '--mobile-strip-dropdown-w: 72px',
    '--mobile-dock-control-h: 30px',
  ]) assert.match(root, new RegExp(token.replace(/[-]/g, '\\-')));

  // 28px chip + 5px gap = a 33px pitch.
  assert.match(block(css, '.mobile-pdf-tools'), /width: var\(--mobile-rail-w\)/);
  assert.match(block(css, '.mobile-pdf-tools__button'), /width: var\(--mobile-rail-chip\)/);
  // RULED CHANGE 2026-09-16 (r5 phone pass): the column reads its pitch through
  // one indirection - --rail-pitch-gap / --rail-sub-gap - whose default IS the
  // tier token, so "one token per tier" is unchanged. The indirection exists so
  // the single rail state that cannot fit a phone (a tool sub-strip open beside
  // the survey rows) can tighten the whole pitch in one rule instead of
  // scrolling; see tests/mobileRailFitsEveryState.test.mjs. Both halves are
  // asserted: the column reads the indirection, and the indirection defaults to
  // the tier token.
  assert.match(block(css, '.mobile-pdf-tools__main'), /gap: var\(--rail-pitch-gap\)/);
  assert.match(block(css, '.mobile-pdf-tools__main'), /--rail-pitch-gap: var\(--mobile-rail-gap\)/);
  assert.match(block(css, '.mobile-pdf-tools__main'), /--rail-sub-gap: var\(--mobile-rail-sub-gap\)/);
  assert.match(block(css, '.mobile-pdf-tools__subtools'), /gap: var\(--rail-sub-gap, var\(--mobile-rail-sub-gap\)\)/);
});

test('the rail cannot scroll sideways: no chip is wider than the rail', () => {
  // The rail has no side padding and the chip is 10px narrower than the rail,
  // so nothing sticks out past its edge. Before this pass a 44px chip sat in a
  // 44px rail with 4px of padding and the column reported 6px of side scroll.
  // RULED CHANGE 2026-09-16 (r5 phone pass): the bottom inset is the dock less
  // 6px, not the dock plus 28px. The footer used to be pushed down 34px by its
  // own transform, so the rail reserved 34px that nothing painted in and capped
  // the tool column 34px short. The transform is gone and the inset lost the
  // same 34px: the footer paints at exactly the same four y positions (checked
  // chip by chip on the simulator) and the column gets its 34px back. What this
  // test is about - no side scroll - is untouched.
  assert.match(block(css, '.mobile-pdf-tools'), /padding: 7px 0 calc\(var\(--mobile-viewer-dock-height\) - 6px\)/);
  // The hit area is the slot, not the chip, so a smaller square is not a
  // smaller target.
  assert.match(css, /\.mobile-pdf-tools__main > \.mobile-pdf-tools__button::after[\s\S]{0,400}inset-inline: -4px/);
  assert.match(css, /\.mobile-pdf-tools__subtools \.mobile-pdf-tools__button::after[\s\S]{0,300}inset-inline: -3px/);
  // Half-gap padding keeps those hit areas from reporting a stray pixel of
  // scroll on the column itself.
  assert.match(block(css, '.mobile-pdf-tools__main'), /padding-block: 3px/);
});

test('every dock button sits inside the bar, centred, at one size', () => {
  const dock = block(css, '.mobile-pdf-dock');
  // Pad the box by its transparent top gutter and its home-indicator reserve;
  // what is left is the visible bar, so align-items: center centres in the bar.
  // RULED CHANGE 2026-09-17 (owner ruling: "the bottom-dock icons sit too high
  // against the painted bar on web mobile and iOS. Make each button's glyph the
  // vertical centre of the painted bar region a user perceives as the bar").
  // The bottom pad was var(--mobile-bottom-inset) - the WHOLE safe-area inset -
  // which left the chips centred in the top 36px of a bar that is 36px + inset
  // tall: 5px high in a browser, 17px high on an iPhone 17 Pro. It is
  // var(--mobile-dock-reserve) now: the home indicator's own footprint, 0 in a
  // browser and 21px at a 34px inset. The assertion moved with the token; what
  // it guards - the padding is what centres the chips in the bar - is the same.
  // The arithmetic behind both insets is pinned by
  // tests/mobileDockBarCentring.test.mjs.
  assert.match(dock, /padding: 16px 20px var\(--mobile-dock-reserve\)/);
  assert.match(dock, /align-items: center/);
  const side = block(css, '.mobile-pdf-dock__side');
  assert.match(side, /width: var\(--mobile-dock-control-h\)/);
  assert.match(side, /height: var\(--mobile-dock-control-h\)/);
  assert.match(block(css, '.mobile-pdf-dock__center', 2), /height: var\(--mobile-dock-control-h\)/);
  // The 4px nudge that pushed the buttons off the bar is gone.
  assert.doesNotMatch(block(css, '.mobile-pdf-dock__side,\n.mobile-pdf-dock__center', 1), /transform: translateY/);
});

test('the header row is one height and one glyph size, and undo/redo do not move', () => {
  // RULED CHANGE 2026-09-21 (pass 7, board 1: "Header 34px WITHOUT the PDF
  // name"). .mobile-pdf-header__title is gone from the list because the title is
  // gone from the phone header - the document name is the bar's accessible name
  // now, not a pill competing with the page cluster for room.
  for (const selector of [
    '.mobile-pdf-header__icon',
    '.mobile-pdf-header__page-nav',
    '.mobile-pdf-header__page-pill',
  ]) assert.match(block(css, selector), /height: var\(--mobile-control-h\)/);
  assert.doesNotMatch(css, /\.mobile-pdf-header__title \{/, 'the phone header shows no PDF name');

  // RULED CHANGE 2026-09-21: all three header groups sit 4px above the bar's
  // bottom rule, not 6px, because the board's control is 28px in a 34px bar; and
  // the history group's inset is 7px, mirroring the document group's 7px on the
  // left. They still share ONE baseline, which is what this guards.
  assert.match(block(css, '.mobile-pdf-header__document,\n.mobile-pdf-header__history'), /bottom: 4px/);
  assert.match(block(css, '.mobile-pdf-header__pages'), /bottom: 4px/);
  assert.match(block(css, '.mobile-pdf-header__history', 1), /right: 7px/);

  // RULED CHANGE 2026-09-21 (pass 7, board 1: "chips 28px / icon 17px", and the
  // same 17 on every header action). It was 15-in-26 from the 2026-09-16 sweep;
  // the boards fix both numbers at 17-in-28, which is the same 0.61 fill.
  assert.match(chrome, /const HEADER_GLYPH = 17;/);
  assert.match(chrome, /name="undo" size=\{HEADER_GLYPH\}/);
  assert.match(chrome, /name="redo" size=\{HEADER_GLYPH\}/);
  assert.match(chrome, /name="chevronLeft" size=\{HEADER_GLYPH\}/);
});

/*
 * RULED CHANGE 2026-09-21 (pass 7 / DESIGN-SYSTEM.md "Shared controls"). The
 * 2026-09-16 rule was "every strip dropdown is ONE width" (80px). The approved
 * boards give each control its OWN stated width - width 72, line style 92,
 * arrowhead 90, arrow ends 96, counter series 80 - because a pill is sized by the
 * longest label it has to show, and "Dashed" needs more room than "2 pt".
 * So the contract this test guards moves from "one width for all" to "one TOKEN
 * per control, and no control naming a literal": that is what stops a pill
 * drifting between the strip, the sheet and the desktop bar.
 */
test('every strip pill takes its width from its own shared token', () => {
  const root = block(css, ':root');
  for (const token of [
    '--mobile-strip-dropdown-w: 72px',
    '--mobile-strip-linestyle-w: 92px',
    '--mobile-strip-arrowhead-w: 90px',
    '--mobile-strip-arrowends-w: 96px',
    '--mobile-strip-series-w: 80px',
    '--mobile-sheet-field-w: 96px',
  ]) assert.match(root, new RegExp(token.replace(/[-]/g, '\\-')));

  // Every pill on the strip reads a token, never a number.
  for (const [label, token] of [
    ['Line width', '--mobile-strip-dropdown-w'],
    ['Eraser size', '--mobile-strip-dropdown-w'],
    ['Line style', '--mobile-strip-linestyle-w'],
    ['Counter series', '--mobile-strip-series-w'],
  ]) {
    assert.match(
      chrome,
      new RegExp(`ariaLabel="${label}"[\\s\\S]{0,80}width="var\\(${token.replace(/[-]/g, '\\-')}\\)"`),
      `${label} must take its width from ${token}`,
    );
  }

  // One height for every one of them, from the strip's own control token. The
  // leading newline picks the rule whose whole selector is that class, not the
  // first compound selector that happens to end with it.
  assert.match(
    block(css, '\n.mobile-styled-select__trigger'),
    /height: var\(--mobile-strip-control-h\)/,
  );
});

test('rail glyphs come from one constant per tier', () => {
  // RULED CHANGE 2026-09-16 (phone sweep, owner ruling "everything reads a
  // little big; Drawboard's ratios, uniformly"): 0.55-0.60 of the chip on every
  // tier, where these were two thirds of it. Rail 17-in-30, sub-tool 14-in-24,
  // header 15-in-26, dock 17-in-30 — one ratio, all four tiers. The hit pads
  // are untouched, so no target shrank with the glyph.
  assert.match(chrome, /const RAIL_GLYPH = 17;/);
  assert.match(chrome, /const SUBTOOL_GLYPH = 14;/);
  assert.match(chrome, /const DOCK_GLYPH = 17;/);
  // RULED CHANGE 2026-09-21 (pass 7): 12, because the strip control is 20px on
  // the approved boards where it was 24. 12-in-20 is the same fill 14-in-24 was.
  assert.match(chrome, /const STRIP_GLYPH = 12;/);
  assert.match(chrome, /glyph = RAIL_GLYPH/);
  assert.match(chrome, /glyph=\{SUBTOOL_GLYPH\}/);
});
