// Pan axis rules (owner 2026-10-27, docs/VIEWER-PAN-ZOOM-RULES.md):
//  - A page that fits sideways never moves sideways: a sideways touchpad
//    swipe or Space-drag leaves it exactly where it is, with or without the
//    Survey panel open over the viewer (which adds sideways scroll room).
//  - Zoomed in, an almost-vertical touchpad scroll or drag runs straight
//    down; a clearly diagonal one still moves both ways.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

// 120 identical portrait sheets, so "fits" is the same on every page.
const FIXTURE = 'debug/fixtures/spike-120-pages.pdf';

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const docId = randomUUID();
  const templateId = randomUUID();
  const stamp = Date.now();
  const templateName = `E2E Pan axis ${stamp}`;
  const docName = `E2E Pan axis ${stamp}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const template = await admin.from('templates').insert({
    id: templateId, user_id: ownerId, name: templateName, description: 'viewer-pan-axis.spec',
    config: {
      modules: [{ id: 'm-sec', name: 'Security', categories: [{ id: 'c-cam', name: 'Camera', checklist: [] }] }],
      entities: [{ id: 'e-gc', name: 'GC', color: '#E53935' }],
    },
  });
  if (template.error) throw template.error;
  const doc = await admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName,
    file_path: filePath, file_size: bytes.length, page_count: 120,
  });
  if (doc.error) throw doc.error;
  const link = await admin.from('document_templates').insert({ document_id: docId, template_id: templateId, linked_by: ownerId });
  if (link.error) throw link.error;
  return { docId, docName, filePath, templateId, templateName };
}

async function cleanup(admin, seeded) {
  await admin.from('documents').delete().eq('id', seeded.docId);
  await admin.storage.from('documents').remove([seeded.filePath]);
  await admin.from('templates').delete().eq('id', seeded.templateId);
}

// Where one page (the first on screen when the recording starts) is drawn,
// every frame for `ms`.
function track(page, ms) {
  return page.evaluate((duration) => new Promise((resolve) => {
    const out = [];
    const t0 = performance.now();
    const pg = [...document.querySelectorAll('.survey-pdfjs-page-div')]
      .find((n) => { const r = n.getBoundingClientRect(); return r.bottom > 0 && r.height > 0; });
    const tick = () => {
      const r = pg?.getBoundingClientRect();
      if (r) out.push({ x: r.left, y: r.top });
      if (performance.now() - t0 < duration) requestAnimationFrame(tick);
      else resolve(out);
    };
    requestAnimationFrame(tick);
  }), ms);
}
const span = (frames, key) => Math.max(...frames.map((f) => f[key])) - Math.min(...frames.map((f) => f[key]));
const moved = (frames, key) => frames.at(-1)[key] - frames[0][key];

async function touchpad(page, dx, dy, count) {
  const recording = track(page, 300 + count * 60);
  for (let i = 0; i < count; i += 1) {
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(16);
  }
  return recording;
}

async function spaceDrag(page, from, dx, dy, count) {
  const recording = track(page, 700 + count * 40);
  await page.keyboard.down('Space');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= count; i += 1) {
    await page.mouse.move(from.x + dx * i, from.y + dy * i);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.keyboard.up('Space');
  return recording;
}

test('a page that fits never moves sideways, and near-straight scrolls run straight', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(seeded.docName, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    const box = await page.locator('[data-touch-pdf-surface]').boundingBox();
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(centre.x, centre.y);

    // Fit page: sideways input does nothing sideways.
    let frames = await touchpad(page, 12, 0, 15);
    console.log('[pan-axis] fit touchpad', span(frames, 'x'));
    expect(span(frames, 'x'), 'a sideways touchpad swipe leaves a fitting page alone').toBeLessThan(1);
    frames = await spaceDrag(page, centre, -10, 0, 15);
    expect(span(frames, 'x'), 'a sideways drag leaves a fitting page alone').toBeLessThan(1);
    frames = await touchpad(page, 2, 12, 15);
    expect(span(frames, 'x')).toBeLessThan(1);
    expect(moved(frames, 'y'), 'up and down still scrolls').toBeLessThan(-100);

    // The Survey panel lies over the right of the viewer and adds scroll room:
    // the page still does not move sideways.
    await page.getByRole('button', { name: 'Survey', exact: true }).first().click();
    await page.getByText(seeded.templateName, { exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    const room = await page.evaluate(() => {
      const el = document.querySelector('[data-touch-pdf-surface]');
      return el.scrollWidth - el.clientWidth;
    });
    console.log('[pan-axis] side room', room);
    await page.mouse.move(centre.x - 200, centre.y);
    frames = await touchpad(page, -12, 0, 20);
    expect(span(frames, 'x'), 'with the panel open: swipe one way').toBeLessThan(1);
    frames = await touchpad(page, 12, 0, 20);
    expect(span(frames, 'x'), 'with the panel open: swipe the other way').toBeLessThan(1);
    await page.getByRole('button', { name: 'Survey', exact: true }).first().click();
    await page.waitForTimeout(800);

    // Zoomed in past the page width: rails.
    await page.mouse.move(centre.x, centre.y);
    await page.keyboard.down('Control');
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(120);
    }
    await page.keyboard.up('Control');
    await page.waitForTimeout(1500);
    const wide = await page.evaluate(() => {
      const el = document.querySelector('[data-touch-pdf-surface]');
      return el.scrollWidth - el.clientWidth;
    });
    expect(wide, 'zoomed in past the page width').toBeGreaterThan(300);
    frames = await touchpad(page, 3, 12, 20);
    console.log('[pan-axis] zoomed near-vertical', span(frames, 'x'), moved(frames, 'y'));
    expect(span(frames, 'x'), 'an almost-vertical touchpad scroll runs straight').toBeLessThan(1);
    expect(moved(frames, 'y')).toBeLessThan(-150);
    frames = await touchpad(page, 10, 12, 20);
    expect(Math.abs(moved(frames, 'x')), 'a diagonal touchpad scroll still moves sideways').toBeGreaterThan(100);
    frames = await spaceDrag(page, centre, 1.5, -8, 15);
    expect(span(frames, 'x'), 'an almost-vertical drag runs straight').toBeLessThan(1);
    expect(moved(frames, 'y')).toBeLessThan(-80);
    frames = await spaceDrag(page, centre, 8, 8, 15);
    expect(moved(frames, 'x'), 'a diagonal drag moves both ways').toBeGreaterThan(80);
  } finally {
    await cleanup(admin, seeded);
  }
});
