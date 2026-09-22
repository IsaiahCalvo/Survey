import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/*
 * UX CONTRACT (owner rule): a rail is never scrollable.
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
const RAIL_PAD_TOP = px(railPadding.split(/\s+/)[0], '.mobile-pdf-tools padding-top');
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

const DENSE = (() => {
  const body = ruleBody('.mobile-pdf-tools__main:has(.mobile-pdf-tools__subtools):has(.mobile-pdf-tools__survey-categories)');
  assert.ok(
    body,
    'the crowded rail state (a tool sub-strip open together with the survey strips) must '
    + 'tighten its pitch; without it the column overflows 375x812 by 62px and the rail scrolls',
  );
  return {
    gap: px(decl(body, '--rail-pitch-gap'), 'dense --rail-pitch-gap'),
    dividerMargin: px(decl(body, '--rail-divider-margin'), 'dense --rail-divider-margin'),
    subGap: px(decl(body, '--rail-sub-gap'), 'dense --rail-sub-gap'),
    subPad: px(decl(body, '--rail-sub-pad'), 'dense --rail-sub-pad'),
  };
})();

// The dense state must tighten spacing only. A smaller chip is a smaller target.
for (const [key, value] of Object.entries(DENSE)) {
  assert.ok(value <= RELAXED[key], `dense --rail-${key} (${value}px) must not be looser than ${RELAXED[key]}px`);
}
assert.match(
  CSS_BARE,
  /\.mobile-pdf-tools__main:has\(\.mobile-pdf-tools__subtools\):has\(\.mobile-pdf-tools__survey-entities\)/,
  'the dense pitch must also apply when only the entity strip is open beside a sub-strip',
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

const states = () => {
  const relaxed = RELAXED;
  const out = [
    ['nothing open', column(relaxed, head(relaxed)), 178],
    ['region editing rows', column(relaxed, [...head(relaxed), divider(relaxed), regionStrip(relaxed)]), 350],
    [
      'survey category + entity rows',
      column(relaxed, [
        ...head(relaxed),
        divider(relaxed), subStrip(relaxed, SURVEY_CATEGORIES),
        divider(relaxed), subStrip(relaxed, SURVEY_ENTITIES),
      ]),
      416,
    ],
  ];
  const live = { draw: 283, shape: 395, review: 255 };
  const liveDense = { draw: 438, shape: 542, review: 412 };
  for (const [id, tools] of Object.entries(TOOL_GROUPS)) {
    out.push([
      `${id} group open`,
      column(relaxed, [...head(relaxed), divider(relaxed), subStrip(relaxed, tools)]),
      live[id] ?? null,
    ]);
    out.push([
      `${id} group open beside the survey rows`,
      column(DENSE, [
        ...head(DENSE),
        divider(DENSE), subStrip(DENSE, tools),
        divider(DENSE), subStrip(DENSE, SURVEY_CATEGORIES),
        divider(DENSE), subStrip(DENSE, SURVEY_ENTITIES),
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
  assert.equal(BUDGET, 589, `the tool column has ${BUDGET}px on a 375x812 screen`);
  const overflowing = [];
  for (const [name, height, measured] of states()) {
    if (measured !== null) {
      assert.equal(height, measured, `${name}: computed ${height}px but the live rail measured ${measured}px`);
    }
    if (height > BUDGET) overflowing.push(`${name} wants ${height}px of ${BUDGET}px`);
  }
  assert.deepEqual(
    overflowing,
    [],
    'the rail would have to scroll in these states - tighten the pitch for them rather than '
    + `scrolling: ${overflowing.join('; ')}`,
  );
});

test('the tightened state also clears a phone with a 34px home-indicator reserve', () => {
  // An iPhone 17 Pro: 874px tall, 96px of header (34 + a 62px top inset) and a
  // 34px reserve under the dock, so the column gets 557px where a 375x812
  // browser viewport gives it 581px. Measured on the simulator, 2026-09-16.
  const deviceBudget = 874 - 96 - RAIL_PAD_TOP - ((52 + 34) - 6) - FOOTER;
  // 565, not 557: the same 8px the 28px chip hands back (see above).
  assert.equal(deviceBudget, 565);
  const worstGroup = Math.max(...Object.values(TOOL_GROUPS));
  const crowded = column(DENSE, [
    ...head(DENSE),
    divider(DENSE), subStrip(DENSE, worstGroup),
    divider(DENSE), subStrip(DENSE, SURVEY_CATEGORIES),
    divider(DENSE), subStrip(DENSE, SURVEY_ENTITIES),
  ]);
  assert.ok(
    crowded <= deviceBudget,
    `the crowded rail state wants ${crowded}px of the ${deviceBudget}px an iPhone 17 Pro gives it, `
    + 'so the rail scrolls on the device even though it fits a 375x812 viewport',
  );
});

test('the tool rail keeps overflow-y as its safety valve and never scrolls sideways', () => {
  assert.equal(decl(MAIN, 'overflow-y'), 'auto');
  assert.equal(decl(MAIN, 'overflow-x'), 'hidden');
  assert.equal(decl(MAIN, 'overscroll-behavior-x'), 'contain');
});

test('the survey rows are the only unbounded part of the rail, and the limit is stated', () => {
  // Each extra survey row costs a sub-chip plus the dense gap. State where the
  // safety valve takes over so nobody has to rediscover it on a device.
  const worstGroup = Math.max(...Object.values(TOOL_GROUPS));
  const withRows = (rows) => column(DENSE, [
    ...head(DENSE),
    divider(DENSE), subStrip(DENSE, worstGroup),
    divider(DENSE), subStrip(DENSE, Math.ceil(rows / 2)),
    divider(DENSE), subStrip(DENSE, Math.floor(rows / 2)),
  ]);
  let rows = SURVEY_CATEGORIES + SURVEY_ENTITIES;
  assert.ok(
    withRows(rows) <= BUDGET,
    `the rail no longer fits the ${rows} survey rows the test module ships beside an open tool group`,
  );
  while (withRows(rows + 1) <= BUDGET) rows += 1;
  assert.ok(rows >= SURVEY_CATEGORIES + SURVEY_ENTITIES);
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
