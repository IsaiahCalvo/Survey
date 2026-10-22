// Cost of the position hit test (utils/annotationHitTest.js resolveAnnotationAt)
// that the Pan halo runs once per frame while the mouse moves, the Pan click
// pick and the pan-text mark check. Opens the offline ?testPdf fixture
// (nothing saved), draws MARKS pen strokes across page 1, arms Pan and times
// resolveAnnotationAt at points on a stroke, on bare text and on blank page.
//
//   node scripts/perf/hit-test-bench.mjs            (starts its own Vite)
//   VERIFY_URL=http://127.0.0.1:5263 MARKS=300 node scripts/perf/hit-test-bench.mjs
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.VERIFY_PORT || 5264);
const baseUrl = process.env.VERIFY_URL || `http://127.0.0.1:${port}`;
const MARKS = Number(process.env.MARKS || 140);
const CALLS = Number(process.env.CALLS || 300);

const server = process.env.VERIFY_URL ? null : spawn(process.execPath, [
  resolve(repoRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort',
], { cwd: repoRoot, env: { ...process.env, BROWSER: 'none' }, stdio: 'ignore' });

const waitForServer = async () => {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    try { if ((await fetch(baseUrl)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Vite did not start on ${baseUrl}`);
};

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${baseUrl}/?testPdf=text-search-glyph-lab.pdf`);
  await page.waitForSelector('#chrome-top-host [aria-label="Draw"]', { timeout: 120_000 });
  await page.waitForTimeout(1500);
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  const left = Math.max(box.x, 330) + 10;
  const right = Math.min(box.x + box.width, 1390) - 10;
  const top = Math.max(box.y, 80) + 10;
  const bottom = Math.min(box.y + box.height, 890) - 10;

  // Wavy pen strokes spread over the visible page, 24 points each.
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  for (let i = 0; i < MARKS; i += 1) {
    const y = top + ((bottom - top) * (i + 0.5)) / MARKS;
    const x0 = left + ((i * 37) % 120);
    const span = Math.min(260, right - x0);
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let k = 1; k <= 24; k += 1) await page.mouse.move(x0 + (span * k) / 24, y + Math.sin(k / 3) * 4);
    await page.mouse.up();
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('m');
  await page.waitForTimeout(1500);
  const drawn = await page.locator('[data-overlay-page="1"] [data-annotation-index]').evaluateAll((n) => new Set(n.map((e) => e.getAttribute('data-annotation-index'))).size);

  const result = await page.evaluate(async ({ calls, points }) => {
    const { resolveAnnotationAt } = await import('/src/utils/annotationHitTest.js');
    const out = {};
    for (const [name, pt] of Object.entries(points)) {
      const target = document.elementFromPoint(pt.x, pt.y);
      const event = { clientX: pt.x, clientY: pt.y, target, composedPath: () => { const p = []; for (let n = target; n; n = n.parentNode) p.push(n); return p; } };
      let hit = resolveAnnotationAt(event);
      const t0 = performance.now();
      for (let i = 0; i < calls; i += 1) hit = resolveAnnotationAt(event);
      out[name] = { msPerCall: (performance.now() - t0) / calls, kind: hit?.kind, index: hit?.annotationIndex ?? null };
    }
    return out;
  }, {
    calls: CALLS,
    points: {
      // On the middle stroke's start (its first point is exact).
      onStroke: { x: left + (((Math.floor(MARKS / 2)) * 37) % 120) + 1, y: top + ((bottom - top) * (Math.floor(MARKS / 2) + 0.5)) / MARKS },
      // Blank page right of every stroke.
      blank: { x: right - 4, y: (top + bottom) / 2 + 1.5 },
    },
  });
  // GRID=1: what the hit test answers at every 3 px over the strokes, to
  // diff two builds (a speed change must not move a single answer).
  if (process.env.GRID) {
    result.grid = await page.evaluate(async ({ x0, y0, x1, y1 }) => {
      const { resolveAnnotationAt } = await import('/src/utils/annotationHitTest.js');
      const answers = [];
      for (let y = y0; y <= y1; y += 3) {
        for (let x = x0; x <= x1; x += 3) {
          const hit = resolveAnnotationAt({ clientX: x, clientY: y, target: document.elementFromPoint(x, y) });
          answers.push(hit?.kind === 'annotation' ? hit.annotationIndex : '-');
        }
      }
      const hits = answers.filter((a) => a !== '-').length;
      let hash = 0;
      for (const ch of answers.join(',')) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
      return { points: answers.length, hits, hash };
    }, { x0: left, y0: top, x1: Math.min(right, left + 420), y1: Math.min(bottom, top + 240) });
  }
  console.log(JSON.stringify({ marks: drawn, calls: CALLS, ...result }, null, 2));
} finally {
  await browser?.close();
  server?.kill();
}
