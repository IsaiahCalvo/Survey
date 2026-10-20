// KAL-410 — review package (ZIP) from the real app, against the in-memory
// fake backend so the document has an id and real History rows. No network,
// no database.
// Run (.env needs VITE_SUPABASE_URL/KEY so the client exists):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5593 \
//     npx playwright test --config debug/playwright.noserver.config.mjs debug/scenarios/test-plan/kal410-review-bundle.spec.mjs
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { PHONE, OUT_DIR } from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import { dragPage, openWindow, tool, pickMark, waitFor, windowMarks } from './tp-actions.mjs';
import { readZip } from '../../../tests/helpers/readStoredZip.mjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 360_000 });

const PDF = 'order-pages.pdf';
const OUT = `${OUT_DIR}/kal410`;
mkdirSync(OUT, { recursive: true });

// 520 older rows by another person, so the export has to page past 500.
function seedRows(docId, n) {
  const start = Date.now() - 3 * 24 * 3600_000;
  return Array.from({ length: n }, (_, i) => {
    const at = new Date(start - i * 60_000).toISOString();
    return {
      id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, '0')}`,
      document_id: docId, user_id: 'sam-lee-test', client_event_id: `seed:${i}`,
      event_type: 'local_annotation_history_added', source: 'test-seed', page_number: 1 + (i % 3),
      annotation_id: `seed-mark-${i}`, summary: `Sam Lee moved a rectangle on page ${1 + (i % 3)}`,
      payload: { actionType: 'move', annotationType: 'rect', annotationId: `seed-mark-${i}` },
      is_undoable: true, is_checkpoint: false, occurred_at: at, created_at: at,
    };
  });
}

async function exportFrom(page, { phone, label }) {
  if (phone) {
    await page.getByRole('button', { name: /More document options|More/ }).first().click();
  } else {
    await page.getByRole('button', { name: 'More export options' }).click();
  }
  await page.waitForTimeout(400);
  const item = phone ? page.getByRole('button', { name: label }) : page.getByRole('menuitem', { name: label });
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), item.click()]);
  const path = `${OUT}/${phone ? 'phone' : 'desktop'}-${download.suggestedFilename()}`;
  await download.saveAs(path);
  return { path, name: download.suggestedFilename() };
}

// Desktop draws with the Rectangle shortcut, arming Select first: pressing R
// while Rectangle is already armed would turn it off again.
async function drawRect(page, n, x0, y0, x1, y1, { phone }) {
  await page.keyboard.press('Escape');
  if (phone) {
    // The phone has no keyboard: Shapes on the tool rail, then Rectangle.
    await tool(page, 'Shapes', 'Rectangle');
  } else {
    await page.keyboard.press('v');
    await page.waitForTimeout(150);
    await page.keyboard.press('r');
  }
  await page.waitForTimeout(300);
  await dragPage(page, n, [[x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2], [x1, y1]]);
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
}

const text = (files, name) => Buffer.from(files.find((f) => f.name === name).data).toString('utf8');

for (const phone of [false, true]) {
  test(`review package holds marks, History and page pictures (${phone ? 'phone' : 'desktop'})`, async ({ browser }) => {
    const docId = `kal410-${phone ? 'phone' : 'desktop'}-${Date.now()}`;
    const backend = new FakeBackend({ documentId: docId });
    backend.table('document_history_events').push(...seedRows(docId, 520));
    const { page, context, errors } = await openWindow(browser, backend, docId, PDF, phone ? { device: PHONE, phone: true } : {});

    if (phone) {
      await drawRect(page, 1, 60, 80, 220, 160, { phone });
    } else {
      // Zoom out so pages 1 and 2 are both on screen.
      for (let z = 0; z < 4; z += 1) { await page.getByRole('button', { name: 'Zoom out' }).first().click(); await page.waitForTimeout(400); }
      await page.waitForTimeout(1500);
      await drawRect(page, 1, 60, 80, 220, 160, { phone });
      await drawRect(page, 1, 300, 400, 420, 480, { phone });
      await drawRect(page, 2, 100, 100, 260, 200, { phone });
      await waitFor(async () => (await windowMarks(page, 1)).length === 2);
      const marks = await windowMarks(page, 1);
      expect(marks.length).toBe(2);
      await pickMark(page, marks[1].id);
      await page.keyboard.press('Delete');
      await waitFor(async () => (await windowMarks(page, 1)).length === 1);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${phone ? 'phone' : 'desktop'}-drawn.png` });

    const bundle = await exportFrom(page, { phone, label: phone ? 'Export review package' : 'Review package (ZIP)' });
    await page.screenshot({ path: `${OUT}/${phone ? 'phone' : 'desktop'}-after-export.png` });
    expect(bundle.name).toBe('order-pages review.zip');
    const files = readZip(new Uint8Array(readFileSync(bundle.path)), crc32);
    const names = files.map((f) => f.name);
    expect(names.slice(0, 3)).toEqual(['manifest.json', 'annotations.xfdf', 'audit-log.json']);
    expect(names).toContain('thumbnails/page-001.png');
    if (!phone) expect(names).toContain('thumbnails/page-002.png');
    expect(names).toContain('thumbnails/contact-sheet.png');

    const manifest = JSON.parse(text(files, 'manifest.json'));
    for (const entry of manifest.files) {
      const data = files.find((f) => f.name === entry.name).data;
      expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);
    }
    const source = readFileSync(new URL(`../../fixtures/${PDF}`, import.meta.url));
    expect(manifest.source.sha256).toBe(createHash('sha256').update(source).digest('hex'));
    expect(manifest.marks.total).toBe(phone ? 1 : 2);

    const log = JSON.parse(text(files, 'audit-log.json'));
    expect(log.coverage.historyAvailable).toBe(true);
    expect(log.events.filter((e) => e.actor.name === 'Sam Lee').length).toBe(520);
    const mine = log.events.filter((e) => e.actor.id === 'dev-test-user');
    expect(mine.filter((e) => e.action === 'created').length).toBeGreaterThanOrEqual(phone ? 1 : 3);
    if (!phone) expect(mine.some((e) => e.change === 'deleted')).toBe(true);
    const times = log.events.map((e) => e.at);
    expect([...times].sort()).toEqual(times);

    if (!phone) {
      const xfdf = await exportFrom(page, { phone, label: 'Markup only (XFDF)' });
      expect(readFileSync(xfdf.path, 'utf8')).toBe(text(files, 'annotations.xfdf'));
    }
    const toast = await page.locator('.app-toast-host [role=status]').allTextContents();
    console.log(JSON.stringify({ phone, names, marks: manifest.marks, events: log.events.length, mine: mine.map((e) => `${e.action}:${e.markType}:p${e.page}`), toast }));
    expect(errors.filter((e) => !/favicon|DevTools/i.test(e))).toEqual([]);
    await context.close();
  });
}
