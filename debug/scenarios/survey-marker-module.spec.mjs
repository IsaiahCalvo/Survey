// Survey Marker — module lifecycle end-to-end.
//
// The Survey Marker is the signature feature: picking a survey template puts
// the app into survey mode for ONE module (a project phase). Every module is a
// clean slate that shows only its own Survey Markers, and regular markup is
// deliberately hidden while a template is active.
//
// This spec proves the six behaviours a user depends on inside a module:
//   1. place markers (multi-page) and see them PAINT, not just exist in the DOM
//   2. edit a marker (rename + move) and have the change stick on screen
//   3. module A and module B keep separate sets
//   4. save + reload + re-enter the template keeps both sets, in place
//   5. export to PDF and browser print carry the markers
//   6. leaving survey mode brings regular markup back and hides the markers
//
// Evidence (element screenshots + rasterised PDFs) is written to
// debug/artifacts/survey-marker/ so a failure can be looked at, not argued
// about. DOM presence is never accepted as proof a marker painted — every
// placement is confirmed against real pixels.
//
// Structure: behaviours 1–4 are one serial chain driven entirely through the
// UI (place → edit → switch modules → reload). Behaviours 5 and 6 each get
// their OWN page seeded with the same marker set, so a failure in one output
// path never hides the result of another — this spec is read as a coverage
// report, not just a gate.
import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..', '..');
const artifacts = join(root, 'debug', 'artifacts', 'survey-marker');

const PDF_FILE = 'print-fidelity.pdf';
const PDF_PATH = join(root, 'debug', 'fixtures', PDF_FILE);
const PAGE_SIZE = { width: 612, height: 792 };

// Both modules come from the dev-only KAL-436 template (src/DevTestRoute.jsx).
const MODULE_A = { id: 'kal436-module', category: 'Walls', categoryId: 'kal436-category' };
const MODULE_B = { id: 'kal436-other-module', category: 'Doors', categoryId: 'kal436-other-category' };

// Every rect below sits on blank paper in the source PDF, so "this area is no
// longer blank" is by itself proof the marker painted there. A1 is placed at
// its ORIGINAL spot and then moved by (MOVE_DX, MOVE_DY) in behaviour 2;
// A1_MOVED is where it ends up and where every later check looks for it.
const MOVE_DX = 90;
const MOVE_DY = 60;
const A1 = { page: 1, x: 60, y: 120, width: 140, height: 80, name: 'A1 Wall North' };
const A1_MOVED = { ...A1, x: A1.x + MOVE_DX, y: A1.y + MOVE_DY, name: 'A1 Wall North EDITED' };
const A2 = { page: 1, x: 60, y: 420, width: 140, height: 80, name: 'A2 Wall South' };
const A3 = { page: 6, x: 100, y: 150, width: 160, height: 90, name: 'A3 Wall Far' };
const B1 = { page: 1, x: 330, y: 600, width: 150, height: 80, name: 'B1 Door Main' };
// B2 lives on a page module A never touches, so a printed sheet 8 carrying
// paint proves the other module leaked into the print.
const B2 = { page: 8, x: 120, y: 450, width: 170, height: 95, name: 'B2 Door Far' };

const MODULE_A_SET = [A1_MOVED, A2, A3];
const MODULE_B_SET = [B1, B2];

/** Stable ids for the seeded pages (behaviours 5 and 6). */
const seedId = (spec) => `surveyMarker-seed-${spec.name.split(' ')[0].toLowerCase()}`;

async function buildSeed() {
  const { size } = await stat(PDF_PATH);
  const markers = {};
  const add = (spec, module) => {
    const id = seedId(spec);
    markers[id] = {
      id,
      pageNumber: spec.page,
      bounds: { x: spec.x, y: spec.y, width: spec.width, height: spec.height },
      moduleId: module.id,
      regionId: null,
      categoryId: module.categoryId,
      name: spec.name,
      checklistResponses: {},
      color: null,
    };
  };
  MODULE_A_SET.forEach((spec) => add(spec, MODULE_A));
  MODULE_B_SET.forEach((spec) => add(spec, MODULE_B));
  return { key: `surveyMarkers_${PDF_FILE}-${size}`, markers };
}

// ---------------------------------------------------------------- pixel utils

const isBlue = (r, g, b) => b - r > 45 && b - g > 20 && b > 110;
const isYellow = (r, g, b) => r > 195 && g > 175 && g - b > 25;
const isPainted = (r, g, b) => Math.min(r, g, b) < 238;

/**
 * Count matching pixels inside a page-unit rectangle of a page raster.
 * `imageWidth / pageWidth` gives the raster scale, so the same helper works on
 * a browser element screenshot and on a pdftoppm raster.
 */
async function countInRect(buffer, rect, pageSize = PAGE_SIZE, pad = 6) {
  const image = sharp(buffer).ensureAlpha();
  const meta = await image.metadata();
  const sx = meta.width / pageSize.width;
  const sy = meta.height / pageSize.height;
  const left = Math.max(0, Math.floor((rect.x - pad) * sx));
  const top = Math.max(0, Math.floor((rect.y - pad) * sy));
  const width = Math.min(meta.width - left, Math.ceil((rect.width + pad * 2) * sx));
  const height = Math.min(meta.height - top, Math.ceil((rect.height + pad * 2) * sy));
  const { data, info } = await image
    .extract({ left, top, width: Math.max(1, width), height: Math.max(1, height) })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return tally(data, info);
}

function tally(data, info) {
  let blue = 0; let yellow = 0; let painted = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    if (isBlue(r, g, b)) blue += 1;
    if (isYellow(r, g, b)) yellow += 1;
    if (isPainted(r, g, b)) painted += 1;
  }
  return { blue, yellow, painted, total: info.width * info.height };
}

async function countInWholeImage(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return tally(data, info);
}

/**
 * pdftoppm pads its page suffix to the width of the page count, so resolve the
 * sheet for a page number by listing what it actually wrote.
 */
async function rasterSheet(dir, prefix, pageNumber) {
  const files = await readdir(dir);
  const match = files.find((f) => new RegExp(`^${prefix}-0*${pageNumber}\\.png$`).test(f));
  if (!match) throw new Error(`No raster for page ${pageNumber} in ${dir} (${files.join(', ')})`);
  return sharp(join(dir, match)).png().toBuffer();
}

// ---------------------------------------------------------------- app helpers
// Each helper takes the page explicitly so the seeded groups can reuse them.

const pageEl = (p, n) => p.locator(`.survey-pdfjs-page-div[data-page-number="${n}"]`);
const layerEl = (p, n) => p.locator(`[data-svg-annotation-layer="${n}"]`);

async function showPage(p, n) {
  await pageEl(p, n).scrollIntoViewIfNeeded();
  await expect(layerEl(p, n)).toHaveCount(1);
  await expect(layerEl(p, n)).toBeVisible();
  // A toast floating over the sheet is not PDF paint and must never reach a
  // pixel count.
  const dismiss = p.getByRole('button', { name: 'Dismiss' });
  for (let i = await dismiss.count(); i > 0; i -= 1) {
    await dismiss.first().click({ timeout: 2_000 }).catch(() => {});
  }
}

/**
 * Screenshot exactly the sheet, clipped to the annotation layer's box — the
 * layer's viewBox IS the page, so `imageWidth / 612` is the true raster scale.
 * An element screenshot cannot be trusted here: when the sheet is taller than
 * the viewport Playwright returns a region that includes app chrome, which
 * would silently shift every crop.
 */
async function shotPage(p, n, file) {
  await showPage(p, n);
  const box = await layerEl(p, n).boundingBox();
  const buffer = await p.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    animations: 'disabled',
  });
  const meta = await sharp(buffer).metadata();
  const aspect = meta.width / meta.height;
  expect(
    Math.abs(aspect - PAGE_SIZE.width / PAGE_SIZE.height),
    `page ${n} raster is not a whole sheet (${meta.width}x${meta.height}) — crop maths would be wrong`,
  ).toBeLessThan(0.02);
  if (file) await writeFile(join(artifacts, file), buffer);
  return buffer;
}

async function readStore(p) {
  return p.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('surveyMarkers_'));
    return key ? JSON.parse(localStorage.getItem(key) || '{}') : {};
  });
}

async function markerIdsOnPage(p, n) {
  await showPage(p, n);
  return layerEl(p, n)
    .locator('[data-survey-marker-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-survey-marker-id')));
}

/** The <rect> the user actually sees, in page units. */
async function markerRect(p, annotationId) {
  return p.locator(`[data-survey-marker-id="${annotationId}"] rect`).first().evaluate((el) => ({
    x: Number(el.getAttribute('x')),
    y: Number(el.getAttribute('y')),
    width: Number(el.getAttribute('width')),
    height: Number(el.getAttribute('height')),
  }));
}

async function selectModule(p, module) {
  await p.getByRole('combobox', { name: 'Survey module' }).selectOption(module.id);
  await expect(p.getByRole('button', { name: module.category, exact: true })).toBeVisible();
}

async function enterTemplate(p) {
  await p.getByRole('button', { name: 'Survey', exact: true }).click();
  const chooser = p.getByRole('heading', { name: 'Choose survey template' });
  await chooser.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  if (await chooser.count()) {
    await p.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  }
  await expect(p.getByRole('combobox', { name: 'Survey module' })).toBeVisible();
}

async function openViewer(browser, { seed = null } = {}) {
  // Tall viewport: a whole letter sheet has to fit on screen at the app's own
  // zoom, or the clipped page screenshots below would be partial sheets.
  const p = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
  await p.addInitScript((payload) => {
    window.__browserPrintCalls = 0;
    window.print = () => { window.__browserPrintCalls += 1; };
    if (payload) localStorage.setItem(payload.key, JSON.stringify(payload.markers));
  }, seed);
  await p.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTransitionE2E=1`);
  await pageEl(p, 1).waitFor({ state: 'visible', timeout: 60_000 });
  return p;
}

// ============================================================================
// Behaviours 1–4: the real user chain, driven only through the UI.
// ============================================================================

test.describe('Survey Marker lifecycle inside a module', () => {
  test.describe.configure({ mode: 'serial' });

  let page;
  /** annotationId of each placed marker, keyed by its intended name. */
  const placed = new Map();
  /** Live rects, mutated when behaviour 2 moves A1. */
  const live = { A1: { ...A1 } };

  test.beforeAll(async ({ browser }) => {
    await rm(artifacts, { recursive: true, force: true });
    await mkdir(artifacts, { recursive: true });
    page = await openViewer(browser);
  });

  test.afterAll(async () => { if (page) await page.close(); });

  /** Place one Survey Marker by dragging its rectangle, then naming it. */
  async function place(spec, module) {
    await showPage(page, spec.page);
    // The category chip in the survey toolbar arms the Survey Marker tool.
    await page.getByRole('button', { name: module.category, exact: true }).click();
    await showPage(page, spec.page);
    const box = await layerEl(page, spec.page).boundingBox();
    const sx = box.width / PAGE_SIZE.width;
    const sy = box.height / PAGE_SIZE.height;
    await page.mouse.move(box.x + spec.x * sx, box.y + spec.y * sy);
    await page.mouse.down();
    await page.mouse.move(
      box.x + (spec.x + spec.width) * sx,
      box.y + (spec.y + spec.height) * sy,
      { steps: 12 },
    );
    await page.mouse.up();
    const nameInput = page.getByPlaceholder('Enter name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(spec.name);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(nameInput).toHaveCount(0);

    await expect
      .poll(async () => Object.values(await readStore(page)).some((m) => m.name === spec.name))
      .toBe(true);
    const entry = Object.values(await readStore(page)).find((m) => m.name === spec.name);
    placed.set(spec.name, entry.id);
    return entry;
  }

  test('1. Survey Markers place in module A and paint at the placed positions', async () => {
    // Baseline: these areas are blank paper before anything is placed.
    const baseline1 = await shotPage(page, 1, 'baseline-page-1.png');
    const baseline6 = await shotPage(page, 6, 'baseline-page-6.png');
    for (const spec of [A1, A2]) {
      expect((await countInRect(baseline1, spec)).blue, `${spec.name}: area must start blank`)
        .toBeLessThan(20);
    }
    expect((await countInRect(baseline6, A3)).blue).toBeLessThan(20);

    await enterTemplate(page);
    await selectModule(page, MODULE_A);

    for (const spec of [A1, A2, A3]) {
      const entry = await place(spec, MODULE_A);
      expect(entry.moduleId).toBe(MODULE_A.id);
      expect(entry.pageNumber).toBe(spec.page);
    }

    await page.keyboard.press('v');

    // Placed where the user dragged, in page units.
    for (const spec of [A1, A2, A3]) {
      await showPage(page, spec.page);
      const rect = await markerRect(page, placed.get(spec.name));
      expect(Math.abs(rect.x - spec.x), `${spec.name} x`).toBeLessThan(3);
      expect(Math.abs(rect.y - spec.y), `${spec.name} y`).toBeLessThan(3);
      expect(Math.abs(rect.width - spec.width), `${spec.name} width`).toBeLessThan(3);
      expect(Math.abs(rect.height - spec.height), `${spec.name} height`).toBeLessThan(3);
    }

    // Painted, not merely present: a Survey Marker with no entity assigned is a
    // blue dashed outline (#4A90E2) — count those pixels inside each rect.
    const after1 = await shotPage(page, 1, 'module-a-page-1.png');
    const after6 = await shotPage(page, 6, 'module-a-page-6.png');
    const paint = {};
    for (const [spec, buffer] of [[A1, after1], [A2, after1], [A3, after6]]) {
      paint[spec.name] = (await countInRect(buffer, spec)).blue;
    }
    for (const spec of [A1, A2, A3]) {
      expect(paint[spec.name], `${spec.name} did not paint on screen (${JSON.stringify(paint)})`)
        .toBeGreaterThan(120);
    }

    // Element screenshots of the marker groups themselves.
    for (const spec of [A1, A2, A3]) {
      await showPage(page, spec.page);
      await page.locator(`[data-survey-marker-id="${placed.get(spec.name)}"]`).screenshot({
        path: join(artifacts, `marker-${spec.name.split(' ')[0]}.png`),
        animations: 'disabled',
      });
    }
  });

  test('2. renaming and moving a Survey Marker sticks on screen', async () => {
    const id = placed.get(A1.name);
    await showPage(page, 1);
    await page.keyboard.press('v');

    // Double-clicking a placed marker opens its row in the survey panel, where
    // the name is an inline editable field.
    await page.locator(`[data-survey-marker-id="${id}"] [data-survey-marker-hit-target]`).dblclick();
    const rename = page.getByRole('textbox', { name: `Rename ${A1.name}` });
    await expect(rename).toBeVisible();
    await rename.fill(A1_MOVED.name);
    await rename.press('Enter');
    await expect.poll(async () => (await readStore(page))[id]?.name).toBe(A1_MOVED.name);
    await expect(page.getByRole('textbox', { name: `Rename ${A1_MOVED.name}` })).toBeVisible();
    placed.set(A1_MOVED.name, id);

    // Move it by dragging.
    await showPage(page, 1);
    const before = await markerRect(page, id);
    const hit = page.locator(`[data-survey-marker-id="${id}"] [data-survey-marker-hit-target]`);
    const hb = await hit.boundingBox();
    // MOVE_DX / MOVE_DY are PAGE units; the mouse works in CSS pixels, so scale
    // the drag by the layer's current zoom or the marker lands somewhere else.
    const layerBox = await layerEl(page, 1).boundingBox();
    const sx = layerBox.width / PAGE_SIZE.width;
    const sy = layerBox.height / PAGE_SIZE.height;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      hb.x + hb.width / 2 + MOVE_DX * sx,
      hb.y + hb.height / 2 + MOVE_DY * sy,
      { steps: 14 },
    );
    await page.mouse.up();

    await expect
      .poll(async () => Math.round((await markerRect(page, id)).x))
      .toBe(Math.round(before.x + MOVE_DX));
    const moved = await markerRect(page, id);
    expect(Math.abs(moved.y - (before.y + MOVE_DY))).toBeLessThan(3);
    expect(Math.abs(moved.width - before.width)).toBeLessThan(1);
    live.A1 = { ...A1_MOVED, x: moved.x, y: moved.y };

    // The move must be visible: paint at the new rect, blank paper where the
    // marker has fully left.
    const shot = await shotPage(page, 1, 'module-a-page-1-after-edit.png');
    const vacated = { x: before.x, y: before.y, width: MOVE_DX - 12, height: MOVE_DY - 12 };
    expect((await countInRect(shot, moved)).blue, 'marker did not paint at its new position')
      .toBeGreaterThan(120);
    expect((await countInRect(shot, vacated, PAGE_SIZE, 0)).blue, 'marker still paints at its old position')
      .toBeLessThan(20);
  });

  test('3. each module keeps its own Survey Markers', async () => {
    // Switch to B — A's markers must be gone and B starts empty.
    await selectModule(page, MODULE_B);
    await page.keyboard.press('v');
    expect(await markerIdsOnPage(page, 1), 'module B page 1 must start empty').toEqual([]);
    expect(await markerIdsOnPage(page, 6), 'module B page 6 must start empty').toEqual([]);
    await shotPage(page, 1, 'module-b-page-1-empty.png');

    for (const spec of [B1, B2]) {
      const entry = await place(spec, MODULE_B);
      expect(entry.moduleId).toBe(MODULE_B.id);
    }
    await page.keyboard.press('v');

    // Only B's markers show now.
    expect(await markerIdsOnPage(page, 1)).toEqual([placed.get(B1.name)]);
    expect(await markerIdsOnPage(page, 8)).toEqual([placed.get(B2.name)]);
    const bShot = await shotPage(page, 1, 'module-b-page-1.png');
    expect((await countInRect(bShot, B1)).blue, 'B1 did not paint').toBeGreaterThan(120);
    expect((await countInRect(bShot, live.A1)).blue, "module A's marker leaked into module B")
      .toBeLessThan(20);
    await shotPage(page, 8, 'module-b-page-8.png');

    // Back to A — A's three are intact, B's are not shown.
    await selectModule(page, MODULE_A);
    await page.keyboard.press('v');
    expect((await markerIdsOnPage(page, 1)).sort())
      .toEqual([placed.get(A1_MOVED.name), placed.get(A2.name)].sort());
    expect(await markerIdsOnPage(page, 6)).toEqual([placed.get(A3.name)]);
    expect(await markerIdsOnPage(page, 8), "module B's marker leaked into module A").toEqual([]);
    const aShot = await shotPage(page, 1, 'module-a-page-1-back.png');
    expect((await countInRect(aShot, live.A1)).blue).toBeGreaterThan(120);
    expect((await countInRect(aShot, B1)).blue, "module B's marker leaked into module A")
      .toBeLessThan(20);
  });

  test("4. save and reload keeps every module's markers in place", async () => {
    const before = await readStore(page);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
    await page.reload();
    await pageEl(page, 1).waitFor({ state: 'visible', timeout: 60_000 });

    const after = await readStore(page);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const [id, marker] of Object.entries(before)) {
      expect(after[id].name, `${id} name survived reload`).toBe(marker.name);
      expect(after[id].moduleId).toBe(marker.moduleId);
      expect(after[id].pageNumber).toBe(marker.pageNumber);
      expect(after[id].bounds.x).toBeCloseTo(marker.bounds.x, 1);
      expect(after[id].bounds.y).toBeCloseTo(marker.bounds.y, 1);
    }

    await enterTemplate(page);
    await selectModule(page, MODULE_A);
    await page.keyboard.press('v');
    expect((await markerIdsOnPage(page, 1)).sort())
      .toEqual([placed.get(A1_MOVED.name), placed.get(A2.name)].sort());
    expect(await markerIdsOnPage(page, 6)).toEqual([placed.get(A3.name)]);
    expect(await markerIdsOnPage(page, 8)).toEqual([]);
    for (const spec of [live.A1, A2, A3]) {
      await showPage(page, spec.page);
      const rect = await markerRect(page, placed.get(spec.name));
      expect(Math.abs(rect.x - spec.x), `${spec.name} x after reload`).toBeLessThan(3);
      expect(Math.abs(rect.y - spec.y), `${spec.name} y after reload`).toBeLessThan(3);
    }
    const reloaded = await shotPage(page, 1, 'reloaded-module-a-page-1.png');
    expect((await countInRect(reloaded, live.A1)).blue, 'A1 did not repaint after reload')
      .toBeGreaterThan(120);

    await selectModule(page, MODULE_B);
    await page.keyboard.press('v');
    expect(await markerIdsOnPage(page, 1)).toEqual([placed.get(B1.name)]);
    expect(await markerIdsOnPage(page, 8)).toEqual([placed.get(B2.name)]);
    expect(await markerIdsOnPage(page, 6)).toEqual([]);
    const reloadedB = await shotPage(page, 8, 'reloaded-module-b-page-8.png');
    expect((await countInRect(reloadedB, B2)).blue, 'B2 did not repaint after reload')
      .toBeGreaterThan(120);
  });
});

// ============================================================================
// Behaviour 5a: export to PDF. Seeded so it stands alone.
//
// KNOWN FAILING as of 2026-09-02. "Export annotated PDF" drops every Survey
// Marker on purpose: buildPdfExportAnnotationPlan (src/utils/pdfAnnotationsPdfLib.js,
// the contract block at the end of the builder) declares
// includedScopes:['canvas'] / excludedScopes:['survey','region','survey-region'],
// and the run logs skippedByReason {"survey-marker-export-excluded": N}. The
// user gets a PDF with none of their survey work and no warning. This test
// states the behaviour a survey user needs; leave it red until the export
// contract is settled by the owner.
// ============================================================================

test.describe('Survey Marker export', () => {
  test('5a. exporting an annotated PDF carries the Survey Markers', async ({ browser }) => {
    await mkdir(artifacts, { recursive: true });
    const dir = join(artifacts, 'export');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    const page = await openViewer(browser, { seed: await buildSeed() });
    await enterTemplate(page);
    await selectModule(page, MODULE_A);
    await expect(page.locator(`[data-survey-marker-id="${seedId(A1_MOVED)}"]`)).toHaveCount(1);

    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
    await page.getByRole('button', { name: 'Export annotated PDF' }).click();
    const download = await downloadPromise;
    const pdfPath = join(dir, 'exported.pdf');
    await download.saveAs(pdfPath);
    await execFileAsync('pdftoppm', ['-png', '-r', '100', pdfPath, join(dir, 'page')]);

    const found = {};
    for (const spec of [...MODULE_A_SET, ...MODULE_B_SET]) {
      const buffer = await rasterSheet(dir, 'page', spec.page);
      const { yellow, painted } = await countInRect(buffer, spec);
      found[spec.name] = { yellow, painted };
    }
    await page.close();

    // One combined assertion so a failure names EVERY missing marker, not just
    // the first one.
    const carried = Object.fromEntries(
      [...MODULE_A_SET, ...MODULE_B_SET].map((spec) => [spec.name, found[spec.name].painted > 200]),
    );
    expect(
      carried,
      `Survey Markers missing from the exported PDF. Painted pixels per marker region: ${JSON.stringify(found)}`,
    ).toEqual(Object.fromEntries([...MODULE_A_SET, ...MODULE_B_SET].map((spec) => [spec.name, true])));
  });
});

// ============================================================================
// Behaviour 5b: browser print. Seeded so it stands alone.
//
// KNOWN FAILING as of 2026-09-02, and this one is a straight bug. The print
// pipeline DOES include Survey Markers — the run logs
// printableDiagnostics.included.surveyMarkers = N — but the flatten loop at
// src/utils/pdfAnnotationsPdfLib.js:4037 reads marker.x / marker.y /
// marker.width / marker.height, while a marker the app actually saves stores
// its geometry under marker.bounds. Every marker is therefore flattened as a
// zero-size rectangle at the page origin, so nothing appears on paper.
// (The print-fidelity fixture hides this: its seeded marker carries BOTH
// top-level x/y/width/height and bounds.) Secondary: the print payload builder
// carries every module's markers with no filter, so once the geometry is fixed
// the other module's markers will print too.
// ============================================================================

test.describe('Survey Marker print', () => {
  test('5b. printing carries the selected module and not the other one', async ({ browser }) => {
    test.setTimeout(180_000);
    await mkdir(artifacts, { recursive: true });
    const dir = join(artifacts, 'print');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    const page = await openViewer(browser, { seed: await buildSeed() });
    await enterTemplate(page);
    await selectModule(page, MODULE_A);
    await expect(page.locator(`[data-survey-marker-id="${seedId(A1_MOVED)}"]`)).toHaveCount(1);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
    await expect.poll(() => page.evaluate(() => window.__browserPrintCalls), { timeout: 120_000 }).toBe(1);
    await expect(page.locator('[data-browser-print-document]'))
      .toHaveAttribute('data-browser-print-ready', 'true', { timeout: 120_000 });
    await page.emulateMedia({ media: 'print' });
    const printPdf = join(dir, 'browser-print.pdf');
    await page.pdf({ path: printPdf, printBackground: true, preferCSSPageSize: true });
    await page.emulateMedia({ media: null });
    await page.close();
    await execFileAsync('pdftoppm', ['-png', '-r', '100', printPdf, join(dir, 'sheet')]);

    // Sheet-wide marker paint. A Survey Marker prints as a translucent yellow
    // block, which nothing in the source PDF uses, so a yellow count per sheet
    // isolates the markers from the document's own red / green / black marks.
    const perSheet = {};
    for (const n of [1, 6, 8]) perSheet[n] = (await countInWholeImage(await rasterSheet(dir, 'sheet', n))).yellow;

    expect(
      {
        'module A markers on printed sheet 1': perSheet[1] > 200,
        'module A marker on printed sheet 6': perSheet[6] > 200,
        "module B's marker leaked onto printed sheet 8": perSheet[8] > 200,
      },
      `printed marker pixels per sheet: ${JSON.stringify(perSheet)}`,
    ).toEqual({
      'module A markers on printed sheet 1': true,
      'module A marker on printed sheet 6': true,
      "module B's marker leaked onto printed sheet 8": false,
    });
  });
});

// ============================================================================
// Behaviour 6: leaving survey mode. Seeded so it stands alone.
// ============================================================================

test.describe('Leaving survey mode', () => {
  test('6. regular markup returns and Survey Markers are hidden', async ({ browser }) => {
    await mkdir(artifacts, { recursive: true });
    const page = await openViewer(browser, { seed: await buildSeed() });

    // Before any template: this PDF's imported markup is on screen.
    await showPage(page, 1);
    await page.keyboard.press('v');
    await expect(layerEl(page, 1).locator('[data-anno-id]')).not.toHaveCount(0);
    const regularBefore = await layerEl(page, 1).locator('[data-anno-id]').count();
    await shotPage(page, 1, 'regular-markup-before-survey.png');

    await enterTemplate(page);
    await selectModule(page, MODULE_A);
    await showPage(page, 1);
    await page.keyboard.press('v');
    await expect(layerEl(page, 1).locator(`[data-survey-marker-id="${seedId(A1_MOVED)}"]`)).toHaveCount(1);
    expect(
      await layerEl(page, 1).locator('[data-anno-id]').count(),
      'regular markup must stay hidden while a template is active',
    ).toBe(0);

    await page.getByRole('button', { name: 'Close Survey panel' }).click();
    await expect(page.getByRole('button', { name: 'Survey', exact: true })).toBeVisible();
    await showPage(page, 1);
    await page.keyboard.press('v');

    await expect(layerEl(page, 1).locator('[data-anno-id]')).toHaveCount(regularBefore);
    await expect(layerEl(page, 1).locator('[data-survey-marker-id]')).toHaveCount(0);
    const shot = await shotPage(page, 1, 'survey-exited-page-1.png');
    expect((await countInRect(shot, A1_MOVED)).blue, 'a Survey Marker still paints outside survey mode')
      .toBeLessThan(20);
    await page.close();
  });
});
