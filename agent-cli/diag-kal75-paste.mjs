// agent-cli/diag-kal75-paste.mjs — one-off diagnostic for the KAL-75 S5 paste
// positive. Answers: does Cmd+C→Cmd+V fail because (a) the clipboard state
// hasn't propagated to the re-registered keydown handler yet (race), or
// (b) elementFromPoint→closest('.survey-pdfjs-page-div') resolves no page at the
// cursor point? Throwaway — delete after the harness fix lands.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createSupabaseMock } from './lib/supabaseMock.mjs';
import { buildFixtures, buildLockRpcHandlers, DOC_OWNED_NAME } from './lib/kal75Fixtures.mjs';

const PORT = Number(process.env.PORT || 5176);
const BASE = `http://localhost:${PORT}/`;
const log = (...a) => console.log(...a);

async function startVite() {
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  const deadline = Date.now() + 60000;
  for (;;) {
    try { const r = await fetch(BASE, { signal: AbortSignal.timeout(2000) }); if (r.ok) return child; } catch {}
    if (Date.now() > deadline) { child.kill('SIGTERM'); throw new Error('vite not ready'); }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  const vite = await startVite();
  const browser = await chromium.launch({ headless: !process.env.HEADFUL });
  try {
    const fixtures = buildFixtures();
    const mock = createSupabaseMock({ fixtures, pdfPath: 'debug/fixtures/se011.pdf', log: () => {}, rpcHandlers: buildLockRpcHandlers(fixtures) });
    const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
    const page = await ctx.newPage();
    await mock.register(page);
    page.on('dialog', (d) => d.dismiss().catch(() => {}));

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const tile = page.getByText(DOC_OWNED_NAME, { exact: false }).first();
    await tile.waitFor({ state: 'visible', timeout: 30000 });
    await tile.click(); await page.waitForTimeout(600); await tile.dblclick().catch(() => {});
    await page.waitForFunction(() => Array.from(document.querySelectorAll('canvas')).some((c) => c.width > 100), undefined, { timeout: 45000 });
    await page.waitForTimeout(2500);
    // Canvas-presentation era (a3380bbf): g[data-annotation-index] only exists
    // while the SVG layer is mounted — 'v' switches to Select, which mounts it.
    await page.keyboard.press('v');
    await page.waitForTimeout(400);

    const fabricCount = () => page.evaluate(() => document.querySelectorAll('g[data-annotation-index]').length);
    const cornerOf = (i) => page.evaluate((idx) => {
      const gs = Array.from(document.querySelectorAll('g[data-annotation-index]'));
      const g = gs[idx]; if (!g) return null;
      const r = g.getBoundingClientRect();
      return { x: r.x + r.width * 0.4, y: r.y + r.height - 1 };
    }, i);

    log(`annotations rendered: ${await fabricCount()}`);
    // select like the harness does
    let selPt = null;
    for (let i = (await fabricCount()) - 1; i >= 0 && !selPt; i -= 1) {
      const pt = await cornerOf(i);
      if (!pt) continue;
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(400);
      if (await page.evaluate(() => !!document.querySelector('.svg-selection-overlay'))) selPt = pt;
    }
    log(`selection: ${selPt ? 'OK at ' + JSON.stringify(selPt) : 'FAILED'}`);
    if (!selPt) process.exit(1);

    // probe the paste target resolution exactly like PDFViewer.jsx:21090-21096
    const target = { x: selPt.x + 40, y: selPt.y + 60 };
    const resolution = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const pageDiv = el?.closest?.('.survey-pdfjs-page-div') || null;
      const palWrap = pageDiv?.querySelector?.('[data-diag-svg-wrapper], [data-pal-root]');
      const attr = palWrap?.getAttribute?.('data-diag-svg-wrapper') || palWrap?.getAttribute?.('data-pal-root');
      return {
        topEl: el ? `${el.tagName}.${(el.className?.baseVal ?? el.className ?? '').toString().slice(0, 40)}` : null,
        pageDivFound: !!pageDiv,
        palWrapFound: !!palWrap,
        pageNumAttr: attr ?? null,
      };
    }, target);
    log(`paste-point resolution at ${JSON.stringify(target)}: ${JSON.stringify(resolution)}`);

    // identify the blocking svg: full hit stack + parent chain
    const anatomy = await page.evaluate(({ x, y }) => {
      const describe = (el) => el ? {
        tag: el.tagName,
        cls: (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 50),
        data: Object.keys(el.dataset || {}),
        pe: getComputedStyle(el).pointerEvents,
        rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
      } : null;
      const stack = (document.elementsFromPoint(x, y) || []).slice(0, 8).map(describe);
      const top = document.elementFromPoint(x, y);
      const parents = [];
      let n = top;
      for (let i = 0; i < 8 && n; i += 1) { parents.push(describe(n)); n = n.parentElement; }
      return { stack, parents };
    }, target);
    log('hit stack:'); for (const s of anatomy.stack) log('  ' + JSON.stringify(s));
    log('parent chain of top element:'); for (const p of anatomy.parents) log('  ' + JSON.stringify(p));

    // copy, then IMMEDIATE paste (harness timing) — the race arm
    await page.keyboard.press('Meta+c');
    await page.mouse.move(target.x, target.y);
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(2000);
    const afterImmediate = await fabricCount();
    log(`immediate paste: count ${afterImmediate} (want 4 → ${afterImmediate === 4 ? 'NO RACE' : 'failed'})`);

    if (afterImmediate !== 4) {
      // delayed retry — if THIS works, it was a propagation race
      await page.waitForTimeout(800);
      await page.keyboard.press('Meta+v');
      await page.waitForTimeout(2000);
      const afterDelayed = await fabricCount();
      log(`delayed paste retry: count ${afterDelayed} (4 ⇒ RACE was the cause; 3 ⇒ paste path broken)`);
    }
    const muts = mock.mutations.filter((m) =>
      m.table === 'annotation_updates'
      || m.table === 'rpc/append_annotation_update');
    log(`annotation_updates writes recorded: ${muts.length}`);
  } finally {
    await browser.close().catch(() => {});
    vite.kill('SIGTERM');
  }
}
main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
