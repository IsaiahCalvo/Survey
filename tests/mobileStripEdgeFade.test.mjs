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

test('the strip still scrolls, so nothing needs a fade to hint at it', () => {
  const base = stripRules().find(({ selectors }) => selectors === '.mobile-pdf-properties');
  assert.ok(base, '.mobile-pdf-properties rule not found');
  assert.match(base.body, /overflow-x:\s*auto/);
  assert.match(base.body, /justify-content:\s*flex-start/);
});
