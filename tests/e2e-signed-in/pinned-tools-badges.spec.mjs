// Pinned tools (beta flag 'pinned-tools', Drawboard's favourites toolbar):
// every pin shows its size in its top-right corner. Pins saved before a tool
// kept its width (the eraser before 2026-10-29; Polyline, Polygon and Text
// before 2026-10-27) held no width and showed no number for good. Checked on
// the desktop, phone web and phone app layouts.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function seedDoc(admin, owner, label) {
  const ownerId = (await owner.auth.getUser()).data.user.id;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(`${label} drawing`, { x: 72, y: 700, size: 24, font });
  const bytes = Buffer.from(await pdf.save());
  const id = crypto.randomUUID();
  const path = `${ownerId}/${id}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  const name = `${label} ${RUN}.pdf`;
  await must('row', admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return { id, name, path };
}

async function openDoc(page, doc) {
  const row = page.locator(`.documents-ledger-row[data-document-id="${doc.id}"]`).filter({ visible: true }).first();
  if (await row.count()) {
    await row.dblclick();
  } else {
    await page.getByText(doc.name, { exact: true }).filter({ visible: true }).first().click();
    const open = page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
    if (await open.isVisible().catch(() => false)) await open.click();
  }
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] .survey-pdfjs-page-canvas').first()).toBeVisible({ timeout: 60_000 });
}

// What an older build left in the browser: pins with no width at all.
const OLD_PINS = [
  { id: 'old-eraser', kind: 'eraser', style: {} },
  { id: 'old-polyline', kind: 'polyline', style: { strokeColor: '#ff0000', strokeOpacity: 100, lineStyle: 'solid' } },
  { id: 'old-polygon', kind: 'polygon', style: { strokeColor: '#0000ff', strokeOpacity: 100, lineStyle: 'solid' } },
  { id: 'old-text', kind: 'text', style: { strokeColor: '#000000', strokeOpacity: 100, lineStyle: 'solid' } },
  { id: 'old-pen', kind: 'pen', style: { strokeColor: '#00aa00' } },
];
const EXPECTED = { 'old-eraser': '20', 'old-polyline': '2', 'old-polygon': '2', 'old-text': '1', 'old-pen': '3' };

const LAYOUTS = [
  { name: 'desktop', viewport: { width: 1400, height: 900 }, app: null },
  { name: 'phone web', viewport: { width: 390, height: 844 }, app: null },
  { name: 'phone app', viewport: { width: 390, height: 844 }, app: 'ios' },
];

for (const layout of LAYOUTS) {
  test(`pinned tools (${layout.name}): every pin shows its size, old saved pins too`, async ({ page }) => {
    test.setTimeout(150_000);
    const admin = adminClient();
    const owner = await apiClientFor(E2E_ACCOUNTS.owner);
    const doc = await seedDoc(admin, owner, `Pin badges ${layout.name}`);
    try {
      await page.setViewportSize(layout.viewport);
      await page.addInitScript(({ pins, app }) => {
        if (app) {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => app, isPluginAvailable: () => false, Plugins: {} };
        }
        localStorage.setItem('survey.flag.pinned-tools', '1');
        if (!sessionStorage.getItem('pin-badges-seeded')) {
          sessionStorage.setItem('pin-badges-seeded', '1');
          localStorage.setItem('survey:pinned-tools.v1', JSON.stringify({ pins, visible: true, placement: 'bottom' }));
        }
      }, { pins: OLD_PINS, app: layout.app });
      await signIn(page, E2E_ACCOUNTS.owner);
      await openDoc(page, doc);
      const slots = page.locator('[data-pinned-tools-dock] [data-pin-slot]').filter({ visible: true });
      await expect(slots).toHaveCount(OLD_PINS.length, { timeout: 20_000 });
      for (const [id, width] of Object.entries(EXPECTED)) {
        await expect(page.locator(`[data-pinned-tools-dock] [data-pin-id="${id}"] .pinned-dock__badge`), id).toHaveText(width);
      }
      // Armed, the old eraser pin keeps its number (it now has settings, so
      // later size edits save into it).
      const eraserPin = page.locator('[data-pinned-tools-dock] [data-pin-id="old-eraser"]');
      await eraserPin.click();
      await expect(eraserPin).toHaveAttribute('aria-pressed', 'true');
      await expect(eraserPin.locator('.pinned-dock__badge')).toHaveText('20');
      await page.screenshot({ path: test.info().outputPath(`pin-badges-${layout.name.replace(' ', '-')}.png`) });
    } finally {
      await admin.from('documents').delete().eq('id', doc.id);
      await admin.storage.from('documents').remove([doc.path]);
    }
  });
}
