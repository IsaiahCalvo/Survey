import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * SELECTED STATES ARE GOLD INK AND NOTHING ELSE.
 *
 * OWNER RULING 2026-09-17, verbatim: "When we select a tool, the icon turns
 * gold, not everything else around it. It doesn't need a fill, and it doesn't
 * need a border. You're not being consistent with the initial app, the desktop
 * and web version."
 *
 * THE HOUSE REFERENCE is the desktop tool rail's `.btn-active`
 * (src/styles.css). Measured live in the running app at 1440x900 on the Pan
 * button, against its idle Undo/Redo siblings in the same bar:
 *
 *              active (Pan)                idle (Undo)
 *   color      rgb(216, 168, 78)           rgb(183, 190, 201)
 *   background rgba(0, 0, 0, 0)            rgba(0, 0, 0, 0)
 *   border     1px solid rgba(0,0,0,0)     1px solid rgba(0,0,0,0)
 *   box-shadow none                        none
 *   box        34 x 34                     34 x 34
 *
 * Identical in every respect except the ink. This file stops the three ways
 * the app kept drifting off that reference:
 *
 *   1. a warm GOLD WASH behind the selected thing (--accent-soft, or a
 *      rgba(216,168,78,...) literal) — the "muddy gold-brown" the owner had
 *      already banned once, which came back as .quick-style__width.is-current;
 *   2. a GOLD BORDER around it (border-color: --accent / --accent-press);
 *   3. a GOLD RING under it (box-shadow: 0 0 0 Npx <gold>).
 *
 * WHAT IS STILL ALLOWED, deliberately:
 *   - HOVER and FOCUS states. A hover is still a hover; the ruling is about the
 *     selected state only. Selectors carrying :hover / :focus / :active /
 *     :focus-visible / :focus-within are not selected states and are skipped.
 *   - A single EDGE: `box-shadow: inset <n>px 0 <gold>` (a menu row's left
 *     rule) or a one-sided `border-bottom-color` / `border-left-color` (a tab
 *     underline). A selected row is a surface step plus a gold edge — the
 *     approved revision-2 palette doctrine (src/styles/tokens.css), which the
 *     desktop's own menus, home sidebar and account tabs already use, so the
 *     phone matching them IS matching desktop. What is banned is a gold box
 *     drawn all the way round: a full RING (`0 0 0 Npx`) or a whole
 *     `border` / `border-color`.
 *   - The named EXCEPTIONS below, each with the reason written down.
 *
 * Add nothing to EXCEPTIONS without a reason a reader can check.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const walkCss = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkCss(full, out);
    else if (/\.css$/.test(entry)) out.push(full);
  }
  return out;
};

const walkJs = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkJs(full, out);
    else if (/\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
};

/* A selector that names a selected / current / pressed state. */
/* `.btn-active` is in here on purpose: it IS the reference, so it has to be
   held to the reference too. */
const SELECTED = /(\.is-active|\.is-current\b|\.is-selected|\.is-open|[.-]active\b|\[aria-pressed\s*=\s*"true"\])/;
/* ...but not when the same selector is really a pointer or keyboard state. */
const INTERACTION = /:(hover|focus|focus-visible|focus-within|active)\b/;

/* Gold, in any spelling this repo uses. --focus is the focus ring, not a fill. */
const GOLD = /var\(--accent(-soft|-press|-light)?\)|var\(--gold\b[^)]*\)|var\(--pp-accent(-soft)?\)|rgba?\(\s*216\s*,\s*168\s*,\s*78/;

/* ---------- deliberate exceptions, each with its reason ------------------ */
const EXCEPTIONS = [
  {
    match: /\.quick-style__dot\.is-current/,
    why: 'the quick-colour dots. A colour disc cannot turn gold without lying '
      + 'about which colour is selected, so it keeps a gold RING instead — the '
      + 'owner named this exception when he gave the ruling.',
  },
  {
    match: /\.ctx-color-swatch\.is-current-color|\.mobile-pdf-properties__(color|swatch)\.is-current-color/,
    why: 'the same exception for the colour swatch beside the dots, and for the '
      + 'phone strip\'s colour button and swatch.',
  },
  {
    match: /\.mobile-pdf-tools__survey-entities button\.is-active/,
    why: 'the rail\'s entity buttons: the glyph IS the entity\'s own colour dot, '
      + 'so this is the colour-disc exception again. It keeps the gold ring and '
      + 'has no fill; the ring is its resting 1px transparent border recoloured, '
      + 'so the chip never changes size.',
  },
  {
    match: /\.mobile-pdf-text-card__colors > button\.is-active/,
    why: 'the text card\'s colour buttons: the colour-disc exception once more.',
  },
  {
    match: /\.survey-marker-leading-check\.is-selected \.survey-marker-leading-checkbox|\.mobile-pdf-properties__keep\.is-active > span|\.mobile-page-select-indicator\.is-selected/,
    why: 'CHECKBOXES. A ticked box is a filled box with a dark tick, here and in '
      + 'every other application; there is no glyph beside it to turn gold.',
  },
  {
    match: /\.spaces-header-export-button(:hover)?[,\s]*\.spaces-header-export-button\.is-active|\.spaces-header-export-button\.is-active/,
    why: 'not a selected state at all: SpacesPanel sets `isSpacesExportActive = '
      + 'isSpacesExportHovered || isSpacesExportMenuOpen`, so `.is-active` here '
      + 'IS the hover, driven from JS because the menu has to stay lit while it '
      + 'is open. Hovers are out of scope. It is also grouped with :hover in one '
      + 'block, so splitting it would change the hover.',
  },
  {
    match: /\.survey-marker-category-card\.is-active|\.templates-mobile-module-group\.active|\.templates-mobile-(module-strip|color-tabs|match)|\.projects-mobile-(folder-row|folder-section|folder-grid|tile-grid|project-strip|team-board|rail-list|compact-list)|\.mobile-page-card\.(is-active|is-selected)|\.pp-thumb-cell\.is-current/,
    why: 'ROWS, CARDS and THUMBNAILS, not buttons. The approved revision-2 '
      + 'palette (src/styles/tokens.css, owner approved the same day) builds a '
      + 'selected row as a surface step PLUS a gold edge, and the desktop rail '
      + 'and the home sidebar already do exactly that. Matching them is the '
      + 'point of the ruling, not a departure from it. Each of these paints the '
      + 'edge on a border the element already carries at rest, so nothing moves.',
  },
];

const excepted = (selector) => EXCEPTIONS.find((e) => e.match.test(selector));

/* ---------- 1. CSS rules ------------------------------------------------- */
test('no selected-state CSS rule paints a gold fill, a gold border or a gold ring', () => {
  const offenders = [];

  for (const file of walkCss(path.join(repoRoot, 'src'))) {
    const source = readFileSync(file, 'utf8');
    // Strip comments so prose about gold never trips the scan.
    const clean = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

    for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim();
      const body = m[2];
      if (!SELECTED.test(selector) || INTERACTION.test(selector)) continue;
      if (excepted(selector)) continue;
      const line = clean.slice(0, m.index).split('\n').length;
      const where = `${path.relative(repoRoot, file)}:${line}  ${selector.replace(/\s+/g, ' ').slice(0, 90)}`;

      for (const d of body.split(';')) {
        const [rawProp, ...rest] = d.split(':');
        if (!rest.length) continue;
        const prop = rawProp.trim().toLowerCase();
        const value = rest.join(':').trim();
        if (!GOLD.test(value)) continue;

        if (/^background(-color|-image)?$/.test(prop)) {
          offenders.push(`${where}\n      gold FILL  ${prop}: ${value}`);
        } else if (/^(border|border-color|outline|outline-color)$/.test(prop)) {
          // A box drawn all the way round. A ONE-SIDED border-*-color is an
          // edge (a tab underline, a row's left rule) and is the approved cue.
          offenders.push(`${where}\n      gold BORDER  ${prop}: ${value}`);
        } else if (/^box-shadow$/.test(prop) && /(^|\s)0\s+0\s+0\s+[\d.]+px/.test(value)) {
          // A full ring. `inset <n>px 0 <gold>` — a menu row's left edge — is
          // the approved row cue and is not a ring.
          offenders.push(`${where}\n      gold RING  ${prop}: ${value}`);
        }
      }
    }
  }

  assert.deepEqual(offenders, [], `selected states must be gold INK only:\n  ${offenders.join('\n  ')}`);
});

/* ---------- 2. inline styles in JSX -------------------------------------- */
/*
 * The same defect written as a ternary. `background: isOn ? 'rgba(216,168,78,
 * 0.18)' : 'var(--surface-3)'` is exactly what the owner pointed at, and no
 * CSS selector would catch it. This looks for a gold value on the SAME LINE as
 * a condition that names a selected / pressed / on / current / open state.
 */
const ON_STATE = /\b(is[A-Z]\w*Active|isActive|isOn|isCurrent|isSelected|isChecked|isOpen|isPressed|arrowBothEnds|richTextEditor|\bon\b|\bactive\b|\bselected\b|\bcurrent\b)\s*\?/;
const JSX_EXCEPTIONS = [
  {
    match: /isDragging|dragOver|isDropTarget/,
    why: 'a DRAG state, not a selection: the gold tint marks the card a pointer '
      + 'is carrying, and it disappears the moment the drag ends.',
  },
];

test('no JSX inline style paints a gold fill for an on/selected/pressed state', () => {
  const offenders = [];

  for (const file of walkJs(path.join(repoRoot, 'src'))) {
    const source = readFileSync(file, 'utf8');
    source.split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return;
      if (!/\b(background|backgroundColor|borderColor)\s*:/.test(line)) return;
      if (!/var\(--accent-soft\)|rgba?\(\s*216\s*,\s*168\s*,\s*78/.test(line)) return;
      if (!ON_STATE.test(line)) return;
      if (JSX_EXCEPTIONS.some((e) => e.match.test(line))) return;
      offenders.push(`${path.relative(repoRoot, file)}:${i + 1}  ${line.slice(0, 130)}`);
    });
  }

  assert.deepEqual(offenders, [], `an on/selected state must be gold INK, not a gold wash:\n  ${offenders.join('\n  ')}`);
});
