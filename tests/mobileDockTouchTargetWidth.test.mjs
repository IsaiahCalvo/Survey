import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mobileCss = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/*
 * UX contract: the two round buttons in the phone's bottom dock (Spaces on the
 * left, Survey on the right) must be a 44px finger target in BOTH directions,
 * not just vertically. tests/mobileDockTouchTarget.test.mjs already pins that a
 * transparent ::after pad exists; this pins that the pad is actually big enough.
 *
 * Why the existing pad falls 2px short. An absolutely positioned ::after is laid
 * out against its offset parent's PADDING box, not its border box. The dock
 * buttons carry `border: 1px solid #2e333c`, so a 30px chip has a 28px padding
 * box. `inset-inline: -7px` therefore yields 28 + 7 + 7 = 42px of target, not
 * the 44px the rule's own comment claims ("Sideways the round buttons grow to
 * 44px").
 *
 * Measured in the app at 375x812 (claude/ux-polish @4d0c3b0d5, Chrome,
 * document open, Arrow armed):
 *   .mobile-pdf-dock__side[0]  painted   x  20 .. 50   (30px)
 *   getComputedStyle(btn, '::after')     width 42px, height 44px
 *   document.elementFromPoint sweep at 0.5px steps, y = 785:
 *     x = 13.5  -> ASIDE.mobile-pdf-tools      (miss)
 *     x = 14.0  -> BUTTON.mobile-pdf-dock__side
 *     x = 55.5  -> BUTTON.mobile-pdf-dock__side
 *     x = 56.0  -> DIV.survey-pdfjs-viewer     (miss)
 *   => 42px of horizontal target, 2px under the 44px minimum.
 * The same arithmetic costs the vertical pad 2px as well: it is 44px at the
 * 10px bottom-inset floor (not the 46px the comment claims) and 68px on an
 * iPhone 17 Pro's 34px inset (not 70px). Height still clears 44, so only the
 * width is pinned here.
 *
 * The fix is one number: `inset-inline: -8px` on .mobile-pdf-dock__side::after
 * gives 28 + 8 + 8 = 44px. Nothing painted changes.
 */

// Every rule whose selector list names this exact element, in source order.
const rulesFor = (selector) => {
  const rules = [];
  for (const [, selectors, body] of mobileCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').some((one) => one.trim() === selector)) rules.push(body);
  }
  return rules;
};

// Last declaration of a property across every rule naming the selector.
const declared = (selector, property) => {
  let raw = null;
  for (const body of rulesFor(selector)) {
    const match = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body);
    if (match) raw = match[1].trim();
  }
  return raw;
};

const px = (raw, what) => {
  assert.ok(raw, `${what} must be declared in mobilePdfViewer.css`);
  const literal = /^(-?\d+(?:\.\d+)?)px$/.exec(raw);
  if (literal) return Number(literal[1]);
  const token = /var\(\s*(--[a-z0-9-]+)/.exec(raw);
  assert.ok(token, `${what} must be a px value or a token: ${raw}`);
  const value = new RegExp(`${token[1]}:\\s*(-?\\d+(?:\\.\\d+)?)px`).exec(mobileCss);
  assert.ok(value, `${token[1]} must be declared in px`);
  return Number(value[1]);
};

// `inset-inline: -7px` or `inset-inline: -7px -9px` -> [start, end].
const insetInline = (selector) => {
  const raw = declared(`${selector}::after`, 'inset-inline');
  assert.ok(raw, `${selector}::after must declare inset-inline`);
  const parts = raw.trim().split(/\s+/);
  const start = px(parts[0], `${selector}::after inset-inline start`);
  const end = parts.length > 1 ? px(parts[1], `${selector}::after inset-inline end`) : start;
  return [start, end];
};

test('.mobile-pdf-dock__side has a 44px-wide touch target, not 42px', () => {
  const painted = px(declared('.mobile-pdf-dock__side', 'width'), '.mobile-pdf-dock__side width');
  const border = px(
    (declared('.mobile-pdf-dock__side', 'border') || '').split(/\s+/)[0] || null,
    '.mobile-pdf-dock__side border width',
  );
  const [start, end] = insetInline('.mobile-pdf-dock__side');

  // The ::after is positioned against the button's padding box.
  const paddingBox = painted - border * 2;
  const target = paddingBox - start - end;

  assert.ok(
    target >= 44,
    `.mobile-pdf-dock__side offers ${target}px of horizontal touch target `
    + `(a ${painted}px chip with a ${border}px border = a ${paddingBox}px padding box, `
    + `plus inset-inline ${start}px/${end}px), which is under the 44px minimum. `
    + 'An absolutely positioned ::after is laid out against the PADDING box, so the '
    + "border eats 2px of the pad the rule's comment budgets for. inset-inline: -8px fixes it.",
  );
});
