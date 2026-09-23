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
const STYLES = readFileSync(path.join(repoRoot, 'src/styles.css'), 'utf8');

/*
 * DELIBERATE ASSERTION CHANGE (2026-09-21, pass 7 — owner-approved artboards
 * 8-14). Two things this file asserted have changed, both by ruling:
 *
 *   1. A separator is no longer written inline. Every rule in the three bars is
 *      the shared `.chrome-divider` class, so there is exactly ONE place its
 *      size and its inset are written. That is a stronger version of what this
 *      test was for, so the test now asserts the class and forbids new inline
 *      rules rather than parsing inline styles that no longer exist.
 *   2. The inset either side of a rule is 8px, not the row gap. The boards draw
 *      a 2px gutter between two buttons inside a group and 8px of clear space
 *      either side of the rule BETWEEN groups — that contrast is the only thing
 *      telling the eye where a group ends. The rule this file still protects is
 *      the real one: the inset must come from a token, never from a literal, so
 *      one edit moves every rule in the chrome.
 */
test('every rule in the desktop chrome is the one shared separator', () => {
  const dividers = APP_SHELL.match(/className="chrome-divider"/g) || [];
  assert.ok(
    dividers.length >= 3,
    `expected the three bars' group rules to use .chrome-divider, found ${dividers.length}`,
  );

  // No bar may hand-roll a separator beside the shared one.
  const inlineRules = [...APP_SHELL.matchAll(/<div style=\{\{[^}]*background: 'var\(--border-strong\)'[^}]*\}\} \/>/g)];
  assert.deepEqual(
    inlineRules.map((m) => m[0]),
    [],
    'a separator in the document chrome must be <div className="chrome-divider" />, '
    + 'so its height and its inset are written in exactly one place (styles.css)',
  );
});

test('the shared separator reads its size and inset from the chrome tokens', () => {
  const rule = /\.chrome-divider\s*\{([^}]*)\}/.exec(STYLES)?.[1] ?? '';
  assert.ok(rule, 'styles.css must define .chrome-divider');
  assert.match(rule, /height: var\(--chrome-divider-h\)/);
  assert.match(rule, /margin: 0 var\(--chrome-divider-inset\)/);
  /* CHANGED 2026-09-22 with tokens.css revision 4, and the reason is a change
     of MEANING, not a relaxation. --border-strong used to mean "an edge that
     has to be seen"; the owner's ruling redefined it as "the edge that is the
     only thing identifying a CONTROL" (a field, an outlined button, a
     checkbox, a focus ring) and put "cards, panels, dividers and rows" on the
     subtle --border. A separator between two tool groups identifies no
     control, so pinning it to the identifying token now asserts the opposite
     of the rule. The assertion still pins the divider to ONE token so a bar
     cannot hand-roll its own colour — only which token that is has moved. */
  assert.match(rule, /background: var\(--border\)/);
  assert.match(STYLES, /--chrome-divider-h: 16px;/);
  assert.match(STYLES, /--chrome-divider-inset: 8px;/);
  /* CHANGED 2026-09-22 (desktop critic round, owner's desktop numbers): the
     gutter between chips is 6px, not 2px. This file's original point — one
     gutter across the whole bar — is what the change restores: pass 7's 2px
     tool gutter against the 6px pill gutter put THREE spacings in one 36px bar
     and made it read as two strips. The owner's desktop set is chip 28 / icon
     16 / gap 6 / divider margin 8, and DESIGN-SYSTEM.md lists one desktop gap,
     6. The assertion still pins the value so no bar can hand-roll its own. */
  assert.match(STYLES, /--chrome-tool-gap: 6px;/);
});
