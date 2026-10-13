import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/*
 * UX CONTRACT (owner rule): a rail is never scrollable.
 *
 * RULED CHANGE 2026-10-01 (owner, phone survey mode): "opening a tool group
 * squeezes the categories together - it must not; if the rail runs out of room
 * it should scroll rather than compress". The rail keeps ONE pitch in every
 * state now. Every state WITHOUT the survey strips still has to fit 375x812
 * without scrolling; a tool group's sub-strip open beside the survey category /
 * entity strips is allowed to scroll the column instead of tightening it.
 *
 * The phone tool rail keeps `overflow-y: auto` as a safety valve - the survey
 * category and entity strips are built from template DATA, so no fixed pitch can
 * promise a fit for every template - but every state the app can put the rail in
 * with a bounded number of chips has to fit a 375x812 phone without scrolling.
 * This test does that arithmetic from the stylesheet's own tokens and the tool
 * lists in MobilePdfViewerChrome.jsx, so adding a tool to a group, or loosening a
 * gap, fails here instead of silently making the rail scroll.
 *
 * MEASURED 2026-09-16 in the Browser pane at 375x812 and on the iPhone 17 Pro
 * simulator, with prog-07-form-fields.pdf open and (for the survey rows) the
 * Security / Instillation module active - 2 categories, 5 entities.
 * `.mobile-pdf-tools__main` scrollHeight / clientHeight:
 *
 *                          claude/ux-polish      pass 7 (28px chips)
 *   nothing open                188 / 547        178 / 589
 *   Draw open                   293 / 547        283 / 589
 *   Shapes open                 405 / 547        395 / 589
 *   Text open                   265 / 547        255 / 589
 *   region editing rows         360 / 547        350 / 589
 *   survey rows                 426 / 547        416 / 589
 *   survey rows + Draw          473 / 547        438 / 589
 *   survey rows + Shapes        643 / 547        542 / 589   <- scrolled 96px
 *   survey rows + Text          447 / 547        412 / 589
 *   More menu open              188 / 547        178 / 589
 *
 * RULED CHANGE 2026-09-21 (pass 7, board 1: "rail 36px wide, chips 28px"). Every
 * height in the right-hand column is 10px shorter than it was, and the budget is
 * 8px taller, for the same reason: a rail chip is 28px where it was 30, so each
 * of the five head chips takes 2px less and the four footer chips hand 8px back.
 * The states are RE-COMPUTED from the tokens here and the two that matter most
 * were re-measured in the browser pane at 375x812 (nothing open, Shapes open).
 * Nothing about the rail's arrangement changed: no control moved, and the one
 * state that has to tighten its pitch still does.
 *
 * An iPhone 17 Pro is 402x874 with a 34px home-indicator reserve instead of the
 * 10px floor a 375x812 browser viewport reports, so its column gets 557px, not
 * 581px. The tightened state (552px) is the one that had to clear that too, and
 * does; the test's own budget stays the brief's 375x812.
 *
 * Two changes got the last row to fit, neither of which moves or resizes a
 * control:
 *   1. the rail reserved 34px at the bottom that nothing painted in, because the
 *      footer was pushed down by `transform: translateY(34px)`. The transform is
 *      gone and the rail's bottom inset is 34px smaller, so the column's budget
 *      is 581px instead of 547px and the four footer chips paint at exactly the
 *      same four y positions (622 / 651 / 683 / 718, checked chip by chip).
 *   2. when a tool group's sub-strip is open AT THE SAME TIME as the survey
 *      strips - 19 chips in three stacked strips - the column tightens its pitch
 *      (gaps, divider margins and strip padding; never a chip) instead of
 *      scrolling.
 */

const CSS = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');
const CHROME = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
const CSS_BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector list contains `selector`. */
const ruleBody = (selector) => {
  for (const [, selectors, body] of CSS_BARE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').some((one) => one.trim() === selector)) return body;
  }
  return null;
};

const decl = (body, property) => {
  assert.ok(body, `missing rule while reading ${property}`);
  const match = new RegExp(`(?:^|[;\\n])\\s*${property}\\s*:\\s*([^;]+)`).exec(body);
  return match ? match[1].trim() : null;
};

const token = (name) => {
  const match = new RegExp(`${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(CSS_BARE);
  assert.ok(match, `${name} must be declared in px on :root`);
  return Number(match[1]);
};

const px = (value, what) => {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(String(value).trim());
  assert.ok(match, `${what} must be a plain px value, got ${value}`);
  return Number(match[1]);
};

// ---------------------------------------------------------------- the screen

const VIEWPORT = { width: 375, height: 812 };

// The header is the mobile viewer's only top-inset consumer; a 375x812 browser
// or PWA viewport reports no inset, so the rail starts right below its 34px.
const HEADER = px(
  /^calc\((\d+px)\s*\+\s*var\(--native-safe-area-top/.exec(decl(ruleBody('.mobile-pdf-header'), 'height'))?.[1],
  '.mobile-pdf-header height',
);
assert.equal(HEADER, 34);

// --mobile-viewer-dock-height: calc(52px + max(10px, <safe area>)); with no
// device inset the max() floor of 10px applies.
const DOCK = (() => {
  const dock = /--mobile-viewer-dock-height:\s*calc\((\d+)px\s*\+\s*var\(--mobile-bottom-inset\)\)/.exec(CSS_BARE);
  const inset = /--mobile-bottom-inset:\s*max\((\d+)px/.exec(CSS_BARE);
  assert.ok(dock && inset, 'the dock height and bottom inset tokens must stay a calc of two px values');
  return Number(dock[1]) + Number(inset[1]);
})();
assert.equal(DOCK, 62);

const railPadding = decl(ruleBody('.mobile-pdf-tools'), 'padding');
// RULED CHANGE 2026-09-30 (owner: "the top bar spans the full width and the
// left rail sits below it ... when the top bar is not shown the rail grows
// upward, but its icons stay exactly where they are"). The tool strip lies over
// the top of the rail now, so the rail's top inset is its old 7px PLUS the
// strip's painted band, always - whether or not a strip is up - which is what
// keeps the chips from moving. The column loses that band from its budget.
const STRIP_BAND = token('--mobile-strip-band-h');
assert.equal(STRIP_BAND, 36);
const RAIL_PAD_TOP = (() => {
  const match = /^calc\((\d+)px\s*\+\s*var\(--mobile-strip-band-h\)\)/.exec(railPadding);
  assert.ok(match, `the rail's top inset must be its own px plus the strip band (found: ${railPadding})`);
  return Number(match[1]) + STRIP_BAND;
})();
assert.equal(RAIL_PAD_TOP, 43);
const RAIL_PAD_BOTTOM = (() => {
  const match = /calc\(var\(--mobile-viewer-dock-height\)\s*([-+])\s*(\d+)px\)/.exec(railPadding);
  assert.ok(
    match,
    'the rail\'s bottom inset must stay expressed against --mobile-viewer-dock-height so it '
    + `tracks the safe area (found: ${railPadding})`,
  );
  return DOCK + (match[1] === '-' ? -Number(match[2]) : Number(match[2]));
})();

// The footer is four rail chips: More, then the stack of sync / history / users.
const CHIP = token('--mobile-rail-chip');
const GAP = token('--mobile-rail-gap');
const FOOTER = (() => {
  const stack = ruleBody('.mobile-pdf-tools__footer-stack');
  const marginTop = px(decl(stack, 'margin-top'), 'footer stack margin-top');
  assert.equal(decl(stack, 'gap'), 'var(--mobile-rail-gap)');
  const stackChips = 3;
  return CHIP + marginTop + stackChips * CHIP + (stackChips - 1) * GAP;
})();
// RULED CHANGE 2026-09-21 (pass 7, board 1: "rail 36px wide, chips 28px"). 126,
// not 134: the footer is four rail chips and a 4px margin, so it shrank by
// exactly the 4 x 2px the chip token lost. Derived from the token either way.
assert.equal(FOOTER, 126);

// A footer pushed down by a transform makes the rail reserve space nothing
// paints in, and caps the column that far short of the screen.
assert.equal(
  decl(ruleBody('.mobile-pdf-tools__footer'), 'transform'),
  null,
  'the rail footer must not carry a translate: the space it is pushed out of is '
  + 'space the tool column above it can never use, which is what made the rail scroll',
);

/** How tall the tool column can be before `overflow-y: auto` has to kick in. */
const BUDGET = VIEWPORT.height - HEADER - RAIL_PAD_TOP - RAIL_PAD_BOTTOM - FOOTER;

// ------------------------------------------------------------------ the pitch

const MAIN = ruleBody('.mobile-pdf-tools__main');
const MAIN_PAD = px(decl(MAIN, 'padding-block'), 'tool column padding-block');
const SUB_CHIP = token('--mobile-rail-sub-chip');
// RULED CHANGE 2026-09-22: the survey strips draw 24px letter/colour DISCS, which
// are not the sub-tool chip and did not move with it. Their own token, so this
// arithmetic keeps describing what the rail actually paints.
const SURVEY_DISC = token('--mobile-rail-disc');
const SUB_STRIP_BORDER = 1; // 1px all round on every sub-strip

const tokenDefault = (body, name) => {
  const match = new RegExp(`${name}:\\s*([^;]+)`).exec(body);
  assert.ok(match, `${name} must be declared on the tool column`);
  const raw = match[1].trim();
  if (/^var\(/.test(raw)) return token(/var\(\s*(--[a-z0-9-]+)/.exec(raw)[1]);
  return px(raw, name);
};

const RELAXED = {
  gap: tokenDefault(MAIN, '--rail-pitch-gap'),
  dividerMargin: tokenDefault(MAIN, '--rail-divider-margin'),
  subGap: tokenDefault(MAIN, '--rail-sub-gap'),
  subPad: tokenDefault(MAIN, '--rail-sub-pad'),
};

// RULED CHANGE 2026-10-01: no state tightens the pitch any more. The crowded
// state (a tool sub-strip open beside the survey strips) used to override the
// four --rail-* tokens, which squeezed every chip - the survey discs included -
// closer together while a group was open. Nothing may override them now.
for (const name of ['--rail-pitch-gap', '--rail-divider-margin', '--rail-sub-gap', '--rail-sub-pad']) {
  const declared = [...CSS_BARE.matchAll(new RegExp(`${name}\\s*:`, 'g'))].length;
  assert.equal(declared, 1, `${name} must be declared once (on the tool column) - a second declaration re-tightens the rail in some state`);
}
assert.doesNotMatch(
  CSS_BARE,
  /\.mobile-pdf-tools__main:has\(/,
  'the tool column must not change its pitch depending on what it contains',
);

// Every chip's hit pad follows the live gap, so tightening it never overlaps two
// pads (an overlap steals the neighbour's taps).
assert.match(CSS_BARE, /inset-block: calc\(var\(--rail-pitch-gap, var\(--mobile-rail-gap\)\) \/ -2\)/);
assert.match(CSS_BARE, /inset-block: calc\(var\(--rail-sub-gap, var\(--mobile-rail-sub-gap\)\) \/ -2\)/);

// ----------------------------------------------------------------- the states

const divider = (pitch) => 1 + 2 * pitch.dividerMargin;

/** A boxed sub-strip: n chips of `chip`, plus any extra items already in px. */
const subStrip = (pitch, n, { chip = SUB_CHIP, extras = [] } = {}) => {
  const items = [...Array(n).fill(chip), ...extras];
  return 2 * pitch.subPad + 2 * SUB_STRIP_BORDER
    + items.reduce((a, b) => a + b, 0)
    + (items.length - 1) * pitch.subGap;
};

const column = (pitch, items) => items.reduce((a, b) => a + b, 0)
  + (items.length - 1) * pitch.gap
  + 2 * MAIN_PAD;

// The rail's own tool lists, read from the component so a new tool shows up here.
const TOOL_GROUPS = (() => {
  const source = /const TOOL_GROUPS = \{([\s\S]*?)\n\};/.exec(CHROME);
  assert.ok(source, 'TOOL_GROUPS must stay a literal in MobilePdfViewerChrome.jsx');
  const groups = {};
  for (const [, id, body] of source[1].matchAll(/(\w+):\s*\{([\s\S]*?)\n  \},/g)) {
    groups[id] = (body.match(/\{\s*id:\s*'/g) || []).length;
  }
  assert.ok(Object.keys(groups).length >= 3, `expected the three tool groups, parsed ${JSON.stringify(groups)}`);
  return groups;
})();

/** Pan, the Select family, the divider, then one chip per tool group. */
const head = (pitch) => [CHIP, CHIP, divider(pitch), ...Object.keys(TOOL_GROUPS).map(() => CHIP)];

// The region strip: 3 region tools, an inner divider, 2 selection modes.
const regionStrip = (pitch) => subStrip(pitch, 5, { extras: [divider(pitch)] });

// The survey strips, at the counts the Security / Instillation module ships.
const SURVEY_CATEGORIES = 2;
const SURVEY_ENTITIES = 5;
/** A survey strip: the same box, but its rows are 24px discs, not sub-tool chips. */
const surveyStrip = (pitch, n) => subStrip(pitch, n, { chip: SURVEY_DISC });

const states = () => {
  const relaxed = RELAXED;
  const out = [
    ['nothing open', column(relaxed, head(relaxed)), 178],
    ['region editing rows', column(relaxed, [...head(relaxed), divider(relaxed), regionStrip(relaxed)]), 370],
    [
      'survey category + entity rows',
      column(relaxed, [
        ...head(relaxed),
        divider(relaxed), surveyStrip(relaxed, SURVEY_CATEGORIES),
        divider(relaxed), surveyStrip(relaxed, SURVEY_ENTITIES),
      ]),
      416,
    ],
  ];
  // RULED CHANGE 2026-09-22 (owner, phone build: one chip size on the phone). A
  // sub-tool chip is 28px where it was 24, so every state with a tool sub-strip
  // open is taller by 4px per chip in that strip: Draw 283 -> 295 (3 chips),
  // Shapes 395 -> 423 (7), Text 255 -> 263 (2), the region strip 350 -> 370 (5).
  // Re-measured live at 390x844 (Playwright, mobile UA + touch) for Draw, Shapes
  // and Text. "Nothing open" and the survey rows are unchanged, because neither
  // contains a sub-tool chip.
  // The three crowded states were recomputed from the same tokens rather than
  // re-measured (they need a survey module loaded): Draw 438 -> 437, Shapes
  // 542 -> 553, Text 412 -> 408. They do not all grow, because the crowded state
  // also gave up its sub-strip padding and half its gap to stay inside the
  // 565px an iPhone 17 Pro allows. This arithmetic reproduced all six of the
  // previously recorded live numbers to the pixel before the change, which is
  // what makes recomputing them trustworthy.
  const live = { draw: 295, shape: 423, review: 263 };
  // RULED CHANGE 2026-10-01: the same pitch as every other state (no dense
  // override), re-measured live at 390x844 with 2 categories + 5 entities:
  // Draw 533, Shapes 661, Text 501 (scrollHeight of the tool column).
  const liveDense = { draw: 533, shape: 661, review: 501 };
  for (const [id, tools] of Object.entries(TOOL_GROUPS)) {
    out.push([
      `${id} group open`,
      column(relaxed, [...head(relaxed), divider(relaxed), subStrip(relaxed, tools)]),
      live[id] ?? null,
    ]);
    out.push([
      `${id} group open beside the survey rows`,
      column(RELAXED, [
        ...head(RELAXED),
        divider(RELAXED), subStrip(RELAXED, tools),
        divider(RELAXED), surveyStrip(RELAXED, SURVEY_CATEGORIES),
        divider(RELAXED), surveyStrip(RELAXED, SURVEY_ENTITIES),
      ]),
      liveDense[id] ?? null,
    ]);
  }
  return out;
};

test('the phone tool rail fits a 375x812 screen in every bounded state', () => {
  // RULED CHANGE 2026-09-21 (pass 7, board 1: chips 28px): 589, not 581. The
  // footer is four rail chips, so a 2px-smaller chip hands the tool column 8px
  // back. Derived from the tokens; the column only ever gained room.
  // RULED CHANGE 2026-09-30: 553, not 589 - the strip band the rail now keeps
  // free above its first chip (see RAIL_PAD_TOP).
  assert.equal(BUDGET, 553, `the tool column has ${BUDGET}px on a 375x812 screen`);
  const overflowing = [];
  for (const [name, height, measured] of states()) {
    if (measured !== null) {
      assert.equal(height, measured, `${name}: computed ${height}px but the live rail measured ${measured}px`);
    }
    if (height > BUDGET) overflowing.push(`${name} wants ${height}px of ${BUDGET}px`);
  }
  // RULED CHANGE 2026-10-01: only a tool group open beside the survey strips
  // may scroll (owner: scroll rather than compress). Every other state fits.
  assert.deepEqual(
    overflowing.filter((line) => !/beside the survey rows/.test(line)),
    [],
    `the rail would have to scroll in these states: ${overflowing.join('; ')}`,
  );
});

test('a tool group open beside the survey strips scrolls the column instead of compressing it', () => {
  // RULED CHANGE 2026-10-01 (owner): the crowded state keeps the normal pitch,
  // so it can outgrow the screen; the column's overflow-y scroll is how its far
  // end stays reachable. It used to tighten every gap here instead, which is the
  // squeeze the owner reported. Pin the numbers so a change is deliberate.
  const worstGroup = Math.max(...Object.values(TOOL_GROUPS));
  const crowded = column(RELAXED, [
    ...head(RELAXED),
    divider(RELAXED), subStrip(RELAXED, worstGroup),
    divider(RELAXED), surveyStrip(RELAXED, SURVEY_CATEGORIES),
    divider(RELAXED), surveyStrip(RELAXED, SURVEY_ENTITIES),
  ]);
  assert.equal(crowded, 661);
  // The survey discs keep their pitch whether or not the group is open.
  assert.equal(RELAXED.subGap, token('--mobile-rail-sub-gap'));
  assert.equal(RELAXED.gap, token('--mobile-rail-gap'));
});

test('the tool rail keeps overflow-y as its safety valve and never scrolls sideways', () => {
  assert.equal(decl(MAIN, 'overflow-y'), 'auto');
  assert.equal(decl(MAIN, 'overflow-x'), 'hidden');
  assert.equal(decl(MAIN, 'overscroll-behavior-x'), 'contain');
});

test('the survey rows alone fit the screen at the normal pitch', () => {
  // With no tool group open, the module the test ships (2 categories + 5
  // entities) fits without scrolling; past that the rows are data and the
  // column's overflow-y scroll takes over.
  const withRows = (rows) => column(RELAXED, [
    ...head(RELAXED),
    divider(RELAXED), surveyStrip(RELAXED, Math.ceil(rows / 2)),
    divider(RELAXED), surveyStrip(RELAXED, Math.floor(rows / 2)),
  ]);
  assert.ok(withRows(SURVEY_CATEGORIES + SURVEY_ENTITIES) <= BUDGET);
});

test('the More menu is a popover, so opening it cannot change the rail column', () => {
  const popover = ruleBody('.mobile-pdf-tools__popover');
  assert.match(
    String(decl(popover, 'position')),
    /fixed|absolute/,
    'the More menu must stay out of flow, or opening it would push the rail into scrolling',
  );
  // Measured at 375x812: the open menu occupies x 43..288, y 548..670 - fully on
  // screen, and the column still reports 188 / 581.
});
