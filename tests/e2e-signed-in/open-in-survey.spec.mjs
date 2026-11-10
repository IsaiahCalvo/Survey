// "Open in Survey" (beta flag 'open-in-survey', Drawboard phone apps): a PDF
// opened from Files, Mail or Teams reaches the app as a content:// or file://
// url. The cloud has no phone, so this fakes the file reader and hands the url
// to the same reader the app uses (src/mobile/nativeOpenFile.js), at phone size. The real intent / document-type wiring is
// covered by tests/nativeOpenFile.test.mjs and the CI phone walks.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function onePagePdf(text) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 22, font });
  return Buffer.from(await pdf.save()).toString('base64');
}

async function fakePhoneApp(page, { flagOn }) {
  await page.setViewportSize({ width: 390, height: 844 });
  return page.addInitScript((on) => {
    if (on) localStorage.setItem('survey.flag.open-in-survey', '1');
    else localStorage.removeItem('survey.flag.open-in-survey');
  }, flagOn);
}

// Opens `url` as if another app handed it over; the fake reader returns `b64`.
function openFromOtherApp(page, url, b64) {
  return page.evaluate(async ([u, data]) => {
    const m = await import('/src/mobile/nativeOpenFile.js');
    await m.receiveOpenedFile(u, { Filesystem: { readFile: async () => ({ data }), deleteFile: async () => {} } });
  }, [url, b64]);
}

test('open in survey: a PDF from another app uploads and opens; a non-PDF gets a plain note', async ({ page }) => {
  test.setTimeout(180_000);
  await fakePhoneApp(page, { flagOn: true });
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const fileName = `Opened from mail ${RUN}.pdf`;
  const drawn = `Shared plan ${RUN}`;
  const rows = async () => (await admin.from('documents').select('id, name').eq('user_id', user.id).eq('name', fileName)).data || [];
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.waitForTimeout(1500);
    await openFromOtherApp(
      page,
      `content://com.android.externalstorage.documents/document/primary%3ADownload%2F${encodeURIComponent(fileName)}`,
      await onePagePdf(drawn),
    );
    await expect(page.getByText(drawn)).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await rows()).length, { timeout: 20_000 }).toBe(1);
    await page.screenshot({ path: test.info().outputPath('open-in-survey-opened.png') });

    await openFromOtherApp(page, 'content://com.example.mail/attachment/77', Buffer.from('<html>not a pdf</html>').toString('base64'));
    await expect(page.getByText('That file is not a PDF.')).toBeVisible({ timeout: 10_000 });
  } finally {
    const ids = (await rows()).map((r) => r.id);
    if (ids.length) await admin.from('documents').delete().in('id', ids);
  }
});

test('open in survey: with the flag off nothing uploads and the note points to Upload', async ({ page }) => {
  test.setTimeout(120_000);
  await fakePhoneApp(page, { flagOn: false });
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const fileName = `Flag off ${RUN}.pdf`;
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.waitForTimeout(1500);
  await openFromOtherApp(page, `file:///var/mobile/Documents/Inbox/${encodeURIComponent(fileName)}`, await onePagePdf('Flag off'));
  await expect(page.getByText('Survey cannot open files from other apps yet. Use Upload on Home.')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  const { data } = await admin.from('documents').select('id').eq('user_id', user.id).eq('name', fileName);
  expect(data || []).toEqual([]);
});
