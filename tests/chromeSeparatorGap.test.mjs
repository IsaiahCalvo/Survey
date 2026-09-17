/**
 * chromeSeparatorGap.test.mjs — the gutter beside a rule is the same gutter
 * as everywhere else in the row.
 *
 * Intended UX: the desktop document chrome has ONE gap between neighbouring
 * controls, --chrome-gap (4px). The thin vertical rules that separate the
 * Pan/Select block from the tool cluster, and the tool cluster from the tool
 * properties, sit inside that row, so the space either side of a rule must
 * read as the same gutter — not as a wider break that makes one row look like
 * two toolbars pushed together. Reference behaviour matched: Drawboard PDF,
 * whose tool strip holds one constant gutter across its whole width and puts
 * no extra air around its separators.
 *
 * The defect this guards (measured 2026-09-16 on claude/ux-polish, in the
 * browser at an emulated 1440x900, Rectangle tool armed):
 *
 *   Undo -> Redo                  4px
 *   Pan -> Rectangle Select       4px
 *   Rectangle Select -> Draw     17px   <-- 1px rule, 8px of gutter each side
 *   Draw -> Shapes                4px
 *   Shapes -> Text                4px
 *   Text -> Colour swatch        17px   <-- 1px rule, 8px of gutter each side
 *   Colour -> Width               4px
 *   Width -> Style                4px
 *
 * Cause: the separator <div> keeps its pre-token `margin: '0 4px'`, and that
 * margin now lands ON TOP of the row's new `gap: var(--chrome-gap)`. 4 + 4 = 8,
 * exactly double the gap used between every other pair of controls in the same
 * row. The sizing pass moved every other number onto the token and left this
 * one behind.
 *
 * Fix: let the row's own gap do the spacing (`margin: 0`), or express the
 * separator's margin with the shared token so the two can never disagree. Do
 * not re-pin a literal here — the point of the token is that one edit moves
 * the whole row.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_SHELL = readFileSync(path.join(repoRoot, 'src/AppShell.jsx'), 'utf8');

// The thin vertical rules inside the desktop top bar. --border-strong is that
// row's own rule colour.
// DELIBERATE ASSERTION CHANGE (2026-09-17, revision-2 palette approved by the
// owner): the rules were the literal #5a6473 and are the shared --border-strong
// token now. The old literal's own comment said it was "that row's own rule
// colour", which is exactly the drift the palette removes: a rule is a rule.
// rule colour — the #2a3140 rules further down the file belong to other
// surfaces and are not part of this row.
const CHROME_RULES = [...APP_SHELL.matchAll(/<div style=\{\{[^}]*background: 'var\(--border-strong\)'[^}]*\}\} \/>/g)]
  .map((m) => m[0]);

test('the desktop top bar still has the separators this test is about', () => {
  assert.ok(
    CHROME_RULES.length >= 2,
    `expected the top bar's vertical rules to still be there, found ${CHROME_RULES.length}`,
  );
});

test('a chrome separator adds no margin of its own on top of the row gap', () => {
  for (const rule of CHROME_RULES) {
    const margin = /margin: '([^']*)'/.exec(rule)?.[1];
    if (margin === undefined) continue; // no margin at all is the ideal case
    assert.ok(
      !/^0 \d+px$/.test(margin),
      'a top-bar separator sits in a flex row whose gap is already '
      + `var(--chrome-gap), so its own \`margin: '${margin}'\` is added to that gap and the `
      + 'gutter beside the rule comes out at 8px against the 4px used between every '
      + `other pair of controls in the same row. Rule: ${rule}`,
    );
  }
});

test('a chrome separator that keeps a margin spells it with the shared gap token', () => {
  for (const rule of CHROME_RULES) {
    const margin = /margin: '([^']*)'/.exec(rule)?.[1];
    if (margin === undefined || margin === '0' || margin === '0px') continue;
    assert.match(
      margin,
      /var\(--chrome-gap/,
      'a separator that does keep a horizontal margin must read it from '
      + `--chrome-gap so it can never drift from the row's own gap; found '${margin}'`,
    );
  }
});
