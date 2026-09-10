// Revision-cloud VISUAL parity harness (2026-09-09, cloud-studio-match).
//
// tests/revisionCloudGeometryParity.test.mjs proves the app hands the vendored
// engine the same numbers the approved studio does. This suite proves the
// PIXELS: the app's real SVG renderer output (renderRect / renderEllipse /
// renderPolygon / renderPolyline, loaded through vite exactly as the page
// loads them) is rasterised next to the studio's own `<path d={run.d}>` ink
// (tests/fixtures/reference/cloud-v17.ts = revision-cloud-tool lib/cloud.ts
// @ d1abe78, page.tsx defaults: size 28, depth 12, stroke 2.5, #c42747) and
// the two rasters must not differ by a single pixel.
//
// The committed PNGs under tests/fixtures/cloud-studio/ are the STUDIO's
// renders. Two checks run per fixture:
//   1. app render   vs committed PNG  - the app draws the studio's pixels;
//   2. studio render vs committed PNG - the fixture is still the studio's.
// Regenerate the fixtures (only when the reference module itself changes):
//   CLOUD_STUDIO_FIXTURES=update node --test tests/cloudStudioVisualParity.test.mjs
//
// Rasteriser: sharp (librsvg) at 2 px per page unit, the same renderer for
// both sides, so any residue is geometry - never anti-aliasing luck.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(here, 'fixtures/cloud-studio');
const UPDATE = process.env.CLOUD_STUDIO_FIXTURES === 'update';
const SCALE = 2; // px per page unit
const MARGIN = 30; // page units around the vertex box (crowns bulge ~13 units at Bump 2, ~37 at Bump 6)

let reference = null;
let referenceError = null;
try {
  reference = await import(join(here, 'fixtures/reference/cloud-v17.ts'));
} catch (error) {
  referenceError = error;
}
const {
  cloudRadiusForIntensity,
  cloudVertexStateForPoints,
  moveCloudVertex,
} = await import('../src/utils/pdfAnnotationAppearance.js');

const skip = reference
  ? false
  : `reference cloud-v17.ts could not be imported on ${process.version}: ${referenceError?.message}`;

const STROKE = '#c42747';
const STROKE_WIDTH = 2.5;
const bump = (level) => cloudRadiusForIntensity(level, STROKE_WIDTH, 1) * 2;

// ---------------------------------------------------------------------------
// Fixtures: the same drawing described for both sides. `studio` is what
// page.tsx would hold (absolute canvas points, makeShape/moveVertex), `app`
// is the Fabric annotation the SVG layer renders.
// ---------------------------------------------------------------------------

const rectPoints = (x, y, w, h) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
const translate = (points, dx, dy) => points.map((p) => ({ x: p.x + dx, y: p.y + dy }));

const POLYGON5 = [{ x: 0, y: 0 }, { x: 260, y: 15 }, { x: 225, y: 190 }, { x: 118, y: 100 }, { x: 0, y: 200 }];
const POLYLINE4 = [{ x: 0, y: 170 }, { x: 70, y: 0 }, { x: 190, y: 110 }, { x: 330, y: 0 }];

const resizeStep = (step) => ({ w: 60 + step * 12, h: 40 + step * 8 }); // 20 steps: 60x40 -> 300x200

const fixtures = [];
for (const level of [1, 2, 4, 6]) {
  fixtures.push({
    name: `rect-300x200-bump${level}`,
    studio: { kind: 'rectangle', points: rectPoints(100, 150, 300, 200), size: bump(level) },
    app: { type: 'rect', left: 100, top: 150, width: 300, height: 200, scaleX: 1, scaleY: 1, data: { pdfCloudIntensity: level } },
  });
}
for (const level of [1, 2, 6]) {
  fixtures.push({
    name: `ellipse-240x160-bump${level}`,
    studio: { kind: 'ellipse', points: [{ x: 100, y: 100 }, { x: 340, y: 260 }], size: bump(level) },
    app: { type: 'ellipse', left: 100, top: 100, rx: 120, ry: 80, scaleX: 1, scaleY: 1, data: { pdfCloudIntensity: level } },
  });
}
fixtures.push({
  name: 'circle-200-bump2',
  studio: { kind: 'circle', points: [{ x: 50, y: 50 }, { x: 250, y: 250 }], size: bump(2) },
  app: { type: 'circle', left: 50, top: 50, radius: 100, scaleX: 1, scaleY: 1, data: { pdfCloudIntensity: 2 } },
});
for (const level of [2, 4]) {
  fixtures.push({
    name: `polygon5-bump${level}`,
    studio: { kind: 'polygon', points: translate(POLYGON5, 80, 60), size: bump(level) },
    app: { type: 'polygon', left: 80, top: 60, points: POLYGON5, scaleX: 1, scaleY: 1, data: { pdfCloudIntensity: level } },
  });
  fixtures.push({
    name: `polyline4-bump${level}`,
    studio: { kind: 'polyline', points: translate(POLYLINE4, 60, 60), size: bump(level) },
    app: { type: 'polyline', left: 60, top: 60, points: POLYLINE4, scaleX: 1, scaleY: 1, data: { pdfCloudIntensity: level } },
  });
}
for (const step of [7, 13, 20]) {
  const { w, h } = resizeStep(step);
  fixtures.push({
    name: `rect-resize-step${String(step).padStart(2, '0')}`,
    studio: { kind: 'rectangle', points: rectPoints(100, 150, w, h), size: bump(2) },
    app: { type: 'rect', left: 100, top: 150, width: w, height: h, scaleX: 1, scaleY: 1, data: { pdfCloudIntensity: 2 } },
  });
  fixtures.push({
    name: `ellipse-resize-step${String(step).padStart(2, '0')}`,
    studio: { kind: 'ellipse', points: [{ x: 100, y: 150 }, { x: 100 + w, y: 150 + h }], size: bump(2) },
    app: { type: 'ellipse', left: 100, top: 150, rx: w / 2, ry: h / 2, scaleX: 1, scaleY: 1, data: { pdfCloudIntensity: 2 } },
  });
}
// Group/bbox resize of a polygon: the studio rewrites the vertices, the app
// stores scaleX/scaleY - the crowns must re-fit at constant size either way.
fixtures.push({
  name: 'polygon5-scaled-2x-1.4x',
  studio: { kind: 'polygon', points: translate(POLYGON5.map((p) => ({ x: p.x * 2, y: p.y * 1.4 })), 80, 60), size: bump(2) },
  app: { type: 'polygon', left: 80, top: 60, points: POLYGON5, scaleX: 2, scaleY: 1.4, data: { pdfCloudIntensity: 2 } },
});
fixtures.push({
  name: 'polyline4-scaled-0.6x-1.5x',
  studio: { kind: 'polyline', points: translate(POLYLINE4.map((p) => ({ x: p.x * 0.6, y: p.y * 1.5 })), 60, 60), size: bump(2) },
  app: { type: 'polyline', left: 60, top: 60, points: POLYLINE4, scaleX: 0.6, scaleY: 1.5, data: { pdfCloudIntensity: 2 } },
});
// Single-vertex drag, 20 steps: the studio's moveVertex() keeps the other
// corners where they were; the app carries that memory on the annotation.
{
  const dragged = (step) => ({ x: 225 + step * 2.5, y: 190 - step * 4 });
  for (const step of [10, 20]) {
    const moved = moveCloudVertex('polygon', POLYGON5, cloudVertexStateForPoints('polygon', POLYGON5), 2, dragged(step));
    fixtures.push({
      name: `polygon5-vertex-drag-step${step}`,
      studio: { kind: 'polygon', points: translate(POLYGON5, 80, 60), size: bump(2), moveVertex: { index: 2, point: { x: dragged(step).x + 80, y: dragged(step).y + 60 } } },
      app: {
        type: 'polygon', left: 80, top: 60, points: moved.points, scaleX: 1, scaleY: 1,
        data: { pdfCloudIntensity: 2, pdfCloudVertexState: moved.state },
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const viewBoxFor = (points) => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.floor(Math.min(...xs) - MARGIN);
  const y = Math.floor(Math.min(...ys) - MARGIN);
  const w = Math.ceil(Math.max(...xs) + MARGIN) - x;
  const h = Math.ceil(Math.max(...ys) + MARGIN) - y;
  return { x, y, w, h };
};

const wrapSvg = (inner, box) => (
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" `
  + `width="${box.w * SCALE}" height="${box.h * SCALE}">`
  + `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#ffffff"/>${inner}</svg>`
);

const studioMarkup = (spec) => {
  let shape = reference.makeShape(spec.kind, spec.points, 'studio', { size: spec.size, depth: 12, stroke: STROKE_WIDTH, color: STROKE });
  if (spec.moveVertex) shape = reference.moveVertex(shape, spec.moveVertex.index, spec.moveVertex.point);
  const runs = reference.cloudRuns(shape, new Map(), 0, false);
  // page.tsx: <g class="cloud-ink" stroke fill="none" stroke-width stroke-linecap="round" stroke-linejoin="round"> <path d={r.d}/> ...
  return `<g stroke="${STROKE}" fill="none" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">`
    + runs.filter((run) => run.d).map((run) => `<path d="${run.d}"/>`).join('')
    + '</g>';
};

let vite = null;
let renderers = null;

before(async () => {
  if (skip) return;
  vite = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    ssr: { external: ['@survey/shared'] },
  });
  renderers = await vite.ssrLoadModule('/src/utils/svgAnnotationRenderers.jsx');
});

after(async () => { await vite?.close(); });

const appMarkup = (obj) => {
  const full = { stroke: STROKE, strokeWidth: STROKE_WIDTH, fill: 'transparent', opacity: 1, angle: 0, ...obj };
  const type = String(full.type).toLowerCase();
  const element = type === 'rect'
    ? renderers.renderRect(full, 0)
    : type === 'ellipse' || type === 'circle'
      ? renderers.renderEllipse(full, 0)
      : type === 'polygon'
        ? renderers.renderPolygon(full, 0)
        : renderers.renderPolyline(full, 0);
  return renderToStaticMarkup(React.createElement(React.Fragment, null, element));
};

const rasterise = async (svg) => {
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return PNG.sync.read(buffer);
};

const studioPointsFor = (fixture) => (
  fixture.studio.moveVertex
    ? fixture.studio.points.map((p, i) => (i === fixture.studio.moveVertex.index ? fixture.studio.moveVertex.point : p))
    : fixture.studio.points
);

const compare = (name, a, b, label) => {
  assert.equal(a.width, b.width, `${name}: ${label} width`);
  assert.equal(a.height, b.height, `${name}: ${label} height`);
  const diff = new PNG({ width: a.width, height: a.height });
  const differing = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  if (differing > 0) {
    const out = join(tmpdir(), `cloud-studio-diff-${name}-${label.replace(/\W+/g, '-')}.png`);
    writeFileSync(out, PNG.sync.write(diff));
    assert.fail(`${name}: ${label} differ in ${differing} px of ${a.width * a.height} (diff written to ${out})`);
  }
};

test('the studio fixtures exist (regenerate with CLOUD_STUDIO_FIXTURES=update)', { skip }, async () => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const fixture of fixtures) {
    const file = join(FIXTURE_DIR, `${fixture.name}.png`);
    if (UPDATE || !existsSync(file)) {
      const box = viewBoxFor(studioPointsFor(fixture));
      const png = await sharp(Buffer.from(wrapSvg(studioMarkup(fixture.studio), box))).png().toBuffer();
      writeFileSync(file, png);
    }
    assert.ok(existsSync(file), `${fixture.name}.png is committed`);
  }
});

for (const fixture of fixtures) {
  test(`visual parity: ${fixture.name} - the app renders the studio's pixels`, { skip }, async () => {
    const box = viewBoxFor(studioPointsFor(fixture));
    const committed = PNG.sync.read(readFileSync(join(FIXTURE_DIR, `${fixture.name}.png`)));
    const studio = await rasterise(wrapSvg(studioMarkup(fixture.studio), box));
    compare(fixture.name, studio, committed, 'studio render vs committed fixture');
    const app = await rasterise(wrapSvg(appMarkup(fixture.app), box));
    compare(fixture.name, app, committed, 'app render vs committed fixture');
  });
}

// DELIBERATE ASSERTION CHANGE (2026-09-09, cloud-fill-knockout): this test
// used to require ONE stroked <path> carrying the whole outline. The studio
// itself paints one <path> PER RUN inside a group that carries the paint
// attributes (page.tsx cloud-ink: `<g stroke fill="none" strokeWidth
// strokeLinecap="round" strokeLinejoin="round">{runs.map(r => <path d={r.d}/>)}`),
// and with a translucent stroke the two structures rasterise differently at
// the run junctions. The renderer now emits the studio's structure, so the
// contract is stronger, not weaker: the group carries the studio paint
// attributes and every run's `d` matches the studio's run, one to one.
test('visual parity: the app SVG is the studio SVG (same crowns, same paint attributes, one path per run)', { skip }, () => {
  const fixture = fixtures.find((entry) => entry.name === 'rect-300x200-bump2');
  const markup = appMarkup(fixture.app);
  const ink = markup.match(/<g fill="none" stroke="#c42747" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"[^>]*>(.*?)<\/g>/s);
  assert.ok(ink, `renderer must emit the studio paint attributes on the ink group: ${markup.slice(0, 300)}`);
  const runDs = [...ink[1].matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]);
  const shape = reference.makeShape('rectangle', rectPoints(0, 0, 300, 200), 'x', { size: 28, depth: 12 });
  const studioRuns = reference.cloudRuns(shape, new Map(), 0, false).map((run) => run.d).filter(Boolean);
  assert.equal(runDs.length, studioRuns.length, 'one <path> per studio run');
  assert.deepEqual(runDs, studioRuns);
  assert.match(markup, /transform="translate\(100, 150\)"/);
});
