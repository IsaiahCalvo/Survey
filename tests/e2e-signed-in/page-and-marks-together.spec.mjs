// Owner 2026-11-03: "if a PDF loads up and the page is visible, then the
// annotations need to also be visible ... one and one", and "some
// annotations [load] at different speeds from others. They all need to load
// at the same time."
//
// Frame by frame (one row per animation frame in which something changed),
// on a slowed CPU, this walk checks that page 1's PDF drawing and every one
// of its marks first show in the SAME frame: on a reopen, on a phone opening
// the document cold while the cloud reads are slow, and on a busy sheet
// (600 marks, which used to mount in waves of 300 a frame, filled shapes
// first). The toolbar and rails are up by then and nothing is read-only.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';

async function makePdf(pages) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p += 1) {
    const page = pdf.addPage([1224, 792]);
    page.drawText(`Sheet ${p + 1}`, { x: 60, y: 740, size: 28, font, color: rgb(0, 0, 0) });
    for (let i = 0; i < 60; i += 1) {
      page.drawLine({
        start: { x: 40 + ((i * 19) % 1100), y: 60 + ((i * 37) % 600) },
        end: { x: 200 + ((i * 23) % 1000), y: 80 + ((i * 29) % 640) },
        thickness: 1,
        color: rgb(0.2, 0.2, 0.2),
      });
    }
  }
  return Buffer.from(await pdf.save());
}

async function seedDocument(label, pages = 3) {
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const bytes = await makePdf(pages);
  const id = randomUUID();
  const filePath = `${ownerId}/${id}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const now = new Date().toISOString();
  const name = `E2E ${label} ${Date.now()}.pdf`;
  const doc = await admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: filePath, file_size: bytes.length, page_count: pages,
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

// Writes `count` marks of four kinds onto page 1 through the app's own store
// mapping, appended as the owner (as scripts/perf/big-doc-seed.mjs does). The
// update is built in plain Node: the app's store modules are ES modules.
const BUSY_UPDATE = `
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { syncByPageToDoc } from './src/services/annotationDocStore.js';
const count = Number(process.argv[1]);
const objects = [];
for (let i = 0; i < count; i += 1) {
  const id = randomUUID();
  const left = 40 + ((i * 53) % 1050);
  const top = 40 + ((i * 97) % 650);
  const kind = i % 4;
  if (kind === 0) objects.push({ type: 'path', path: [['M', left, top], ['L', left + 60, top + 10], ['L', left + 120, top - 5]], left, top: top - 5, width: 120, height: 15, stroke: '#d22', fill: null, strokeWidth: 3, data: { id, type: 'ink' } });
  else if (kind === 1) objects.push({ type: 'rect', left, top, width: 50, height: 30, stroke: '#1565c0', fill: 'transparent', strokeWidth: 2, data: { id } });
  else if (kind === 2) objects.push({ type: 'ellipse', left, top, rx: 20, ry: 12, stroke: '#2e7d32', fill: '#a5d6a7', strokeWidth: 2, data: { id } });
  else objects.push({ type: 'textbox', text: 'N' + i, left, top, width: 60, fontSize: 12, fontFamily: 'Helvetica', fill: '#222', data: { id } });
}
const doc = new Y.Doc();
const pending = [];
doc.on('update', (u) => { pending.push(u); });
syncByPageToDoc(doc, { 1: { objects } });
process.stdout.write(Buffer.from(Y.mergeUpdates(pending)).toString('hex'));
`;

async function seedBusyPage(documentId, count) {
  const hex = execFileSync(process.execPath, ['--input-type=module', '-e', BUSY_UPDATE, String(count)], {
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const { error } = await owner.rpc('append_annotation_update', {
    p_document_id: documentId, p_client_id: `busy-seed-${Date.now()}`, p_client_seq: 1, p_data: `\\x${hex}`,
  });
  if (error) throw error;
}

// Runs in the page on every navigation.
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
    const canvas = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"] canvas.survey-pdfjs-page-canvas');
    const ink = hasInk(canvas);
    const host = document.querySelector('[data-pdfjs-page-overlay-host][data-overlay-page="1"]');
    const marks = host && shown(host) ? new Set([...host.querySelectorAll('[data-annotation-id]')].map((n) => n.getAttribute('data-annotation-id'))).size : 0;
    const top = document.getElementById('chrome-top-host');
    const toolbar = !!top && [...top.querySelectorAll('button')].filter((b) => b.offsetParent && !b.disabled).length >= 3;
    const readOnly = document.body.getAttribute('data-readonly');
    const key = `${ink}|${marks}|${toolbar}|${readOnly}`;
    if (key !== last) {
      rows.push({ t: Math.round(performance.now() - t0), ink, marks, toolbar, readOnly });
      last = key;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const markIds = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-overlay-page="1"] [data-annotation-id]')].map((n) => n.getAttribute('data-annotation-id')))]);

// Every row: the drawing never shows without all the marks, the marks never
// show without the drawing, and all of them arrive in one frame.
async function expectTogether(page, expectedMarks, label) {
  await expect.poll(async () => (await page.evaluate(() => window.__frameRows || [])).some((r) => r.ink && r.marks >= expectedMarks), {
    timeout: 60_000, message: `${label}: page and marks never showed`,
  }).toBe(true);
  const rows = await page.evaluate(() => window.__frameRows);
  const timeline = rows.map((r) => JSON.stringify(r)).join('\n');
  const first = rows.findIndex((r) => r.ink || r.marks > 0);
  expect(rows[first].ink, `${label}: the drawing shows in the first frame anything does\n${timeline}`).toBe(true);
  expect(rows[first].marks, `${label}: every mark shows in that same frame\n${timeline}`).toBe(expectedMarks);
  for (const row of rows.slice(first)) {
    expect(row.ink && row.marks === expectedMarks, `${label}: never one without the other afterwards\n${timeline}`).toBe(true);
  }
  expect(rows[first].toolbar, `${label}: the toolbar is up by then\n${timeline}`).toBe(true);
  expect(rows[first].readOnly, `${label}: nothing is locked\n${timeline}`).toBeNull();
}

async function openDocument(page, name) {
  await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
}

async function drag(page, key, from, to) {
  const box = await page.locator(PAGE).boundingBox();
  await page.keyboard.press(key);
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

async function savedRows(documentId) {
  const { count } = await adminClient().from('annotation_updates').select('*', { count: 'exact', head: true }).eq('document_id', documentId);
  return count || 0;
}

test('page and every kind of mark show in the same frame: desktop reopen and a phone opening cold', async ({ page, context, browser, baseURL }) => {
  test.setTimeout(240_000);
  const seeded = await seedDocument('page and marks');
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDocument(page, seeded.name);
    await page.waitForTimeout(1_500);
    await drag(page, 'r', [0.1, 0.2], [0.25, 0.35]);
    await drag(page, 'o', [0.3, 0.2], [0.45, 0.35]);
    await drag(page, 'l', [0.5, 0.2], [0.65, 0.3]);
    await drag(page, 'a', [0.7, 0.2], [0.85, 0.3]);
    await drag(page, 'p', [0.1, 0.5], [0.3, 0.55]);
    await drag(page, 'h', [0.35, 0.5], [0.55, 0.52]);
    const box = await page.locator(PAGE).boundingBox();
    await page.keyboard.press('c');
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.7);
    await page.keyboard.press('Escape');
    await page.keyboard.press('t');
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
    await page.waitForTimeout(300);
    await page.keyboard.type('Note');
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
    await page.keyboard.press('Escape');
    await page.keyboard.press('m');
    await expect.poll(() => markIds(page).then((ids) => ids.length)).toBe(8);
    await expect.poll(() => savedRows(seeded.id), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(3_000);
    const storageState = await context.storageState();

    // Desktop reopen on a slowed CPU.
    await page.addInitScript(frameProbe);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectTogether(page, 8, 'desktop reopen');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    // A phone with no saved copy of the marks, slow CPU, slow cloud reads:
    // the page waits as a blank sheet until its marks are there.
    const phone = await browser.newContext({ baseURL, storageState, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
      await phone.route((url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort('blockedbyclient'));
      await phone.route(/\/rest\/v1\/annotation_(updates|snapshots)/, async (route) => {
        if (route.request().method() === 'GET') await new Promise((resolve) => setTimeout(resolve, 2_000));
        return route.fallback();
      });
      const p = await phone.newPage();
      await p.addInitScript(frameProbe);
      const phoneCdp = await phone.newCDPSession(p);
      await phoneCdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
      await p.goto('/', { waitUntil: 'domcontentloaded' });
      // The phone may bring the open tab back by itself; otherwise open it.
      const row = p.getByText(seeded.name, { exact: true }).filter({ visible: true }).first();
      const restored = p.locator(`${PAGE} canvas`).first();
      await expect(row.or(restored).first()).toBeVisible({ timeout: 60_000 });
      if (await row.isVisible().catch(() => false)) {
        await row.tap();
        const open = p.getByRole('button', { name: 'Open file' });
        if (await open.isVisible().catch(() => false)) await open.tap();
      }
      await expectTogether(p, 8, 'phone cold open');
    } finally {
      await phone.close();
    }
  } finally {
    await seeded.remove();
  }
});

test('a busy sheet shows all of its marks in one frame, together with the drawing', async ({ page, context }) => {
  test.setTimeout(180_000);
  const MARKS = 600;
  const seeded = await seedDocument('busy sheet', 2);
  try {
    await seedBusyPage(seeded.id, MARKS);
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDocument(page, seeded.name);
    await expect.poll(() => markIds(page).then((ids) => ids.length), { timeout: 60_000 }).toBe(MARKS);
    await page.waitForTimeout(2_000);
    await page.addInitScript(frameProbe);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectTogether(page, MARKS, 'busy sheet reopen');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  } finally {
    await seeded.remove();
  }
});
