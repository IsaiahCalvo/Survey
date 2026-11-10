// Open: the page on screen first (flag 'open-visible-first', 2026-11-10:
// "pages and marks loading as fast as possible").
//
// A phone opening a big set built the marks of six pages (2,476 shapes on
// the 36-sheet set) before page 1 had even drawn, and the second snapshot
// decode landed right before the page's own drawing: page 1 came up at
// 3.2-3.5 s. With the flag, only the pages on screen mount at first and
// their marks show with the drawing in one frame; the pages around them
// mount once those show, one per idle moment.
//
// This walk opens a 10-sheet set with marks on every sheet, cold, on a phone
// with a slowed CPU, frame by frame, and checks:
//   - page 1's drawing and all of its marks first show in the same frame;
//   - by then no sheet below the screen has its marks built;
//   - those sheets do get theirs a moment later (nothing is left behind).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const PAGES = 10;
const MARKS_PER_PAGE = 40;
const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';

async function seedDocument() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < PAGES; p += 1) {
    // Portrait sheets: a phone shows about one and a half of them.
    const page = pdf.addPage([612, 792]);
    page.drawText(`Sheet ${p + 1}`, { x: 60, y: 720, size: 36, font, color: rgb(0, 0, 0) });
    for (let i = 0; i < 40; i += 1) {
      page.drawLine({ start: { x: 40 + ((i * 29) % 520), y: 80 + ((i * 31) % 560) }, end: { x: 90 + ((i * 37) % 500), y: 100 + ((i * 23) % 600) }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
    }
  }
  const bytes = Buffer.from(await pdf.save());
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const id = randomUUID();
  const filePath = `${ownerId}/${id}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const now = new Date().toISOString();
  const name = `E2E open first ${Date.now()}.pdf`;
  const doc = await admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: filePath, file_size: bytes.length, page_count: PAGES,
    cutover_completed_at: now, embedded_import_completed_at: now,
  });
  if (doc.error) throw doc.error;
  return {
    id,
    name,
    async remove() {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([filePath]);
    },
  };
}

// Marks of two kinds on every page, written through the app's own store
// mapping and appended as the owner (page-and-marks-together.spec.mjs does
// the same for one busy page).
const MARKS_UPDATE = `
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { syncByPageToDoc } from './src/services/annotationDocStore.js';
const [pages, perPage] = process.argv.slice(1).map(Number);
const byPage = {};
for (let p = 1; p <= pages; p += 1) {
  const objects = [];
  for (let i = 0; i < perPage; i += 1) {
    const id = randomUUID();
    const left = 30 + ((i * 53) % 500);
    const top = 40 + ((i * 97) % 680);
    if (i % 2) objects.push({ type: 'rect', left, top, width: 40, height: 24, stroke: '#1565c0', fill: 'transparent', strokeWidth: 2, data: { id } });
    else objects.push({ type: 'path', path: [['M', left, top], ['L', left + 50, top + 8], ['L', left + 90, top - 4]], left, top: top - 4, width: 90, height: 12, stroke: '#d22', fill: null, strokeWidth: 3, data: { id, type: 'ink' } });
  }
  byPage[p] = { objects };
}
const doc = new Y.Doc();
const pending = [];
doc.on('update', (u) => { pending.push(u); });
syncByPageToDoc(doc, byPage);
process.stdout.write(Buffer.from(Y.mergeUpdates(pending)).toString('hex'));
`;

async function seedMarks(documentId) {
  const hex = execFileSync(process.execPath, ['--input-type=module', '-e', MARKS_UPDATE, String(PAGES), String(MARKS_PER_PAGE)], {
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const { error } = await owner.rpc('append_annotation_update', {
    p_document_id: documentId, p_client_id: `open-first-seed-${Date.now()}`, p_client_seq: 1, p_data: `\\x${hex}`,
  });
  if (error) throw error;
}

// Runs in the page on every navigation: one row per frame in which page 1's
// drawing as seen, its marks as seen, or the set of pages with marks built
// (mounted, seen or not) changed.
function frameProbe() {
  const rows = [];
  window.__frameRows = rows;
  const t0 = performance.now();
  const probe = document.createElement('canvas');
  probe.width = 64;
  probe.height = 42;
  let inkCanvas = null;
  const shown = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const hasInk = (canvas) => {
    if (!canvas || !canvas.width || !canvas.isConnected || !shown(canvas)) return false;
    if (canvas === inkCanvas) return true;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 64, 42);
    ctx.drawImage(canvas, 0, 0, 64, 42);
    const { data } = ctx.getImageData(0, 0, 64, 42);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && data[i] < 160) { inkCanvas = canvas; return true; }
    }
    return false;
  };
  let last = '';
  const tick = () => {
    const ink = hasInk(document.querySelector('.survey-pdfjs-page-div[data-page-number="1"] canvas.survey-pdfjs-page-canvas'));
    const built = [];
    let page1 = 0;
    for (const host of document.querySelectorAll('[data-pdfjs-page-overlay-host][data-overlay-page]')) {
      const n = new Set([...host.querySelectorAll('[data-annotation-id]')].map((el) => el.getAttribute('data-annotation-id'))).size;
      if (!n) continue;
      const pageNumber = Number(host.getAttribute('data-overlay-page'));
      built.push(pageNumber);
      // Built means mounted; page 1 counts only marks a person can see.
      if (pageNumber === 1 && shown(host)) page1 = n;
    }
    built.sort((a, b) => a - b);
    const mounted = [...document.querySelectorAll('.survey-pdfjs-page-div[data-page-mounted="true"]')].map((el) => Number(el.dataset.pageNumber));
    const drawn = [...document.querySelectorAll('.survey-pdfjs-page-div[data-raster-shown]')].map((el) => Number(el.dataset.pageNumber));
    const key = `${ink}|${page1}|${built.join(',')}|${mounted.join(',')}|${drawn.join(',')}`;
    if (key !== last) {
      rows.push({ t: Math.round(performance.now() - t0), ink, page1, built, mounted, drawn });
      last = key;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Pages whose box is on screen in the scroller right now.
function onScreenPages() {
  const first = document.querySelector('.survey-pdfjs-page-div');
  const scroller = first?.closest('[data-pdfjs-scroller], .survey-pdfjs-scroller') || first?.parentElement?.parentElement;
  const sr = scroller.getBoundingClientRect();
  return [...document.querySelectorAll('.survey-pdfjs-page-div[data-page-number]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > sr.top + 4 && r.top < sr.bottom - 4; })
    .map((el) => Number(el.dataset.pageNumber));
}

test('a phone opening a set cold builds the page on screen first, then the pages around it', async ({ page, context, browser, baseURL }) => {
  test.setTimeout(240_000);
  const seeded = await seedDocument();
  try {
    await seedMarks(seeded.id);
    await signIn(page, E2E_ACCOUNTS.owner);
    const storageState = await context.storageState();
    const phone = await browser.newContext({ baseURL, storageState, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
      await phone.route((url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort('blockedbyclient'));
      await phone.addInitScript(() => { localStorage.setItem('survey.flag.open-visible-first', '1'); });
      const p = await phone.newPage();
      await p.addInitScript(frameProbe);
      const cdp = await phone.newCDPSession(p);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await p.goto('/', { waitUntil: 'domcontentloaded' });
      const row = p.getByText(seeded.name, { exact: true }).filter({ visible: true }).first();
      const restored = p.locator(`${PAGE} canvas`).first();
      await expect(row.or(restored).first()).toBeVisible({ timeout: 60_000 });
      if (await row.isVisible().catch(() => false)) {
        await row.tap();
        const open = p.getByRole('button', { name: 'Open file' });
        if (await open.isVisible().catch(() => false)) await open.tap();
      }

      await expect.poll(async () => (await p.evaluate(() => window.__frameRows || [])).some((r) => r.ink && r.page1 === MARKS_PER_PAGE), {
        timeout: 90_000, message: 'page 1 and its marks never showed',
      }).toBe(true);
      const onScreen = await p.evaluate(onScreenPages);
      const lastOnScreen = Math.max(...onScreen);
      expect(lastOnScreen, `the test needs sheets below the screen (on screen: ${onScreen})`).toBeLessThan(PAGES - 1);

      // The pages around it follow once page 1 shows.
      await expect.poll(async () => {
        const rows = await p.evaluate(() => window.__frameRows);
        return rows.at(-1).built.some((n) => n > lastOnScreen);
      }, { timeout: 30_000, message: 'the sheets below the screen never got their marks' }).toBe(true);

      const rows = await p.evaluate(() => window.__frameRows);
      const timeline = rows.map((r) => JSON.stringify(r)).join('\n');
      const first = rows.findIndex((r) => r.ink || r.page1 > 0);
      expect(rows[first].ink, `page 1's drawing shows in the first frame anything does\n${timeline}`).toBe(true);
      expect(rows[first].page1, `with every one of its marks\n${timeline}`).toBe(MARKS_PER_PAGE);
      for (const r of rows.slice(first)) {
        expect(r.ink && r.page1 === MARKS_PER_PAGE, `never one without the other afterwards\n${timeline}`).toBe(true);
      }
      const beforePage1 = rows.slice(0, first + 1).flatMap((r) => r.built);
      expect(
        beforePage1.filter((n) => n > lastOnScreen),
        `no sheet below the screen had its marks built before page 1 showed\n${timeline}`,
      ).toEqual([]);
    } finally {
      await phone.close();
    }
  } finally {
    await seeded.remove();
  }
});
