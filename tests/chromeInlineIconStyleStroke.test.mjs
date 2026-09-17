import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HOUSE_STROKE, HOUSE_GRID, STROKE_TOLERANCE, stripComments } from './helpers/inlineIconStrokes.mjs';

/*
 * ADVERSARIAL VERIFICATION, 2026-09-16 (verify-r5-final). THIS TEST FAILS ON
 * claude/ux-polish @ 831760dcc. It is committed failing on purpose.
 *
 * The r5 icon pass claims: "the whole-tree inline-icon guard passes and a live
 * sweep of every chrome SVG in the desktop DOM finds none off the house 1.5".
 * The guard does pass. The DOM does not agree.
 *
 * MEASURED IN THE LIVE DESKTOP DOM, Browser pane at 1440x900, hub > Projects >
 * a project row's "..." menu, reading getComputedStyle().strokeWidth off every
 * painted child of every chrome <svg> and normalising onto the 24 grid:
 *
 *   { units: 1.6, strokeWidth: 1.6, grid: 24, box: "12x12", at: "226,315",
 *     d: "M12 17v5",                                   near: "Pin project" }
 *   { units: 1.6, strokeWidth: 1.6, grid: 24, box: "12x12", at: "226,315",
 *     d: "M9 10.76V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5.76l2 3.24H7z",
 *                                                      near: "Pin project" }
 *
 * That is src/home/ProjectsFolderTree.jsx:53 `PinIcon`, 1.6 house units =
 * 106.7% of the house 1.5, better than 3x the 0.03 slack the guard itself uses.
 * It paints in three chrome places in the hub: the pinned desktop project row
 * (:965, where it REPLACES the drag grabber), the pinned mobile row (:1352),
 * and the "Pin project" item in every project's "..." menu (:1918).
 *
 * WHY THE WHOLE-TREE GUARD IS BLIND TO IT. tests/helpers/inlineIconStrokes.mjs
 * resolves the weight from an ATTRIBUTE only - `attr(tag, 'strokeWidth')` /
 * `attr(tag, 'stroke-width')` on the <svg>, an enclosing <g>, or the painted
 * element. PinIcon declares it in a STYLE OBJECT:
 *
 *     style={{ fill: 'none', stroke: color, strokeWidth: 1.6, ... }}
 *
 * so the parser reads null at every level, treats the glyph as carrying no
 * weight, and reports zero offenders for the file. It is the same shape of hole
 * as the two the r3 and r4 passes each found and closed: r3's guard read the
 * <svg> tag only and missed weights on children; r4's guard read a hand-written
 * list of six files and missed the file next door. This one reads attributes
 * only and misses the spelling next door.
 *
 * A source sweep of all 91 src/**\/*.jsx for `strokeWidth:` inside an inline
 * <svg> finds exactly one such declaration in the tree, and it is off house.
 *
 * TO MAKE IT PASS: draw PinIcon at strokeWidth 1.5, or render the shared
 * <Icon>. Do NOT relax the tolerance and do NOT add ProjectsFolderTree.jsx to
 * an exemption list - it is hub chrome, not page ink.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/* Identical to the whole-tree guard's list: these draw the document, not the
   chrome, so their stroke widths are page geometry. */
const EXEMPT = new Set([
  'Icons.jsx',
  'components/FabricEraserCanvas.jsx',
  'components/SVGAnnotationLayer.jsx',
  'components/SVGSelectionOverlay.jsx',
  'components/SearchHighlightLayer.jsx',
  'components/collab/CollaboratorOutlineOverlay.jsx',
  'SpaceRegionOverlay.jsx',
  'dev/EraserTwoClientRaceHarness.jsx',
  'prototype/AtomicEraseHarness.jsx',
  'prototype/InteractiveOverlay.jsx',
]);

const walk = async (dir, prefix = '') => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await walk(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.jsx')) out.push(rel);
  }
  return out;
};

/** Stroke weights declared in a style OBJECT inside an inline <svg>, on the 24 grid. */
const styleObjectStrokes = (rawSource, file) => {
  const source = stripComments(rawSource);
  const out = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('<svg', cursor);
    if (open === -1) break;
    const openEnd = source.indexOf('>', open);
    if (openEnd === -1) break;
    const close = source.indexOf('</svg>', openEnd);
    const whole = source.slice(open, close === -1 ? source.length : close + 6);
    cursor = close === -1 ? source.length : close + 6;

    const viewBox = /viewBox\s*=\s*["']([^"']+)["']/.exec(whole.slice(0, openEnd - open + 1))?.[1];
    const grid = viewBox ? Number(viewBox.trim().split(/[\s,]+/)[2]) : NaN;
    for (const match of whole.matchAll(/strokeWidth\s*:\s*([\d.]+)/g)) {
      const declared = Number(match[1]);
      const units = Number.isFinite(grid) && grid > 0
        ? Number(((declared * HOUSE_GRID) / grid).toFixed(3))
        : declared;
      out.push({
        file,
        line: source.slice(0, open).split('\n').length,
        declared,
        grid: Number.isFinite(grid) ? grid : null,
        units,
      });
    }
  }
  return out;
};

test('an inline icon that declares its weight in a style object still draws it at the house weight', async () => {
  const files = (await walk(SRC)).filter((file) => !EXEMPT.has(file)).sort();
  assert.ok(files.length > 50, `the walk found only ${files.length} .jsx files - it is not walking src/`);

  const offenders = [];
  for (const file of files) {
    for (const icon of styleObjectStrokes(await readFile(path.join(SRC, file), 'utf8'), `src/${file}`)) {
      if (Math.abs(icon.units - HOUSE_STROKE) <= STROKE_TOLERANCE) continue;
      offenders.push(
        `${icon.file}:${icon.line} style={{ strokeWidth: ${icon.declared} }} on a `
        + `${icon.grid} grid = ${icon.units} house units (want ${HOUSE_STROKE})`,
      );
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'chrome glyphs off the house weight that the attribute-only parser in '
    + `tests/helpers/inlineIconStrokes.mjs cannot see:\n  ${offenders.join('\n  ')}`,
  );
});

test('the hub pin glyph is not drawn one notch heavier than the rest of the chrome', async () => {
  // Live in the desktop DOM at 1440x900, 12x12 at 226,315, strokeWidth 1.6 on a
  // 24 grid, in the "Pin project" row of every project's "..." menu.
  const source = await readFile(path.join(SRC, 'home/ProjectsFolderTree.jsx'), 'utf8');
  assert.ok(
    !/strokeWidth:\s*1\.6/.test(source),
    'src/home/ProjectsFolderTree.jsx:53 draws PinIcon at strokeWidth 1.6 on a 24 grid '
    + '(1.6 house units, 106.7% of 1.5). It paints in the hub at ProjectsFolderTree.jsx '
    + ':965 (pinned desktop row), :1352 (pinned mobile row) and :1918 ("Pin project" in '
    + 'the "..." menu). Draw it at 1.5, or render the shared <Icon>.',
  );
});
