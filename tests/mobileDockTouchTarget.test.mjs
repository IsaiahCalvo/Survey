import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mobileCss = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/*
 * UX contract: the three buttons in the phone's bottom dock (Spaces, the
 * Pages/Search/Bookmarks pill, Survey) must stay finger-sized — a 44px tap
 * area — even when the painted chip is drawn smaller.
 *
 * Reference behaviour: the left rail, in this same codebase. The 2026-09-16
 * phone sizing pass shrank each rail chip to 30px and, in the same change,
 * gave every chip a transparent ::after that fills its whole slot, with the
 * comment "the chip you SEE is 30px, the area a finger hits is the whole 35px
 * slot ... Without this the smaller chip would also be a smaller target, which
 * is the one thing the phone research said not to do."
 *
 * The dock was shrunk the same way (main: .mobile-pdf-dock__side 44x44 and
 * .mobile-pdf-dock__center 38px tall) but never got the pad, so its buttons
 * really are only 30px of target.
 *
 * Measured on the iPhone 17 Pro simulator (402x874pt, safe-area bottom 34)
 * against claude/ux-polish @6fc9690ef:
 *   .mobile-pdf-dock__surface  y=804 h=70   (the bar you can see)
 *   .mobile-pdf-dock__side[0]  x=20  y=807 w=30 h=30
 *   .mobile-pdf-dock__side[1]  x=352 y=807 w=30 h=30
 *   .mobile-pdf-dock__center   x=139 y=807 w=124 h=30
 * With the viewer open, a tap at (20, 850) — 13px below the button, still
 * inside the painted bar and well inside the 44px target main had — does
 * nothing, while (20, 822) opens Spaces.
 */

// Every rule whose selector list names this exact element, in source order.
const rulesFor = (selector) => {
  const rules = [];
  for (const [, selectors, body] of mobileCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').some((one) => one.trim() === selector)) rules.push(body);
  }
  return rules;
};

const declaredHeight = (selector) => {
  const rules = rulesFor(selector);
  assert.ok(rules.length, `${selector} must be declared in mobilePdfViewer.css`);
  let raw = null;
  for (const body of rules) {
    const match = /(?:^|[;\s])height:\s*([^;]+);/.exec(body);
    if (match) raw = match[1].trim();
  }
  assert.ok(raw, `${selector} must declare a height`);
  const literal = /^(\d+(?:\.\d+)?)px$/.exec(raw);
  if (literal) return Number(literal[1]);
  const token = /var\(\s*(--[a-z0-9-]+)/.exec(raw);
  assert.ok(token, `${selector} height must be a px value or a token: ${raw}`);
  const value = new RegExp(`${token[1]}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(mobileCss);
  assert.ok(value, `${token[1]} must be declared in px`);
  return Number(value[1]);
};

// A transparent pad counts only if it is attached to the button itself and
// reaches outwards, the way the rail chips' pads do.
const hasHitPad = (selector) => rulesFor(`${selector}::after`)
  .some((body) => /inset(?:-block)?:\s*-/.test(body));

// Only the round side buttons are pinned here: those are the two that were a
// full 44x44 on main, so 30px is an outright regression. The centre pill went
// 38px -> 30px in the same pass and deserves the same pad, but it was already
// under 44 before this branch, so it is reported rather than pinned.
for (const selector of ['.mobile-pdf-dock__side']) {
  test(`${selector} keeps a 44px touch target`, () => {
    const painted = declaredHeight(selector);
    if (painted >= 44) return;
    assert.ok(
      hasHitPad(selector),
      `${selector} paints a ${painted}px chip with no transparent ::after pad, so the tap `
      + 'target is only ' + painted + 'px. Either keep the chip at 44px or add the pad the '
      + 'rail chips use (.mobile-pdf-tools__button::after).',
    );
  });
}
