// Photo or camera to PDF (beta flag 'photo-upload', Drawboard phone apps):
// Upload takes photos too, and each becomes a one-page PDF that uploads and
// opens like any PDF. The photo here carries an EXIF "turn 90°" tag, as a
// phone held upright writes it, so the PDF must come out portrait.
import { PDFDocument } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

// A 400x200 JPEG (red left half, blue right half) drawn in the browser, with
// an EXIF orientation 6 block put in after the start marker.
async function sidewaysPhoto(page) {
  const b64 = await page.evaluate(async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 400, height: 200 });
    const g = c.getContext('2d');
    g.fillStyle = '#d00'; g.fillRect(0, 0, 200, 200);
    g.fillStyle = '#00d'; g.fillRect(200, 0, 200, 200);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const jpg = new Uint8Array(await blob.arrayBuffer());
    const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const app1 = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
    const out = new Uint8Array(jpg.length + app1.length);
    out.set(jpg.subarray(0, 2), 0);
    out.set(app1, 2);
    out.set(jpg.subarray(2), 2 + app1.length);
    let s = '';
    for (const b of out) s += String.fromCharCode(b);
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

for (const size of [{ name: 'desktop', width: 1400, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
  test(`photo upload (${size.name}): a photo turns into an upright one-page PDF and opens`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.addInitScript(() => localStorage.setItem('survey.flag.photo-upload', '1'));
    const admin = adminClient();
    const api = await apiClientFor(E2E_ACCOUNTS.owner);
    const { data: { user } } = await api.auth.getUser();
    const photoName = `Panel west ${size.name} ${RUN}.jpg`;
    const pdfName = photoName.replace(/\.jpg$/, '.pdf');
    const rows = async () => (await admin.from('documents').select('id, name, file_path').eq('user_id', user.id).eq('name', pdfName)).data || [];
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      const input = page.locator('input[type="file"]:not([multiple])').first();
      await expect(input).toHaveAttribute('accept', 'application/pdf,image/*', { timeout: 30_000 });
      await input.setInputFiles({ name: photoName, mimeType: 'image/jpeg', buffer: await sidewaysPhoto(page) });
      await expect.poll(async () => (await rows()).length, { timeout: 60_000 }).toBe(1);
      // It opens in the viewer: a drawn page shows up.
      await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
      await page.screenshot({ path: test.info().outputPath(`photo-upload-${size.name}.png`) });
      const [row] = await rows();
      let bytes = null;
      await expect.poll(async () => {
        const { data } = await admin.storage.from('documents').download(row.file_path);
        bytes = data ? new Uint8Array(await data.arrayBuffer()) : null;
        return Boolean(bytes);
      }, { timeout: 30_000 }).toBe(true);
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(1);
      const { width, height } = pdf.getPage(0).getSize();
      expect(height).toBeGreaterThan(width); // the EXIF turn was applied
      expect(Math.round(height)).toBe(792);
    } finally {
      const found = await rows();
      if (found.length) {
        await admin.storage.from('documents').remove(found.map((r) => r.file_path).filter(Boolean));
        await admin.from('documents').delete().in('id', found.map((r) => r.id));
      }
    }
  });
}

test('photo upload: with the flag off the picker takes PDFs only', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await expect(page.locator('input[type="file"]:not([multiple])').first()).toHaveAttribute('accept', 'application/pdf', { timeout: 30_000 });
});
