// Nightly 'custom-answers': Photo and Signature lines. A photo is uploaded
// to survey media and shown on its line; a signature is drawn on a pad. The
// line's answer ("1 photo", "Signed <day>") follows the media, and both come
// back after a reload.
import zlib from 'node:zlib';
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

let original = null;

test.beforeAll(async () => {
  const db = adminClient();
  const { data } = await db.from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
  original = data.config;
  const config = structuredClone(original);
  const lines = config.modules[0].categories[0].checklist;
  lines[0] = { ...lines[0], kind: 'photo' };
  lines[1] = { ...lines[1], kind: 'signature' };
  const { error } = await db.from('templates').update({ config }).eq('id', E2E_SURVEY.templateId);
  if (error) throw error;
});

test.afterAll(async () => {
  if (original) await adminClient().from('templates').update({ config: original }).eq('id', E2E_SURVEY.templateId);
});

// A 16 x 16 red PNG, built here so the spec needs no fixture file.
function redPng() {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(16, 0); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(48, 0).map((_, i) => (i % 3 === 0 ? 255 : 0))]);
  const raw = Buffer.concat(Array.from({ length: 16 }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// "Survey template updated": take the version this spec wrote.
async function takeLatest(page) {
  const latest = page.getByRole('button', { name: 'Use latest version' });
  if (await latest.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await latest.click();
}

async function openSurveyItem(page, { reopened = false } = {}) {
  if (!reopened) {
    await page.getByText(E2E_SURVEY.documentName, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
  }
  await expect(page.getByRole('button', { name: `Close ${E2E_SURVEY.documentName}` })).toBeVisible({ timeout: 60_000 });
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]:visible').first().waitFor({ timeout: 60_000 });
  const category = page.getByRole('button', { name: `Show Survey Markers in ${E2E_SURVEY.categoryName}` });
  const chooser = page.getByText('Choose a survey template', { exact: true });
  if (!(await category.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    await expect(chooser.or(category).first()).toBeVisible({ timeout: 30_000 });
    if (await chooser.isVisible()) {
      await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
      await takeLatest(page);
    }
  }
  // A document keeps the template version it was surveyed with; take the
  // version this spec just wrote (kinds, units, meanings).
  await page.getByRole('button', { name: /^Survey template: .*Switch template$/ }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: E2E_SURVEY.templateName }).or(page.getByRole('menuitemradio', { name: E2E_SURVEY.templateName })).or(page.getByRole('option', { name: E2E_SURVEY.templateName })).first().click();
  await takeLatest(page);
  await expect(category).toBeVisible();
  const expand = page.getByRole('button', { name: 'Expand marker details' }).first();
  if (!(await expand.isVisible().catch(() => false))) await category.click();
  await expand.click();
}

test('a Photo line takes a photo and a Signature line takes a signature', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.custom-answers', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurveyItem(page);
  const [cable, frame] = E2E_SURVEY.checklist.map((c) => c.text);
  const photos = page.getByRole('button', { name: new RegExp(`^${cable} photo \\d+$`) });
  const signature = page.getByRole('button', { name: `${frame} signature`, exact: true });

  // Start blank (a rerun on the same stack finds the last run's media).
  while (await photos.count()) {
    await photos.first().click();
    await page.getByRole('button', { name: 'Remove this photo' }).click();
  }
  if (await signature.count()) await page.getByRole('button', { name: `Clear ${frame} signature` }).click();
  await expect(page.getByText('0/3', { exact: true })).toBeVisible();

  // Photo: the file goes up and shows on its line, not in the note strip.
  await page.getByTestId('line-photo-input-e2e-cl-cable').first().setInputFiles({ name: 'label.png', mimeType: 'image/png', buffer: redPng() });
  await expect(photos).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText('1/3', { exact: true })).toBeVisible();
  await expect(page.getByTestId('survey-marker-notes').getByTestId('survey-media-thumb')).toHaveCount(0);

  // Signature: draw on the pad, save.
  await page.getByRole('button', { name: `Sign ${frame}` }).click();
  const pad = page.getByRole('dialog', { name: `Sign: ${frame}` });
  await expect(pad.getByRole('button', { name: 'Save' })).toBeDisabled();
  const box = await pad.getByLabel('Signature pad').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 90);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 30 + i * 25, box.y + 90 + (i % 2 ? -30 : 30));
  await page.mouse.up();
  await pad.getByRole('button', { name: 'Save' }).click();
  await expect(pad).toHaveCount(0, { timeout: 30_000 });
  await expect(signature).toBeVisible();
  await expect(page.getByText('2/3', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/photo-signature.png' });

  // Saved with the item: still there after a reload.
  await page.waitForTimeout(2000);
  await page.reload();
  await openSurveyItem(page, { reopened: true });
  await expect(photos).toHaveCount(1, { timeout: 30_000 });
  await expect(signature).toBeVisible();
  await expect(page.getByText('2/3', { exact: true })).toBeVisible();

  // Removing the media clears the answers; leave the item blank.
  await photos.first().click();
  await page.getByRole('button', { name: 'Remove this photo' }).click();
  await page.getByRole('button', { name: `Clear ${frame} signature` }).click();
  await expect(page.getByText('0/3', { exact: true })).toBeVisible();
  await page.waitForTimeout(2000);
});
