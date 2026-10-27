// Smooth tab switching (owner 2026-10-27): "The PDF needs to switch smoothly
// ... and the top, left, and right rails need to be solid without flickering
// (just a smooth switch of selected buttons and annotation tools and whether
// the rails were left open or closed)." Rules: docs/TAB-SWITCHING.md.
//
// Two documents in two tabs, each left in its own state: A on page ~3 with the
// Pages panel open, B in Survey with the Survey panel open. Then A, B, A, B,
// recording every frame. For each switch:
//  - no rail, tool bar or tab strip element is built again (they used to be
//    keyed by document and rebuilt on every switch);
//  - no entry animation plays in the chrome (the open panel used to slide in
//    again);
//  - every painted frame shows ONE tab: the document, its rails and the
//    footer's zoom and page count all belong to the same tab (the zoom number
//    used to show the old tab's value for a frame);
//  - each tab comes back exactly as it was left: its place in the document,
//    which panels were open, and the page does not move while it shows.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const stamp = Date.now();
  const docs = [];
  for (const [label, fixture, pages] of [['A', 'debug/fixtures/package2-rev4.pdf', 36], ['B', 'debug/fixtures/clickable-link-test.pdf', 1]]) {
    const docId = randomUUID();
    const bytes = fs.readFileSync(path.resolve(fixture));
    const filePath = `${ownerId}/${docId}.pdf`;
    const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
      contentType: 'application/pdf', upsert: true,
    });
    if (up.error) throw up.error;
    const docName = `E2E Tabs ${label} ${stamp}.pdf`;
    const doc = await admin.from('documents').insert({
      id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName,
      file_path: filePath, file_size: bytes.length, page_count: pages,
    });
    if (doc.error) throw doc.error;
    docs.push({ docId, docName, filePath, pages });
  }
  const templateId = randomUUID();
  const templateName = `E2E Tabs ${stamp}`;
  const template = await admin.from('templates').insert({
    id: templateId, user_id: ownerId, name: templateName, description: 'tab-switch-smooth.spec',
    config: {
      modules: [{ id: 'm-sec', name: 'Security', categories: [{ id: 'c-cam', name: 'Camera', checklist: [] }] }],
      entities: [{ id: 'e-gc', name: 'GC', color: '#E53935' }],
    },
  });
  if (template.error) throw template.error;
  const link = await admin.from('document_templates').insert({ document_id: docs[1].docId, template_id: templateId, linked_by: ownerId });
  if (link.error) throw link.error;
  return { A: docs[0], B: docs[1], templateId, templateName };
}

async function cleanup(admin, seeded) {
  for (const d of [seeded.A, seeded.B]) {
    await admin.from('documents').delete().eq('id', d.docId);
    await admin.storage.from('documents').remove([d.filePath]);
  }
  await admin.from('templates').delete().eq('id', seeded.templateId);
}

// What one frame shows. The document: how many pages the visible viewer
// holds (36 for A, 1 for B) and its scroll. The rails: which tab's slot is
// drawn, and whether its left panel / Survey panel is open. The footer: zoom
// and page count.
function frameProbe() {
  const surface = [...document.querySelectorAll('[data-touch-pdf-surface]')].find((s) => s.checkVisibility({ visibilityProperty: true }));
  const slot = (host) => document.querySelector(`${host} [data-chrome-tab-slot][data-active="true"]`);
  const shown = (el) => Boolean(el && el.getClientRects().length && el.getBoundingClientRect().width > 0);
  const leftSlot = slot('#chrome-left-host');
  const rightSlot = slot('#chrome-right-host');
  const zoom = document.querySelector('[data-rail-zoom-button]')?.textContent?.match(/(\d+)%/g)?.at(-1) ?? null;
  return {
    pages: surface ? surface.querySelectorAll('.survey-pdfjs-page-div').length : 0,
    scroll: surface ? Math.round(surface.scrollTop) : null,
    left: leftSlot?.getAttribute('data-chrome-tab-slot') ?? null,
    right: rightSlot?.getAttribute('data-chrome-tab-slot') ?? null,
    leftPanel: shown(leftSlot?.querySelector('.left-rail__panel')),
    surveyPanel: shown(rightSlot?.querySelector('#survey-rail-panel')),
    zoom,
  };
}

// Click a tab and record every frame for `ms`: the probe above, which chrome
// elements were replaced, and every CSS entry animation the chrome started.
async function switchTo(page, tabName, ms = 900) {
  const recording = page.evaluate(({ duration, probeSrc }) => new Promise((resolve) => {
    const probe = new Function(`return (${probeSrc})()`);
    const chrome = ['#chrome-top-host', '#chrome-left-host', '#chrome-right-host', '.tab-bar'];
    const kept = [];
    for (const host of chrome) {
      for (const el of document.querySelectorAll(`${host} > *, ${host} .left-rail, ${host} .survey-rail-strip, ${host} [data-chrome-rail]`)) kept.push(el);
    }
    const started = new Set();
    const seenAnimations = new WeakSet(document.getAnimations());
    let downAt = null;
    const onDown = () => { downAt = performance.now(); };
    window.addEventListener('pointerdown', onDown, { capture: true, once: true });
    const frames = [];
    const t0 = performance.now();
    const tick = () => {
      for (const a of document.getAnimations()) {
        if (seenAnimations.has(a)) continue;
        seenAnimations.add(a);
        const target = a.effect?.target;
        // CSS animations on the clock only (keyframe entries). Hover / press
        // transitions on the tab you click, and scroll-driven effects (the
        // Survey tabs' edge fade follows its own scroll), are not motion.
        if (!a.animationName || !target?.closest || a.timeline !== document.timeline) continue;
        if (chrome.some((host) => target.closest(host))) started.add(`${a.animationName} on ${target.id || target.className || target.tagName}`);
      }
      frames.push({ t: performance.now(), ...probe() });
      if (performance.now() - t0 < duration) requestAnimationFrame(tick);
      else {
        resolve({
          frames,
          downAt,
          replaced: kept.filter((el) => !el.isConnected).map((el) => el.className || el.tagName),
          animations: [...started],
        });
      }
    };
    requestAnimationFrame(tick);
  }), { duration: ms, probeSrc: frameProbe.toString() });
  await page.locator('.tab-bar').getByText(tabName, { exact: true }).click();
  return recording;
}

test('switching PDF tabs swaps the document and the rails in one frame and keeps each tab as it was left', async ({ page }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  const { A, B } = seeded;
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    const tabs = page.locator('.tab-bar');
    const visiblePage1 = page.locator('[data-touch-pdf-surface]:visible .survey-pdfjs-page-div[data-page-number="1"] canvas').first();
    for (const d of [A, B]) {
      if (d === B) await tabs.getByText('Home', { exact: true }).click();
      await page.getByText(d.docName, { exact: true }).first().click();
      await page.getByRole('button', { name: 'Open file' }).click();
      await expect(visiblePage1).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1200);
    }

    // B: Survey on, Survey panel open, left panel shut.
    await page.getByRole('button', { name: 'Survey', exact: true }).first().click();
    await page.getByText(seeded.templateName, { exact: true }).first().click().catch(() => {});
    await expect(page.locator('#chrome-right-host #survey-rail-panel:visible')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);

    // A: Pages panel open, scrolled down the drawing set.
    await tabs.getByText(A.docName, { exact: true }).click();
    await page.waitForTimeout(800);
    await page.getByRole('toolbar', { name: 'Document panels' }).getByRole('button', { name: 'Pages', exact: true }).click();
    await page.waitForTimeout(600);
    await page.evaluate(() => { [...document.querySelectorAll('[data-touch-pdf-surface]')].find((s) => s.offsetParent).scrollTop = 3000; });
    await page.waitForTimeout(1200);

    const settled = {};
    const remember = async (key) => { settled[key] = await page.evaluate(`(${frameProbe.toString()})()`); };
    await remember('A');
    await switchTo(page, B.docName, 1200);
    await remember('B');
    console.log('[tab-switch] left as', JSON.stringify(settled));
    expect(settled.A).toMatchObject({ pages: 36, leftPanel: true, surveyPanel: false });
    expect(settled.B).toMatchObject({ pages: 1, leftPanel: false, surveyPanel: true });
    expect(settled.A.scroll).toBeGreaterThan(1000);
    expect(settled.A.left).not.toBe(settled.B.left);

    const latencies = [];
    for (const [name, key] of [[A.docName, 'A'], [B.docName, 'B'], [A.docName, 'A'], [B.docName, 'B']]) {
      const want = settled[key];
      const run = await switchTo(page, name);
      const firstNew = run.frames.findIndex((f) => f.pages === want.pages);
      expect(firstNew, `${key} came to the front`).toBeGreaterThanOrEqual(0);
      const shown = run.frames.slice(firstNew);
      if (run.downAt !== null) latencies.push(Math.round(run.frames[firstNew].t - run.downAt));
      console.log(`[tab-switch] to ${key}`, JSON.stringify({
        replaced: run.replaced, animations: run.animations, first: shown[0], last: shown.at(-1),
      }));
      expect(run.replaced, 'no rail, tool bar or tab strip element is rebuilt').toEqual([]);
      expect(run.animations, 'nothing in the chrome plays an entry animation').toEqual([]);
      for (const f of shown) {
        // One tab per frame: its document, its rails, its footer.
        expect(f, `frame at ${Math.round(f.t)} ms shows only ${key}`).toMatchObject({
          pages: want.pages,
          left: want.left,
          right: want.right,
          leftPanel: want.leftPanel,
          surveyPanel: want.surveyPanel,
          zoom: want.zoom,
        });
        expect(Math.abs(f.scroll - want.scroll), 'the page is where it was left and holds still').toBeLessThan(2);
      }
      // The frame before the switch shows the other tab whole, too.
      for (const f of run.frames.slice(0, firstNew)) expect(f.pages).not.toBe(want.pages);
    }
    console.log('[tab-switch] pointerdown to first frame of the new tab (ms)', JSON.stringify(latencies));
  } finally {
    await cleanup(admin, seeded);
  }
});
