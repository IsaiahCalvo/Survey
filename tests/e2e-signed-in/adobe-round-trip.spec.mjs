// Adobe round trip (2026-11-14, src/utils/pdfOutsideEdits.js): marks drawn
// in Survey, exported, changed in another PDF app (one recoloured, one
// deleted, as real Acrobat does it: /C rewritten, /M stamped), then uploaded
// back as a new version (Nightly 'outside-edits') come back with those
// changes, on desktop and phone. The export also reads well in Acrobat:
// "Rectangle" subject, author and dates.
import { readFileSync } from 'node:fs';
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { dragPage, tool } from '../../debug/scenarios/test-plan/tp-actions.mjs';
import { DESKTOP, PHONE } from '../../debug/scenarios/test-plan/tp-local-doc.mjs';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);
const strokeOf = (page, id) => page.evaluate((markId) => {
  const node = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"] rect[stroke], [data-overlay-page="1"] rect[data-annotation-id="${markId}"]`);
  return node ? String(node.getAttribute('stroke') || '').toLowerCase() : null;
}, id);

test.use({ acceptDownloads: true });
test.describe.configure({ timeout: 240_000 });

async function sourcePdf(label) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText(label, { x: 72, y: 720, size: 24, font });
  return Buffer.from(await pdf.save());
}

async function expectPageDrawn(page) {
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect(pageDiv.locator('[data-svg-annotation-layer="1"]').first()).toBeAttached();
}

async function upload(page, name, buffer) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Upload', exact: true }).filter({ visible: true }).first().click(),
  ]);
  await chooser.setFiles({ name, mimeType: 'application/pdf', buffer });
}

const decode = (doc, dict, key) => {
  const value = dict.get(PDFName.of(key));
  return value ? (doc.context.lookup(value) || value).decodeText() : undefined;
};

for (const [size, device] of [['desktop', DESKTOP], ['phone', PHONE]]) test.describe(size, () => {
test.use(device);
test('Acrobat colour change and delete come back with "Upload as new version"', async ({ page }) => {
  const phone = size === 'phone';
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Adobe round trip ${size} ${RUN}.pdf`;
  try {
    await page.addInitScript(() => {
      try { localStorage.setItem('survey.flag.outside-edits', '1'); } catch { /* */ }
    });
    await signIn(page, E2E_ACCOUNTS.owner);
    await upload(page, name, await sourcePdf(`Round trip ${size}`));
    await expectPageDrawn(page);
    await page.waitForTimeout(1_500);

    // Two rectangles.
    await tool(page, 'Shapes', 'Rectangle');
    await dragPage(page, 1, [[60, 80], [140, 120], [220, 160]]);
    await page.keyboard.press('Escape');
    await tool(page, 'Shapes', 'Rectangle');
    await dragPage(page, 1, [[60, 300], [140, 340], [220, 380]]);
    await page.keyboard.press('Escape');
    await expect.poll(() => markIds(page), { timeout: 20_000 }).toHaveLength(2);
    const [first, second] = await markIds(page);
    const firstStroke = await strokeOf(page, first);
    expect(firstStroke).toBeTruthy();
    expect(firstStroke).not.toBe('#0000ff');
    const { data: docs } = await admin.from('documents').select('id').eq('user_id', user.id).eq('name', name);
    const documentId = docs[0].id;
    await expect.poll(async () => {
      const { count } = await admin.from('annotation_updates').select('seq', { count: 'exact', head: true }).eq('document_id', documentId);
      return count;
    }, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(2_000);

    // Export: readable in Acrobat, with Survey's fingerprint on each mark.
    if (phone) await page.getByRole('button', { name: 'More document options' }).click();
    if (phone) await page.waitForTimeout(500);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export annotated PDF' }).first().click(),
    ]);
    const exported = readFileSync(await download.path());
    const doc = await PDFDocument.load(exported);
    const pdfPage = doc.getPage(0);
    const entries = pdfPage.node.Annots().asArray().map((ref) => ({ ref, dict: doc.context.lookup(ref, PDFDict) }));
    const squares = entries.filter(({ dict }) => dict.get(PDFName.of('Subtype')) === PDFName.of('Square'));
    expect(squares).toHaveLength(2);
    for (const { dict } of squares) {
      expect(decode(doc, dict, 'Subj')).toBe('Rectangle');
      expect(decode(doc, dict, 'T')).toBe(E2E_ACCOUNTS.owner.label);
      expect(decode(doc, dict, 'M')).toMatch(/^D:\d{14}Z$/);
      expect(JSON.parse(decode(doc, dict, 'SurveyAppAnnotation')).written?.rect).toHaveLength(4);
    }

    // "Acrobat": recolour the first, delete the second.
    const keep = [];
    for (const { ref, dict } of entries) {
      const nm = decode(doc, dict, 'NM');
      if (nm === second) continue;
      if (nm === first) {
        dict.set(PDFName.of('C'), doc.context.obj([0, 0, 1]));
        dict.set(PDFName.of('M'), PDFString.of("D:20261114112752-05'00'"));
      }
      keep.push(ref);
    }
    expect(keep.length).toBe(entries.length - 1);
    pdfPage.node.set(PDFName.of('Annots'), doc.context.obj(keep));
    const edited = Buffer.from(await doc.save());

    // Back as a new version of the same file.
    await page.getByRole('button', { name: phone ? 'Back to documents' : `Close ${name}` }).first().click();
    await upload(page, name, edited);
    await page.getByRole('dialog', { name: 'You already have this file name' })
      .getByRole('button', { name: 'Upload as new version' }).click();
    await expectPageDrawn(page);
    await expect.poll(() => strokeOf(page, first), { timeout: 30_000 }).toBe('#0000ff');
    await expect.poll(() => markIds(page), { timeout: 20_000 }).toEqual([first]);

    // It is stored, not just shown: a reload keeps both changes.
    await page.waitForTimeout(3_000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const back = page.getByRole('button', { name: phone ? 'Back to documents' : `Close ${name}` });
    const uploadButton = page.getByRole('button', { name: 'Upload', exact: true });
    await expect(back.or(uploadButton).first()).toBeVisible({ timeout: 60_000 });
    if (!(await back.first().isVisible())) {
      await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first().click();
    }
    await expectPageDrawn(page);
    await expect.poll(() => strokeOf(page, first), { timeout: 30_000 }).toBe('#0000ff');
    await expect.poll(() => markIds(page), { timeout: 20_000 }).toEqual([first]);
  } finally {
    await admin.from('documents').delete().eq('name', name).eq('user_id', user.id);
  }
});
});
