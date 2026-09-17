import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The revision-2 palette (src/styles/tokens.css, owner approved 2026-09-17)
 * names --accent-text as "the label ON a gold fill" - a near-black WARM brown,
 * #15110a. Its own file says --accent-soft is "the ONLY warm fill, and only on
 * small gold controls ... never on a whole row or panel, because a large warm
 * wash is how the rejected brown happened in the first place."
 *
 * These tests guard that rule at the three places the tokenisation pass broke
 * it. They FAIL on claude/hp-integration, where a mechanical hex -> token
 * replacement mapped thirty different old colours onto --accent-text: panel
 * fills, bar fills, hairlines and hover states.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
};

test('the tab bar keeps a distinct bar, idle, active, hover and border colour', () => {
  const source = read('src/TabBar.jsx');
  const names = ['TAB_BAR_BG', 'TAB_IDLE_BG', 'TAB_ACTIVE_BG', 'TAB_HOVER_BG', 'TAB_BORDER'];
  const values = {};
  for (const name of names) {
    const match = new RegExp(`const ${name} = '([^']+)';`).exec(source);
    assert.notEqual(match, null, `missing ${name}`);
    values[name] = match[1];
  }

  // A tab bar whose bar, tabs, hover and divider are one colour has no active
  // tab, no hover feedback and no visible rule. Five roles, five colours.
  const distinct = new Set(Object.values(values));
  assert.equal(
    distinct.size,
    names.length,
    `the tab bar paints ${distinct.size} colour(s) across ${names.length} roles: `
    + JSON.stringify(values),
  );

  // --accent-text is a LABEL colour. It must not fill the bar or a tab.
  for (const name of names) {
    assert.notEqual(
      values[name],
      'var(--accent-text)',
      `${name} is --accent-text, the label-on-gold colour, not a surface`,
    );
  }
});

/**
 * Every place `name` appears as a JSX PROP (`name={`), never as a method call
 * (`tip(...).onMouseEnter(e)` inside another handler's body).
 */
const propAt = (name) => new RegExp(`(?<![.\\w])${name}\\s*=\\s*\\{`, 'g');

/** The balanced {...} body that starts at the brace `open`. */
const bodyFrom = (source, open) => {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return { text: source.slice(open, i + 1), end: i };
    }
  }
  return { text: '', end: open };
};

/*
 * DELIBERATE ASSERTION CHANGE (2026-09-17, revision-2 palette approved by the
 * owner). This case used to pass while the branch shipped three hover handlers
 * that give no feedback at all, because the old version had three holes:
 *
 *   1. it compared only `background`, `backgroundColor` and `borderColor`, so a
 *      dead `color` hover (the copy-mode Delete label) was invisible to it;
 *   2. it flagged a handler only when EVERY setter matched, so a handler with
 *      one dead branch and one live branch escaped (the Bookmarks "Edit"
 *      button);
 *   3. its proximity window counted RAW CHARACTERS, indentation included, and
 *      measured from the wrong end, so a deeply indented pair was skipped whole
 *      (the "Create category" button, 50 characters at a 40-character gate).
 *
 * It is stricter now, in the three matching ways: it watches every paint
 * property, it flags a pair when ANY property repeats its value, and it measures
 * proximity in LINES so no amount of indentation can exempt a control.
 */
const PAINT_PROPS = ['background', 'backgroundColor', 'borderColor', 'borderTopColor',
  'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'border', 'color', 'fill',
  'stroke', 'boxShadow', 'outline', 'outlineColor', 'opacity', 'filter', 'textDecorationColor'];
const SETTER = new RegExp(`style\\.(${PAINT_PROPS.join('|')})\\s*=\\s*(?:'([^']*)'|"([^"]*)"|\`([^\`]*)\`)`, 'g');
/** Every (property, value) the handler can paint, in source order, one entry per branch. */
const paints = (body) => [...body.matchAll(SETTER)]
  .map((m) => `${m[1]}=${m[2] ?? m[3] ?? m[4]}`);

test('no hover handler paints the same value on enter and on leave', () => {
  const offenders = [];

  for (const file of walk(path.join(repoRoot, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const enterProp of [...source.matchAll(propAt('onMouseEnter'))]) {
      const enter = bodyFrom(source, enterProp.index + enterProp[0].length - 1);
      const after = source.slice(enter.end);
      const leaveProp = propAt('onMouseLeave').exec(after);
      if (!leaveProp) continue;
      // Proximity in LINES, not characters: the leave has to be on the same
      // element, and indentation must never buy a handler an exemption.
      const linesBetween = after.slice(0, leaveProp.index).split('\n').length - 1;
      if (linesBetween > 4) continue;
      const leave = bodyFrom(source, enter.end + leaveProp.index + leaveProp[0].length - 1);
      const enters = paints(enter.text);
      const leaves = paints(leave.text);
      // Branch i of the enter against branch i of the leave. ANY property that
      // repeats its value means that branch of the control has no hover.
      const dead = enters.filter((value, i) => leaves[i] === value);
      if (dead.length) {
        const line = source.slice(0, enterProp.index).split('\n').length;
        offenders.push(
          `${path.relative(repoRoot, file)}:${line} -> ${dead.join(', ')} `
          + `(enter [${enters.join(' | ')}] / leave [${leaves.join(' | ')}])`,
        );
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} hover handler branch(es) paint the resting value on enter, so the `
    + `control gives no hover feedback:\n  ${offenders.join('\n  ')}`,
  );
});

test('--accent-text is never a hover background', () => {
  const offenders = [];
  for (const file of walk(path.join(repoRoot, 'src'))) {
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    lines.forEach((line, i) => {
      if (!/onMouseEnter/.test(line)) return;
      const window = lines.slice(i, i + 6).join('\n');
      if (/style\.(background|backgroundColor)\s*=\s*'var\(--accent-text\)'/.test(window)) {
        offenders.push(`${path.relative(repoRoot, file)}:${i + 1}`);
      }
    });
  }

  // Hover is +5 brightness on the panel under it (--hover). --accent-text is
  // DARKER than --surface-0, so these hovers go backwards as well as warm.
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} hover handlers paint --accent-text (#15110a) as a background:\n  `
    + offenders.join('\n  '),
  );
});
