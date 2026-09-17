import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * ADVERSARIAL VERIFICATION (verify-pal-final, 2026-09-17), against
 * claude/palette-final @ 28775f301.
 *
 * The repair pass fixed the six defects the desktop lane found (D1 Bookmarks
 * "Edit", D2 "Create category", D3 the gold account button and its two text
 * hovers, D5 --success on the two Survey answer controls, D6 the twenty hex
 * literals) and shipped tests/paletteHoverDeadStates.test.mjs to keep them
 * fixed. All of that was re-measured in the running app and holds.
 *
 * Three things it does NOT cover. Each case below fails on 28775f301.
 *
 *   1. Its CSS-hover case only looks at selector parts that END in ':hover'
 *      (`if (!/:hover$/.test(part)) continue;`). 28 of the 100 :hover selector
 *      parts in src/ do not - `.re-signin-modal__cta:hover:not(:disabled)`,
 *      every `.btn-*:hover:not(:disabled)`, `.pp-thumb-cell:hover .pp-thumb`
 *      and so on. One of those 28 is dead, and it is dead BECAUSE of this pass:
 *        main   base var(--accent-primary, #d8a84e)  hover #5A9FE8
 *        branch base var(--accent)                   hover var(--accent)
 *      Measured in the live cascade at 1440x900: the rule resolves to the same
 *      value at rest and under the pointer, so the re-sign-in modal's primary
 *      button has no hover feedback at all.
 *
 *   2. tokens.css:46-49 says --success "appears on status dots and NOTHING
 *      else: never a button, never a border, never text." The pass took it off
 *      the two Survey answer controls but handed it to the desktop sync chip's
 *      `color`, so the words "Up to date" render in #548c71 at 12px and the dot
 *      is `background: currentColor` off that same inherited colour. Measured
 *      live: a 58x15 text span at rgb(84, 140, 113) on the chip's own
 *      rgb(32, 35, 42) = 4.02:1, where WCAG AA wants 4.50:1 for 12px text.
 *      main's #2bbd7e measured 6.50:1 on the same background.
 *
 *   3. The retired-ramp sweep matched hex notation only. The same colours
 *      survive in rgb()/rgba() form, and the CSS minifier proves it - the
 *      built stylesheet ships `#12151cbd`, `#2a3140d1`, `#12151ca3`,
 *      `#2a3140bd`, `#12151c70`, `#12151c6b` and `#2a3140c7`. Measured live at
 *      375x812: the phone hub header's bottom border paints
 *      rgba(42, 49, 64, 0.72) on a 375x140 element, and
 *      .projects-mobile-iteration-switcher resolves to rgba(18, 21, 28, 0.74)
 *      over rgba(42, 49, 64, 0.82).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(repoRoot, 'src');

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(repoRoot, file);

/* ------------------------------------------------------------------ case 1 */

/*
 * The documented no-ops. A hover rule is allowed to paint nothing only when
 * the code says out loud that the control must not react:
 *   .btn-active:hover              styles.css:1650-1655 explains it in prose
 *                                  and shares one block with the base.
 *   #chrome-sub-toolbar-host ...   same block pattern, and it DOES paint a
 *                                  plate (rgba(255,255,255,0.05)) live, so it
 *                                  is listed only for the file-level pass.
 *   .quick-style__dot.is-current   the current dot keeps its 2px gold ring
 *     :hover .quick-style__dot-fill under the pointer instead of taking the
 *                                  generic white ring - the override IS the
 *                                  intent.
 *   .mobile-pdf-tools__select-     redundant child rule; the parent's own
 *     family:hover .mobile-pdf-    :hover adds an inset accent-press ring,
 *     tools__button                so the control does answer the pointer.
 */
const DELIBERATE_NO_OP_HOVERS = new Set([
  '.btn-active:hover',
  '#chrome-sub-toolbar-host .btn-active:hover:not(:disabled)',
  '.quick-style__dot.is-current:hover .quick-style__dot-fill',
  '.mobile-pdf-tools__select-family:hover .mobile-pdf-tools__button',
]);

const PAINTS = /^(background|background-color|background-image|border|border-color|border-top|border-bottom|border-left|border-right|border-top-color|border-bottom-color|border-left-color|border-right-color|box-shadow|color|fill|stroke|opacity|outline|outline-color|text-decoration|text-decoration-color|transform|filter)$/;

function parseRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const rules = [];
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    const declarations = new Map();
    for (const decl of m[2].split(';')) {
      const at = decl.indexOf(':');
      if (at === -1) continue;
      const prop = decl.slice(0, at).trim().toLowerCase();
      if (!PAINTS.test(prop)) continue;
      declarations.set(prop, decl.slice(at + 1).trim().replace(/\s*!important$/, '').replace(/\s+/g, ' '));
    }
    rules.push({ parts: selector.split(',').map((p) => p.trim()), declarations });
  }
  return rules;
}

test('every CSS hover rule paints something new, including the ones whose selector does not end in :hover', () => {
  const offenders = [];
  for (const file of walk(srcRoot, ['.css'])) {
    const rules = parseRules(readFileSync(file, 'utf8'));
    /*
     * What each selector settles on once every rule in the file has spoken.
     * Keyed on the selector with its :not(...) gates removed, because a hover
     * rule is routinely written `.x:hover:not(:disabled)` against a base rule
     * written plainly as `.x` - comparing the two raw strings finds no base
     * and silently passes the rule, which is how the dead one got through.
     */
    const norm = (sel) => sel.replace(/:not\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    const settled = new Map();
    for (const rule of rules) {
      for (const part of rule.parts) {
        const key = norm(part);
        if (!settled.has(key)) settled.set(key, new Map());
        for (const [k, v] of rule.declarations) settled.get(key).set(k, v);
      }
    }
    for (const rule of rules) {
      for (const part of rule.parts) {
        // The fix for the hole: :hover ANYWHERE in the selector, not just at the end.
        if (!part.includes(':hover')) continue;
        if (DELIBERATE_NO_OP_HOVERS.has(part)) continue;
        if (part.includes('::')) continue; // scrollbar thumbs et al: no base rule to compare
        const baseKey = norm(part.replace(/:hover/g, ''));
        if (rule.parts.some((p) => norm(p) === baseKey)) continue; // one shared block = deliberate
        const base = settled.get(baseKey);
        if (!base) continue;
        const hoverDecls = settled.get(norm(part));
        const props = [...hoverDecls.keys()];
        if (!props.length) continue;
        const changes = props.filter((p) => !base.has(p) || base.get(p) !== hoverDecls.get(p));
        if (!changes.length) {
          offenders.push(`${rel(file)}  ${part}  paints only ${props
            .map((p) => `${p}: ${hoverDecls.get(p)}`)
            .join('; ')} - identical to its rest state`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `dead CSS hover rules:\n  ${offenders.join('\n  ')}`);
});

/* ------------------------------------------------------------------ case 2 */

test('--success reaches status dots only - never a chip label, and never an inherited text colour', () => {
  const offenders = [];
  for (const file of walk(srcRoot, ['.js', '.jsx'])) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('--success')) continue;
    /*
     * A dot is an element whose own style sets width, height and a round
     * radius. Anything that hands --success to a shared `color` - which every
     * child inherits, and which a `background: currentColor` dot reads back -
     * is the chip's TEXT colour too, which tokens.css forbids outright.
     */
    const paintsTextFromTheSameValue = /^\s*color,\s*$/m.test(source) || /\bcolor:\s*color\b/.test(source);
    source.split('\n').forEach((line, i) => {
      if (!line.includes('--success')) return;
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // prose, not paint
      const isSelfContainedDot = /border-?[Rr]adius/.test(line) && /width/i.test(line) && /height/i.test(line);
      if (isSelfContainedDot) return;
      if (!/^\s*(synced|success)\s*:/.test(line)) return;
      if (!paintsTextFromTheSameValue) return;
      offenders.push(
        `${rel(file)}:${i + 1}  ${line.trim()} - this value is also applied as \`color\`, so the chip's label text renders in --success (#548c71 on rgb(32,35,42) = 4.02:1; WCAG AA wants 4.50:1 at 12px)`
      );
    });
  }
  assert.deepEqual(offenders, [], `--success used beyond status dots:\n  ${offenders.join('\n  ')}`);
});

/* ------------------------------------------------------------------ case 3 */

const RETIRED_RAMP = new Map([
  ['#12151c', [18, 21, 28]],
  ['#181c24', [24, 28, 36]],
  ['#1f2430', [31, 36, 48]],
  ['#2a3140', [42, 49, 64]],
  ['#3a4252', [58, 66, 82]],
  ['#343a45', [52, 58, 69]],
  ['#3c424d', [60, 66, 77]],
  ['#303743', [48, 55, 67]],
  ['#f2f2f2', [242, 242, 242]],
  ['#e8e2d4', [232, 226, 212]],
  ['#a8b0bf', [168, 176, 191]],
  ['#5a6473', [90, 100, 115]],
  ['#1e1e1e', [30, 30, 30]],
  ['#2a2218', [42, 34, 24]],
]);

test('no retired-ramp colour survives in rgb()/rgba() notation in live chrome', () => {
  const offenders = [];
  const rgbCall = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:[,/][^)]*)?\)/g;
  for (const file of walk(srcRoot, ['.css', '.js', '.jsx'])) {
    const source = readFileSync(file, 'utf8');
    source.split('\n').forEach((line, i) => {
      // Prose describing the retired ramp is fine; paint is not.
      if (/^\s*(\/\/|\*|\/\*|\*\/)/.test(line)) return;
      for (const m of line.matchAll(rgbCall)) {
        const triple = [Number(m[1]), Number(m[2]), Number(m[3])];
        for (const [hex, rgb] of RETIRED_RAMP) {
          if (rgb[0] === triple[0] && rgb[1] === triple[1] && rgb[2] === triple[2]) {
            offenders.push(`${rel(file)}:${i + 1}  ${m[0]} is ${hex}  -  ${line.trim().slice(0, 96)}`);
          }
        }
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `retired-ramp colours still painting, written as rgb()/rgba() so the hex sweep missed them:\n  ${offenders.join('\n  ')}`
  );
});
