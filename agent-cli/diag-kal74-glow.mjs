// agent-cli/diag-kal74-glow.mjs — KAL-74 spotlight alignment diagnostic.
// Opens the doc, draws one stroke, clicks the history row, dumps the glow svg
// geometry vs every candidate path in the stroke's g, plus host-overlay offsets.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createSupabaseMock } from './lib/supabaseMock.mjs';
import {
  buildFixtures, createHistoryStore, createRevisionStore, buildKal48RpcHandlers, DOC_NAME,
} from './lib/kal74Fixtures.mjs';

const PORT = Number(process.env.PORT || 5176);
const BASE = `http://localhost:${PORT}/`;
const PDF_FIXTURE = 'debug/fixtures/se011.pdf';
const log = (...a) => console.log(...a);

async function startVite() {
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 60000;
  for (;;) {
    try { const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) }); if (res.ok) return child; } catch {}
    if (Date.now() > deadline) { child.kill('SIGTERM'); throw new Error('vite not ready'); }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  const vite = await startVite();
  const browser = await chromium.launch({ headless: true });
  try {
    const fixtures = buildFixtures();
    const historyStore = createHistoryStore();
    const revStore = createRevisionStore();
    const mock = createSupabaseMock({
      fixtures, pdfPath: PDF_FIXTURE, log: () => {},
      rpcHandlers: buildKal48RpcHandlers(revStore),
      readHandlerOverrides: historyStore.readOverrides,
      onMutation: historyStore.onMutation,
    });
    const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
    const page = await ctx.newPage();
    await mock.register(page);
    page.on('dialog', (d) => d.accept().catch(() => {}));

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const tile = page.getByText(DOC_NAME, { exact: false }).first();
    await tile.waitFor({ state: 'visible', timeout: 30000 });
    await tile.click();
    await page.waitForTimeout(600);
    await tile.dblclick().catch(() => {});
    await page.waitForFunction(() => Array.from(document.querySelectorAll('canvas')).some((c) => c.width > 100 && c.height > 100), undefined, { timeout: 45000 });
    await page.waitForFunction(() => window.__crdtBackfillDone === true, undefined, { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('g[data-annotation-index]').length >= 3, undefined, { timeout: 20000 });
    await page.waitForTimeout(2000);

    const idsBefore = await page.evaluate(() => [...document.querySelectorAll('g[data-annotation-id]')].map((g) => g.getAttribute('data-annotation-id')));
    const pr = await page.evaluate(() => {
      const d = document.querySelector('.e-pv-page-div');
      const r = d.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const from = { x: pr.x + pr.w * 0.45, y: pr.y + pr.h * 0.55 };
    await page.keyboard.press('p');
    await page.waitForTimeout(800);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 80, from.y + 50, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.waitForTimeout(1000);

    const idsAfter = await page.evaluate(() => [...document.querySelectorAll('g[data-annotation-id]')].map((g) => g.getAttribute('data-annotation-id')));
    const strokeId = idsAfter.find((id) => !idsBefore.includes(id));
    log('strokeId:', strokeId);

    await page.locator('button[aria-label="Version History"]').first().click();
    await page.locator('[data-testid="kal48-revisions-panel"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.locator('[data-testid^="document-history-event-"]').filter({ hasText: /drew a pen stroke/ }).first().click();
    await page.waitForTimeout(1500);

    const dump = await page.evaluate((id) => {
      const out = {};
      const svg = document.getElementById('document-history-spotlight-svg');
      if (svg) {
        const sr = svg.getBoundingClientRect();
        const shape = svg.firstElementChild;
        const shr = shape?.getBoundingClientRect();
        out.spotlight = {
          svgRect: { x: sr.x, y: sr.y, w: sr.width, h: sr.height },
          viewBox: svg.getAttribute('viewBox'),
          styleLeftTop: { left: svg.style.left, top: svg.style.top, width: svg.style.width, height: svg.style.height },
          parent: `${svg.parentElement.tagName}.${String(svg.parentElement.className).slice(0, 50)}`,
          shapeTag: shape?.tagName,
          shapeTransform: shape?.getAttribute('transform'),
          shapeD: (shape?.getAttribute('d') || '').slice(0, 120),
          shapeRect: shr ? { x: shr.x, y: shr.y, w: shr.width, h: shr.height } : null,
        };
      }
      const esc = CSS.escape(id);
      const g = document.querySelector(`g[data-annotation-id="${esc}"]`);
      if (g) {
        const gr = g.getBoundingClientRect();
        out.annotationG = { rect: { x: gr.x, y: gr.y, w: gr.width, h: gr.height }, transform: g.getAttribute('transform') };
        out.children = Array.from(g.querySelectorAll('*')).slice(0, 12).map((el) => {
          const r = el.getBoundingClientRect();
          const cs = el instanceof SVGGraphicsElement ? getComputedStyle(el) : null;
          return {
            tag: el.tagName,
            d: (el.getAttribute && (el.getAttribute('d') || '')).slice(0, 100),
            stroke: cs?.stroke, sw: cs?.strokeWidth, op: cs?.strokeOpacity, fill: cs?.fill,
            pe: cs?.pointerEvents,
            rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
          };
        });
        // host svg layer
        const host = g.closest('svg');
        if (host) {
          const hr = host.getBoundingClientRect();
          out.hostSvg = {
            rect: { x: hr.x, y: hr.y, w: hr.width, h: hr.height },
            viewBox: host.getAttribute('viewBox'),
            left: host.style.left, top: host.style.top,
            attrs: { width: host.getAttribute('width'), height: host.getAttribute('height') },
            dataLayer: host.getAttribute('data-svg-annotation-layer'),
          };
        }
      }
      // the page div
      const pd = document.querySelector('.e-pv-page-div');
      const pdr = pd?.getBoundingClientRect();
      out.pageDiv = pdr ? { x: pdr.x, y: pdr.y, w: pdr.width, h: pdr.height } : null;
      // containment probes (spotlight host-resolution bug)
      const hostSvgEl = document.querySelector('svg[data-svg-annotation-layer]');
      out.containment = {
        pageDivHasDataPageNumber: pd?.getAttribute('data-page-number') || null,
        pageDivContainsHostSvg: pd ? pd.contains(hostSvgEl) : null,
        hostSvgAncestors: (() => {
          const chain = [];
          let n = hostSvgEl;
          for (let i = 0; i < 8 && n; i += 1) {
            chain.push(`${n.tagName}#${n.id || ''}.${String(n.className?.baseVal ?? n.className ?? '').slice(0, 40)}`);
            n = n.parentElement;
          }
          return chain;
        })(),
        firstDataPageNumberEl: (() => {
          const el = document.querySelector('[data-page-number="1"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { tag: el.tagName, cls: String(el.className).slice(0, 60), rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }, containsHostSvg: el.contains(hostSvgEl) };
        })(),
      };
      return out;
    }, strokeId);
    log(JSON.stringify(dump, null, 2));
  } finally {
    await browser.close().catch(() => {});
    vite.kill('SIGTERM');
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
