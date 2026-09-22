import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/*
 * UX contract (owner ruling 2026-09-17): the phone tool-properties strip paints
 * to the screen edge. No gradient mask, on any variant.
 *
 * The fade this pins out was `mask-image: linear-gradient(to right, #000
 * calc(100% - 20px), rgba(0,0,0,0.15) 100%)` on .mobile-pdf-properties. It sat
 * on the border box while the box carries 48px of empty right padding, so it
 * faded 28px past the furthest a control can be drawn. Measured at 375x812 in
 * the pane, Partial erase armed: scrollWidth 335 == clientWidth 335 (eleven of
 * the twelve strips never overflow), so the gradient bleached only the bar's
 * own fill and its 1px bottom rule - the bar went translucent and lost its
 * bottom edge for the last 20px before the screen edge.
 */

// Every rule whose selector list names .mobile-pdf-properties or one of its
// variants, with comments already stripped.
const stripRules = () => {
  const rules = [];
  for (const [, selectors, body] of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').some((one) => /(^|\s)\.mobile-pdf-properties(--[a-z-]+)?(\s|$|:|>)/.test(one.trim()))) {
      rules.push({ selectors: selectors.trim().replace(/\s+/g, ' '), body });
    }
  }
  return rules;
};

test('the phone tool-properties strip carries no edge fade, on any variant', () => {
  const offenders = stripRules()
    .filter(({ body }) => /(?:^|[;\s-])mask(?:-image)?\s*:/.test(body))
    .map(({ selectors }) => selectors);

  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(' / ')} masks the tool-properties strip. The owner ruled on 2026-09-17 `
    + 'that this bar paints to the screen edge with no fade: the mask sits on the border box, '
    + 'which carries 48px of empty right padding, so it bleaches the bar\'s own fill and its '
    + 'bottom rule rather than an overflowing control. Let the row scroll instead.',
  );
});

/*
 * RULED CHANGE 2026-09-21 (pass 7, boards 1-7: "CENTRED; essentials only; it must
 * NEVER scroll and NEVER clip"). This used to assert the opposite - that the bar
 * scrolls and is start-aligned - because on 2026-09-17 the quick-style chips
 * pushed the Arrow row 269px past a 375px screen and a scroll was the only way
 * back to the far end. The approved boards take those chips off the row, so the
 * widest strip is 328px of controls against 331px of band at 375px, and there is
 * nothing left to scroll to. The reason the fade was banned is unchanged and is
 * now stronger: a fade cannot be hinting at anything on a bar that fits.
 */
test('the strip fits, so it is centred with no scroll path at all', () => {
  const base = stripRules().find(({ selectors }) => selectors === '.mobile-pdf-properties');
  assert.ok(base, '.mobile-pdf-properties rule not found');
  assert.match(base.body, /justify-content:\s*center/);
  assert.match(base.body, /overflow:\s*visible/);
  assert.doesNotMatch(
    base.body,
    /overflow(-x)?:\s*(auto|scroll)/,
    'the strip must not scroll: every strip is measured to fit 375px '
    + '(tests/mobileToolPropertiesReach.test.mjs), and a centred row that scrolls '
    + 'would be back to losing its first control under the tool rail',
  );
});

/*
 * The ONE exception, and the reason it is one: the live rich-text editor's bar is
 * not a tool strip off a board. It carries a colour swatch, a font, a size, four
 * format toggles and an alignment dropdown, which no 331px band holds, so it
 * keeps the start-aligned scroll path its own tests pin.
 */
test('the live text bar keeps its scroll path, because no board shrinks it', () => {
  const text = stripRules().find(({ selectors }) => selectors === '.mobile-pdf-properties--text');
  assert.ok(text, '.mobile-pdf-properties--text rule not found');
  assert.match(text.body, /overflow-x:\s*auto/);
  assert.match(text.body, /justify-content:\s*flex-start/);
});
