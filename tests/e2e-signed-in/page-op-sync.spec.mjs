// Page changes in two windows (Nightly 'page-op-sync', src/utils/pageOpSync.js).
// A page change in window A rewrites the PDF bytes. Before this, window B got
// A's turned marks live but kept its old page under them; a turn in B then
// turned the already-turned bytes and marks again, and after a reload the page
// and its marks no longer matched. Now B refuses page changes while A's bytes
// upload, reloads the PDF once they are saved, and both windows agree.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const BLOCKED = 'Pages are being changed in another window.';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

async function seedLandscapePdf(label) {
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.addPage([792, 612]);
  p.drawText(`${label} sheet`, { x: 72, y: 540, size: 20, font });
  const bytes = Buffer.from(await pdf.save());
  const id = crypto.randomUUID();
  const path = `${user.id}/${id}.pdf`;
  const name = `${label} ${RUN} ${id.slice(0, 6)}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return {
    id, name,
    remove: async () => {
      const { data: row } = await admin.from('documents').select('file_path').eq('id', id).maybeSingle();
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([...new Set([path, row?.file_path].filter(Boolean))]);
    },
  };
}

const pageDivOf = (page) => page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();

async function openDoc(page, name) {
  await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
  const open = page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
  await open.click({ timeout: 5000 }).catch(() => {});
  await expect(pageDivOf(page).locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
}

const markIds = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-overlay-page="1"] [data-annotation-id]')]
  .map((el) => el.getAttribute('data-annotation-id')))]);

/** A mark's union box relative to its page (fractions), and the page size. */
const markRel = (page, id) => page.evaluate((markId) => {
  const pd = [...document.querySelectorAll('.survey-pdfjs-page-div[data-page-number="1"]')].find((e) => e.offsetParent);
  const rects = [...document.querySelectorAll(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`)]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
  if (!pd || !rects.length) return null;
  const P = pd.getBoundingClientRect();
  const l = Math.min(...rects.map((r) => r.left)); const t = Math.min(...rects.map((r) => r.top));
  const r = Math.max(...rects.map((r) => r.right)); const b = Math.max(...rects.map((r) => r.bottom));
  return { cx: ((l + r) / 2 - P.left) / P.width, cy: ((t + b) / 2 - P.top) / P.height, w: (r - l) / P.width, h: (b - t) / P.height, pw: P.width, ph: P.height };
}, id);

const isPortrait = async (page) => {
  const box = await pageDivOf(page).boundingBox();
  return box ? box.height > box.width : null;
};

async function rotateRight(page) {
  await page.mouse.click(5, 450);
  await page.keyboard.press('v');
  const pd = pageDivOf(page);
  const box = await pd.boundingBox();
  await pd.click({ button: 'right', position: { x: box.width * 0.97, y: box.height * 0.985 } });
  await page.getByRole('menuitem', { name: 'Rotate right' }).filter({ visible: true }).first().click();
}

function expectSameMark(a, b, why) {
  expect(a, `${why}: A`).not.toBeNull();
  expect(b, `${why}: B`).not.toBeNull();
  for (const key of ['cx', 'cy', 'w', 'h']) {
    expect(Math.abs(a[key] - b[key]), `${why} ${key} A=${JSON.stringify(a)} B=${JSON.stringify(b)}`).toBeLessThan(0.03);
  }
}

async function newWindow(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('survey.flag.page-op-sync', '1'); } catch { /* none */ } });
  await ctx.route((url) => !['data:', 'blob:'].includes(url.protocol) && !LOCAL_HOSTS.has(url.hostname), (route) => route.abort('blockedbyclient'));
  return ctx;
}

test.use({ actionTimeout: 10_000 });

test('a page turn in one window reloads the page in the other, which waits for it', async ({ browser }) => {
  test.setTimeout(300_000);
  const sheet = await seedLandscapePdf('Page op sync');
  const ctxA = await newWindow(browser);
  const ctxB = await newWindow(browser);
  // A's PDF uploads are held a few seconds: the window in which B must wait.
  let holdUploadsMs = 0;
  await ctxA.route('**/storage/v1/object/**', async (route) => {
    const method = route.request().method();
    if (holdUploadsMs > 0 && (method === 'POST' || method === 'PUT')) await new Promise((r) => setTimeout(r, holdUploadsMs));
    await route.fallback();
  });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  try {
    await signIn(a, E2E_ACCOUNTS.owner);
    await openDoc(a, sheet.name);
    const box = await pageDivOf(a).boundingBox();
    // A box in the page's top-left corner.
    await a.keyboard.press('r');
    await a.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.1);
    await a.mouse.down();
    await a.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.2, { steps: 4 });
    await a.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3, { steps: 4 });
    await a.mouse.up();
    await a.keyboard.press('Escape');
    await expect.poll(async () => (await markIds(a)).length).toBe(1);
    const id = (await markIds(a))[0];
    await a.waitForTimeout(3000);

    await signIn(b, E2E_ACCOUNTS.owner);
    await openDoc(b, sheet.name);
    await expect.poll(() => markRel(b, id), { timeout: 20_000 }).not.toBeNull();
    expect(await isPortrait(a)).toBe(false);
    expect(await isPortrait(b)).toBe(false);

    // 1. A turns the page right while its upload is held.
    holdUploadsMs = 8000;
    await rotateRight(a);
    await expect.poll(() => isPortrait(a)).toBe(true);
    await b.waitForTimeout(2000);

    // 2. B's turn during A's save is refused and changes nothing.
    const bBefore = await pageDivOf(b).boundingBox();
    const markBefore = await markRel(b, id);
    await rotateRight(b);
    await expect(b.getByText(BLOCKED).first()).toBeVisible({ timeout: 5000 });
    const bAfter = await pageDivOf(b).boundingBox();
    expect(Math.round(bAfter.width)).toBe(Math.round(bBefore.width));
    expect(Math.round(bAfter.height)).toBe(Math.round(bBefore.height));
    expectSameMark(await markRel(b, id), markBefore, 'B refused turn leaves the mark');
    holdUploadsMs = 0;

    // 3. Once A's bytes are saved, B's page turns too (within ~15 s of the
    // upload) and its mark sits where A's does: top-right.
    await expect.poll(() => isPortrait(b), { timeout: 25_000 }).toBe(true);
    await expect.poll(async () => {
      const ra = await markRel(a, id); const rb = await markRel(b, id);
      return Boolean(ra && rb && Math.abs(ra.cx - rb.cx) < 0.03 && Math.abs(ra.cy - rb.cy) < 0.03);
    }, { timeout: 15_000 }).toBe(true);
    const ra1 = await markRel(a, id);
    expectSameMark(ra1, await markRel(b, id), 'after A turn');
    expect(ra1.cx).toBeGreaterThan(0.6);
    expect(ra1.cy).toBeLessThan(0.4);

    // 4. B turns again (now allowed); A follows.
    await b.waitForTimeout(1500);
    await rotateRight(b);
    await expect.poll(() => isPortrait(b)).toBe(false);
    await expect.poll(() => isPortrait(a), { timeout: 25_000 }).toBe(false);
    await expect.poll(async () => {
      const x = await markRel(a, id); const y = await markRel(b, id);
      return Boolean(x && y && Math.abs(x.cx - y.cx) < 0.03 && Math.abs(x.cy - y.cy) < 0.03);
    }, { timeout: 15_000 }).toBe(true);
    // Two turns right: the top-left box is now bottom-right.
    const rb2 = await markRel(b, id);
    expect(rb2.cx).toBeGreaterThan(0.6);
    expect(rb2.cy).toBeGreaterThan(0.6);
    await a.waitForTimeout(3000);

    // 5. After a reload both windows show the page and the mark as saved.
    for (const p of [a, b]) {
      await p.reload();
      await openDoc(p, sheet.name).catch(() => {});
      await expect(pageDivOf(p).locator('canvas').first()).toBeVisible({ timeout: 60_000 });
      await expect.poll(() => markRel(p, id), { timeout: 20_000 }).not.toBeNull();
    }
    expect(await isPortrait(a)).toBe(false);
    expect(await isPortrait(b)).toBe(false);
    const ra3 = await markRel(a, id);
    expectSameMark(ra3, await markRel(b, id), 'after reload');
    expectSameMark(ra3, rb2, 'reload keeps the turned mark');
  } finally {
    await ctxA.close();
    await ctxB.close();
    await sheet.remove();
  }
});

// R4-C N6b: a mark B draws on its old page (after A's turn, before B's
// reload) turns with the page too, so it lands where A's twin mark does.
test('a mark drawn in the other window before its reload turns with the page', async ({ browser }) => {
  test.setTimeout(300_000);
  const sheet = await seedLandscapePdf('Page op reframe');
  const ctxA = await newWindow(browser);
  const ctxB = await newWindow(browser);
  let holdUploadsMs = 0;
  await ctxA.route('**/storage/v1/object/**', async (route) => {
    const method = route.request().method();
    if (holdUploadsMs > 0 && (method === 'POST' || method === 'PUT')) await new Promise((r) => setTimeout(r, holdUploadsMs));
    await route.fallback();
  });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const drawBox = async (p) => {
    const box = await pageDivOf(p).boundingBox();
    await p.keyboard.press('r');
    await p.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.1);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3, { steps: 8 });
    await p.mouse.up();
    await p.keyboard.press('Escape');
  };
  try {
    await signIn(a, E2E_ACCOUNTS.owner);
    await openDoc(a, sheet.name);
    await drawBox(a);
    await expect.poll(async () => (await markIds(a)).length).toBe(1);
    const twin = (await markIds(a))[0];
    await a.waitForTimeout(3000);
    await signIn(b, E2E_ACCOUNTS.owner);
    await openDoc(b, sheet.name);
    await expect.poll(() => markRel(b, twin), { timeout: 20_000 }).not.toBeNull();

    holdUploadsMs = 8000;
    await rotateRight(a);
    await expect.poll(() => isPortrait(a)).toBe(true);
    await b.waitForTimeout(1500);
    // B still shows the old landscape page: the same top-left box there.
    expect(await isPortrait(b)).toBe(false);
    await b.mouse.click(5, 450);
    await drawBox(b);
    await expect.poll(async () => (await markIds(b)).length).toBe(2);
    const mine = (await markIds(b)).find((x) => x !== twin);
    holdUploadsMs = 0;

    await expect.poll(() => isPortrait(b), { timeout: 25_000 }).toBe(true);
    // B's box turned with the page: it sits on A's twin box, in both windows.
    for (const p of [b, a]) {
      await expect.poll(async () => {
        const t = await markRel(p, twin); const m = await markRel(p, mine);
        return Boolean(t && m && Math.abs(t.cx - m.cx) < 0.03 && Math.abs(t.cy - m.cy) < 0.03);
      }, { timeout: 15_000 }).toBe(true);
    }
    expectSameMark(await markRel(a, mine), await markRel(b, mine), 'A and B agree on the turned box');
  } finally {
    await ctxA.close();
    await ctxB.close();
    await sheet.remove();
  }
});

test('two page turns saved apart while the other window holds a drag both apply to its mark', async ({ browser }) => {
  test.setTimeout(300_000);
  const sheet = await seedLandscapePdf('Page op two runs');
  const ctxA = await newWindow(browser);
  const ctxB = await newWindow(browser);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  try {
    await signIn(a, E2E_ACCOUNTS.owner);
    await openDoc(a, sheet.name);
    const boxA = await pageDivOf(a).boundingBox();
    await a.keyboard.press('r');
    await a.mouse.move(boxA.x + boxA.width * 0.05, boxA.y + boxA.height * 0.1);
    await a.mouse.down();
    await a.mouse.move(boxA.x + boxA.width * 0.25, boxA.y + boxA.height * 0.3, { steps: 8 });
    await a.mouse.up();
    await a.keyboard.press('Escape');
    await expect.poll(async () => (await markIds(a)).length).toBe(1);
    const twin = (await markIds(a))[0];
    await a.waitForTimeout(3000);
    await signIn(b, E2E_ACCOUNTS.owner);
    await openDoc(b, sheet.name);
    await expect.poll(() => markRel(b, twin), { timeout: 20_000 }).not.toBeNull();

    // B starts a box and keeps the button down, so it cannot reload yet.
    const boxB = await pageDivOf(b).boundingBox();
    await b.mouse.click(5, 450);
    await b.keyboard.press('r');
    await b.mouse.move(boxB.x + boxB.width * 0.05, boxB.y + boxB.height * 0.1);
    await b.mouse.down();
    await b.mouse.move(boxB.x + boxB.width * 0.25, boxB.y + boxB.height * 0.3, { steps: 8 });

    // A turns the page twice, each turn saved on its own.
    await rotateRight(a);
    await expect.poll(() => isPortrait(a)).toBe(true);
    await a.waitForTimeout(4000);
    await rotateRight(a);
    await expect.poll(() => isPortrait(a)).toBe(false);
    await a.waitForTimeout(4000);
    expect(await isPortrait(b)).toBe(false);

    await b.mouse.up();
    await b.keyboard.press('Escape');
    await expect.poll(async () => (await markIds(b)).length).toBe(2);
    const mine = (await markIds(b)).find((x) => x !== twin);

    // After B reloads, its box has turned twice (upside down) and sits on the twin.
    for (const p of [b, a]) {
      await expect.poll(async () => {
        const t = await markRel(p, twin); const m = await markRel(p, mine);
        return Boolean(t && m && t.cx > 0.6 && t.cy > 0.6 && Math.abs(t.cx - m.cx) < 0.03 && Math.abs(t.cy - m.cy) < 0.03);
      }, { timeout: 45_000 }).toBe(true);
    }
    expectSameMark(await markRel(a, mine), await markRel(b, mine), 'A and B agree after two turns');
  } finally {
    await ctxA.close();
    await ctxB.close();
    await sheet.remove();
  }
});

test('a highlight made in the other window before its reload turns with the page', async ({ browser }) => {
  test.setTimeout(300_000);
  const sheet = await seedLandscapePdf('Page op highlight');
  const arm = async (ctx) => ctx.addInitScript(() => {
    try { localStorage.setItem('survey.flag.annotation-agent', '1'); } catch { /* none */ }
    const tools = [];
    window.__webmcpTools = tools;
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool: (tool) => { tools.push(tool); return { unregister() {} }; } },
    });
  });
  const highlight = (p) => p.evaluate(async () => {
    const tool = (window.__webmcpTools || []).find((t) => t.name === 'survey_add_highlight');
    return tool.execute({ page: 1, search_text: 'Page op highlight sheet' });
  });
  const ctxA = await newWindow(browser);
  const ctxB = await newWindow(browser);
  await arm(ctxA);
  await arm(ctxB);
  let holdUploadsMs = 0;
  await ctxA.route('**/storage/v1/object/**', async (route) => {
    const method = route.request().method();
    if (holdUploadsMs > 0 && (method === 'POST' || method === 'PUT')) await new Promise((r) => setTimeout(r, holdUploadsMs));
    await route.fallback();
  });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  try {
    await signIn(a, E2E_ACCOUNTS.owner);
    await openDoc(a, sheet.name);
    expect(await highlight(a)).toMatch(/Highlighted/);
    await expect.poll(async () => (await markIds(a)).length).toBe(1);
    const twin = (await markIds(a))[0];
    await a.waitForTimeout(3000);
    await signIn(b, E2E_ACCOUNTS.owner);
    await openDoc(b, sheet.name);
    await expect.poll(() => markRel(b, twin), { timeout: 20_000 }).not.toBeNull();

    holdUploadsMs = 8000;
    await rotateRight(a);
    await expect.poll(() => isPortrait(a)).toBe(true);
    await b.waitForTimeout(1500);
    expect(await isPortrait(b)).toBe(false);
    expect(await highlight(b)).toMatch(/Highlighted/);
    await expect.poll(async () => (await markIds(b)).length).toBe(2);
    const mine = (await markIds(b)).find((x) => x !== twin);
    holdUploadsMs = 0;

    await expect.poll(() => isPortrait(b), { timeout: 25_000 }).toBe(true);
    for (const p of [b, a]) {
      await expect.poll(async () => {
        const t = await markRel(p, twin); const m = await markRel(p, mine);
        return Boolean(t && m && Math.abs(t.cx - m.cx) < 0.03 && Math.abs(t.cy - m.cy) < 0.03);
      }, { timeout: 15_000 }).toBe(true);
    }
    expectSameMark(await markRel(a, mine), await markRel(b, mine), 'A and B agree on the turned highlight');
  } finally {
    await ctxA.close();
    await ctxB.close();
    await sheet.remove();
  }
});
