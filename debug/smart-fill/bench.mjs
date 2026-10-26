// Smart fill accuracy bench on a real shop drawing (owner 2026-10-22).
// Ground truth: every tag ID printed on the sheet (e.g. 310H-F03-C93) sits
// inside its tag; the tag is the closed outline drawn around that text.
// Taps: the tag's middle (on its divider line), the ID text, and four points
// halfway to the edge. A hit = the filled outline overlaps the true tag by
// IoU >= 0.8. Runs the pixel engine exactly as the app does (pdf.js crop at
// 3 px/unit, adaptive ink mask, tolerant flood) and the vector engine.
// Usage: node debug/smart-fill/bench.mjs [pdf] [pages e.g. 6-11] [--json out]
import { readFileSync, writeFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { adaptiveInkMaskFromRgba, findTagOutlineTolerant } from '../../src/survey/smartFillEngine.js';
import { extractClosedShapes, pickShapeAtPoint, pixelsBeatVector, pointInRing, vectorAnswerIsTagSized } from '../../src/survey/smartFillVector.js';
import { findOutlineWithTemplates, makeTemplateShape, vectorShapeMatchesTemplate } from '../../src/survey/smartFillTemplates.js';

const args = process.argv.slice(2);
const file = args[0] || 'debug/fixtures/package2-rev4.pdf';
const [p0, p1] = (args[1] || '6-11').split('-').map(Number);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const engines = (args.includes('--engines') ? args[args.indexOf('--engines') + 1] : 'raster,vector,auto').split(',');
const TAG_RE = /^\d{3}[A-Z]?-[A-Z0-9]+(-[A-Z0-9]+)*/;

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;

function bbox(ring) {
  let a = Infinity; let b = Infinity; let c = -Infinity; let d = -Infinity;
  for (const [x, y] of ring) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a, b, c, d];
}
function iou(ringA, ringB) {
  const A = bbox(ringA); const B = bbox(ringB);
  const x0 = Math.min(A[0], B[0]); const y0 = Math.min(A[1], B[1]);
  const x1 = Math.max(A[2], B[2]); const y1 = Math.max(A[3], B[3]);
  const step = Math.max(0.2, Math.max(x1 - x0, y1 - y0) / 160);
  let both = 0; let either = 0;
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) {
      const a = x >= A[0] && x <= A[2] && y >= A[1] && y <= A[3] && pointInRing(x, y, ringA);
      const b = x >= B[0] && x <= B[2] && y >= B[1] && y <= B[3] && pointInRing(x, y, ringB);
      if (a && b) both += 1;
      if (a || b) either += 1;
    }
  }
  return either ? both / either : 0;
}

const K = 3; const HALF = 180;
// The whole page is drawn once at the app's tap detail (3 px per unit) and
// each tap crops the same 360-unit window the app renders, so the pixels
// match the app's per-tap pdf.js crop without re-drawing the page per tap.
const pageRenders = new Map();
async function renderPage(page) {
  if (pageRenders.has(page)) return pageRenders.get(page);
  const viewport = page.getViewport({ scale: K });
  const W = Math.round(viewport.width); const H = Math.round(viewport.height);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  await page.render({ canvasContext: ctx, canvas, viewport, background: 'white', annotationMode: 0 }).promise;
  const out = { W, H, data: ctx.getImageData(0, 0, W, H).data };
  pageRenders.clear(); pageRenders.set(page, out);
  return out;
}
async function rasterCrop(page, pageSize, point) {
  const { W, data: full } = await renderPage(page);
  const left = Math.max(0, point.x - HALF); const top = Math.max(0, point.y - HALF);
  const right = Math.min(pageSize.width, point.x + HALF); const bottom = Math.min(pageSize.height, point.y + HALF);
  const x0 = Math.round(left * K); const y0 = Math.round(top * K);
  const width = Math.round((right - left) * K); const height = Math.round((bottom - top) * K);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) rgba.set(full.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + width) * 4), y * width * 4);
  return { rgba, width, height, seedX: (point.x - left) * K, seedY: (point.y - top) * K, toPage: ([x, y]) => [left + x / K, top + y / K] };
}
async function rasterTap(page, pageSize, point, templates = null) {
  const crop = await rasterCrop(page, pageSize, point);
  const mask = adaptiveInkMaskFromRgba(crop.rgba, crop.width, crop.height);
  const res = templates
    ? findOutlineWithTemplates(mask, crop.width, crop.height, crop.seedX, crop.seedY, templates, K)
    : findTagOutlineTolerant(mask, crop.width, crop.height, crop.seedX, crop.seedY);
  if (!res?.ok) return { ok: false, reason: res?.reason };
  return { ok: true, ring: res.ring.map(crop.toPage) };
}

const rows = [];
const perEngine = Object.fromEntries(engines.map((e) => [e, { taps: 0, hits: 0, tags: 0, tagsAllHit: 0, reasons: {} }]));
for (let pn = p0; pn <= p1; pn += 1) {
  const page = await doc.getPage(pn);
  const vp = page.getViewport({ scale: 1 });
  const pageSize = { width: vp.width, height: vp.height };
  const t0 = Date.now();
  const ops = await page.getOperatorList({ intent: 'display', annotationMode: 0 });
  const shapes = extractClosedShapes(ops, pdfjs.OPS, vp.transform);
  const vecMs = Date.now() - t0;
  const tc = await page.getTextContent();
  const texts = tc.items.filter((t) => TAG_RE.test(t.str.trim()));
  let unmatched = 0;
  // 'taught': the user taught Smart fill one tag on this sheet (the first
  // tag's outline, as if boxed), then taps the rest on pixels only.
  let taught = null;
  for (const t of texts) {
    // Text box centre in page units.
    const [a, b, c, d, e, f] = t.transform;
    const fs = Math.hypot(c, d) || t.height;
    const ux = a / (Math.hypot(a, b) || 1); const uy = b / (Math.hypot(a, b) || 1);
    const cxU = e + ux * t.width / 2 - uy * (-fs * 0.35);
    const cyU = f + uy * t.width / 2 + ux * (fs * 0.35);
    const [tx, ty] = vp.convertToViewportPoint(cxU, cyU);
    // Truth: the smallest closed outline round the ID that is clearly a tag.
    const truth = shapes.filter((s) => tx >= s.minX && tx <= s.maxX && ty >= s.minY && ty <= s.maxY && pointInRing(tx, ty, s.ring))
      .sort((s1, s2) => s1.area - s2.area)[0];
    if (!truth) { unmatched += 1; rows.push({ page: pn, tag: t.str.trim(), truth: null }); continue; }
    const cx = (truth.minX + truth.maxX) / 2; const cy = (truth.minY + truth.maxY) / 2;
    const r = Math.min(truth.width, truth.height) / 2;
    const taps = [
      ['middle', cx, cy], ['text', tx, ty],
      ['up', cx, cy - r * 0.5], ['down', cx, cy + r * 0.5], ['left', cx - r * 0.5, cy], ['right', cx + r * 0.5, cy],
    ];
    if (!taught) taught = [makeTemplateShape(truth.ring, { source: 'bench' })];
    const row = { page: pn, tag: t.str.trim(), size: [+truth.width.toFixed(1), +truth.height.toFixed(1)], results: {} };
    for (const eng of engines) {
      let allHit = true;
      row.results[eng] = [];
      for (const [name, x, y] of taps) {
        let res;
        if (eng === 'raster') res = await rasterTap(page, pageSize, { x, y });
        else if (eng === 'vector') { const s = pickShapeAtPoint(shapes, { x, y }); res = s ? { ok: true, ring: s.ring } : { ok: false, reason: 'no-shape' }; }
        else if (eng === 'taught') res = await rasterTap(page, pageSize, { x, y }, taught);
        else {
          // 'auto' = the app's order (smartFillProvider.readSmartFillOutlineAsync).
          const s = pickShapeAtPoint(shapes, { x, y }, { prefer: (v) => vectorShapeMatchesTemplate(v, taught) });
          if (vectorAnswerIsTagSized(s)) res = { ok: true, ring: s.ring };
          else {
            const px = await rasterTap(page, pageSize, { x, y }, taught);
            res = !s ? px : (px.ok && pixelsBeatVector(s, px.ring)) ? px : { ok: true, ring: s.ring };
          }
        }
        const score = res.ok ? iou(res.ring, truth.ring) : 0;
        const hit = score >= 0.8;
        const why = hit ? 'hit' : res.ok ? (score < 0.8 && bbox(res.ring)[2] - bbox(res.ring)[0] > truth.width * 1.3 ? 'too-big' : 'wrong-shape') : res.reason;
        perEngine[eng].taps += 1; if (hit) perEngine[eng].hits += 1;
        perEngine[eng].reasons[why] = (perEngine[eng].reasons[why] || 0) + 1;
        if (!hit) allHit = false;
        row.results[eng].push({ tap: name, iou: +score.toFixed(2), why });
      }
      perEngine[eng].tags += 1; if (allHit) perEngine[eng].tagsAllHit += 1;
    }
    rows.push(row);
  }
  console.log(`page ${pn}: ${texts.length} tag IDs, ${unmatched} with no closed outline, ${shapes.length} closed shapes (${vecMs} ms)`);
}
console.log('\nengine   taps  tap-hit%  tags  tags-all-taps-hit%  misses');
for (const [eng, s] of Object.entries(perEngine)) {
  const misses = Object.entries(s.reasons).filter(([k]) => k !== 'hit').map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`${eng.padEnd(8)} ${String(s.taps).padStart(5)}  ${(100 * s.hits / Math.max(1, s.taps)).toFixed(1).padStart(7)}  ${String(s.tags).padStart(4)}  ${(100 * s.tagsAllHit / Math.max(1, s.tags)).toFixed(1).padStart(17)}  ${misses}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ file, pages: [p0, p1], perEngine, rows }, null, 1));
