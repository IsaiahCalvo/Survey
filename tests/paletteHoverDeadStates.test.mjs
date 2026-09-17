import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * ADVERSARIAL VERIFICATION (verify-pal-desktop, 2026-09-17).
 *
 * claude/palette-v2 ships tests/paletteAccentTextMisuse.test.mjs with a case
 * called "no hover handler paints the same value on enter and on leave". That
 * case PASSES on the branch, and yet the branch ships hover handlers that do
 * exactly what the name forbids. The guard has two holes:
 *
 *   HOLE 1 - the all-or-nothing predicate. It flags a handler only when EVERY
 *   setter matches (`enters.every((v, i) => v === leaves[i])`). A handler with
 *   two branches - one dead, one live - therefore escapes. That is the Bookmarks
 *   "Edit" button: its `!isEditMode` branch paints --surface-3 on enter AND on
 *   leave, while its `isEditMode` branch differs, so `every` returns false.
 *
 *   HOLE 2 - the proximity window. It only compares a pair when
 *   `leaveAt - (at + enterBody.length) < 40`. That distance is raw characters
 *   INCLUDING the JSX indentation, and it is additionally off by 13 because
 *   `at` points at the word `onMouseEnter` rather than at the `{` that
 *   `handlerBody` measures from. SurveySpacesRail is indented ~36 columns, so
 *   its "Create category" button computes a window of 50 and is skipped whole -
 *   even though BOTH of its setters are identical on enter and on leave.
 *
 * Both handlers HAD working hover on main and lost it in the tokenisation pass:
 *   Bookmarks "Edit"    main #2a3140 -> #3a4252 -> #2a3140  branch: --surface-3 throughout
 *   "Create category"   main #1f2430 -> #2a3140 -> #1f2430  branch: --surface-3 throughout
 *                       main border #d8a84e -> #5AA0F2      branch: --accent throughout
 * Verified in the running app at 1440x900: the Edit button reads
 * rgb(43, 48, 59) at rest, on hover and after leave.
 *
 * This file compares hover handlers BRANCH BY BRANCH and does not skip on
 * indentation, so neither hole can hide a dead state.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
};

const walkCss = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkCss(full, out);
    else if (/\.css$/.test(entry)) out.push(full);
  }
  return out;
};

/** The balanced {...} body of the JSX prop whose name starts at `at`. */
const handlerBody = (source, at) => {
  const open = source.indexOf('{', source.indexOf('=', at));
  if (open === -1) return { body: '', end: at };
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: source.slice(open, i + 1), end: i };
    }
  }
  return { body: '', end: at };
};

const SETTER = /style\.(background|backgroundColor|borderColor)\s*=\s*'([^']+)'/g;

/**
 * Every (property, value) a handler can paint, in source order. Unlike the
 * branch's guard this keeps each branch of an if/else or a ternary separately,
 * so a handler that is dead in ONE state is still caught.
 */
const paints = (body) => [...body.matchAll(SETTER)].map((m) => `${m[1]}=${m[2]}`);

test('no hover handler paints its resting colour on enter (per branch, any indentation)', () => {
  const offenders = [];

  for (const file of walk(path.join(repoRoot, 'src'))) {
    const source = readFileSync(file, 'utf8');
    let at = source.indexOf('onMouseEnter');
    while (at !== -1) {
      const enter = handlerBody(source, at);
      const leaveAt = source.indexOf('onMouseLeave', enter.end);
      // The leave must be the next prop on this element. Measured in
      // NON-WHITESPACE characters so indentation depth cannot exempt a handler.
      const between = leaveAt === -1 ? '' : source.slice(enter.end + 1, leaveAt);
      if (leaveAt !== -1 && between.replace(/\s/g, '').length < 4) {
        const leave = handlerBody(source, leaveAt);
        const enters = paints(enter.body);
        const leaves = paints(leave.body);
        // Pair branch i of enter with branch i of leave. A control whose enter
        // and leave paint the same value in the SAME branch has no hover.
        const dead = enters.filter((v, i) => leaves[i] === v);
        if (dead.length) {
          const line = source.slice(0, at).split('\n').length;
          offenders.push(
            `${path.relative(repoRoot, file)}:${line} -> ${dead.join(', ')} `
            + `(enter [${enters.join(' | ')}] / leave [${leaves.join(' | ')}])`,
          );
        }
      }
      at = source.indexOf('onMouseEnter', at + 1);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} hover handler branch(es) paint the resting colour on enter, so the `
    + `control gives no hover feedback at all:\n  ${offenders.join('\n  ')}`,
  );
});

test('a gold control hovers to --accent-light, never back to --accent', () => {
  // tokens.css: "A gold control's own states are --accent-light (hover) and
  // --accent-press (pressed)." --accent-light exists for exactly this and is
  // unused by .account-btn-purple, whose :hover repaints the base --accent.
  const css = readFileSync(path.join(repoRoot, 'src/components/AccountSettings.css'), 'utf8');
  const base = /\.account-btn-purple\s*\{[^}]*background:\s*([^;]+);/.exec(css);
  const hover = /\.account-btn-purple:hover\s*\{[^}]*background:\s*([^;]+);/.exec(css);
  assert.notEqual(base, null, 'missing .account-btn-purple');
  assert.notEqual(hover, null, 'missing .account-btn-purple:hover');
  assert.notEqual(
    hover[1].trim(),
    base[1].trim(),
    `.account-btn-purple:hover repaints its own resting fill (${base[1].trim()}), so the `
    + 'primary gold button in account settings has no hover. On main it lifted '
    + '#d8a84e -> #e3b863; --accent-light (#edc26d) is the token for this.',
  );
});

test('--success is a status dot and nothing else', () => {
  // tokens.css, owner amendment (b): "--success is the mockup's optional muted
  // green and appears on status dots and NOTHING else: never a button, never a
  // border, never text."
  //
  // Only a FILL is judged here. The two sync colour maps (SyncStatusChip,
  // mobilePdfViewerModel) hand --success to a dot and are correct; what breaks
  // the rule is --success painting the background of something square.
  const offenders = [];
  for (const file of walk(path.join(repoRoot, 'src'))) {
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    lines.forEach((line, i) => {
      if (!/var\(--success\)/.test(line)) return;
      if (/^(\/\/|\*|\/\*)/.test(line.trim())) return;
      // Walk back to the property this value belongs to.
      const head = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
      const prop = [...head.matchAll(/([a-zA-Z-]+)\s*:/g)].map((m) => m[1]);
      const owner = prop.length ? prop[prop.length - 1] : '';
      if (!/^(background|backgroundColor|fill)$/.test(owner)) return;
      const near = lines.slice(Math.max(0, i - 8), i + 8).join('\n');
      if (/borderRadius:\s*'50%'|border-radius:\s*50%/.test(near)) return;
      offenders.push(`${path.relative(repoRoot, file)}:${i + 1} ${line.trim().slice(0, 90)} (fills a '${owner}')`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} site(s) fill something square with --success, which tokens.css `
    + `reserves for status dots:\n  ${offenders.join('\n  ')}`,
  );
});

test('a popover arrow is the same grey as the border it continues', () => {
  // The two dropdown popovers moved their edge to --border-strong (#575f6e) but
  // left the little arrow that joins that edge on the retired #3a4252 literal -
  // 11 brightness points darker, so the tip reads as a different grey.
  for (const rel of ['src/components/AnnotationDropdown.css', 'src/components/AnnotationSizeControl.css']) {
    const css = readFileSync(path.join(repoRoot, rel), 'utf8');
    const arrow = /__arrow\s*\{\s*fill:\s*([^;]+);/.exec(css);
    assert.notEqual(arrow, null, `missing arrow rule in ${rel}`);
    assert.match(
      arrow[1].trim(),
      /^var\(--/,
      `${rel}: the popover arrow is the literal ${arrow[1].trim()} while the panel edge beside `
      + 'it is var(--border-strong); the arrow must come from the same token.',
    );
  }
});

test('no :hover rule repaints a value its own resting state already paints', () => {
  /*
   * The JSX case above cannot see a hover written in CSS, and six of them were
   * dead too - three of those regressions against main (.account-sidebar-btn,
   * .account-btn-purple, .account-subscription-tab), three already dead there.
   *
   * A rule is exempt when the SAME block declares the base selector and its
   * :hover together (`.btn-active, .btn-active:hover { ... }`): that is an
   * author saying out loud that the control must not change under the pointer.
   */
  const PAINT = /^(background|background-color|border-color|border|color|fill|stroke|box-shadow|opacity|outline|outline-color|border-bottom-color|border-top-color|text-decoration-color)$/;
  const offenders = [];

  for (const file of walkCss(path.join(repoRoot, 'src'))) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, ' ');
      if (!selector || selector.startsWith('@')) continue;
      const parts = selector.split(',').map((p) => p.trim());
      const declarations = new Map();
      for (const declaration of m[2].split(';')) {
        const at = declaration.indexOf(':');
        if (at === -1) continue;
        const property = declaration.slice(0, at).trim().toLowerCase();
        if (property) declarations.set(property, declaration.slice(at + 1).trim().replace(/\s*!important$/, ''));
      }
      rules.push({ parts, declarations, index: m.index });
    }
    // The cascade: what each selector paints once every rule has had its say.
    const settled = new Map();
    for (const rule of rules) {
      for (const part of rule.parts) {
        if (!settled.has(part)) settled.set(part, new Map());
        for (const [k, v] of rule.declarations) settled.get(part).set(k, v);
      }
    }
    for (const rule of rules) {
      for (const part of rule.parts) {
        if (!/:hover$/.test(part)) continue;
        const base = part.replace(/:hover$/, '');
        if (rule.parts.includes(base)) continue; // deliberate: one shared block
        const rest = settled.get(base);
        if (!rest) continue;
        const dead = [...rule.declarations]
          .filter(([k, v]) => PAINT.test(k) && rest.get(k) === v)
          .map(([k, v]) => `${k}: ${v}`);
        if (dead.length) {
          offenders.push(`${path.relative(repoRoot, file)}:${css.slice(0, rule.index).split('\n').length} `
            + `${part} -> ${dead.join(' ; ')}`);
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} :hover declaration(s) repaint the resting value, so the control gives `
    + `no hover feedback on that property:\n  ${offenders.join('\n  ')}`,
  );
});
