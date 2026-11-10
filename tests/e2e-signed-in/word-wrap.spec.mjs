// Word wrap (beta flag 'word-wrap', Drawboard PDF Pro trial audit
// 2026-11-09): a new text box or callout breaks its lines at spaces, never
// inside a word. Marks made without the flag keep the old wrap.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function seedSheet(label) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([792, 612]).drawText(`Wrap test ${label}`, { x: 72, y: 560, size: 24, font });
  const bytes = Buffer.from(await pdf.save());
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const id = crypto.randomUUID();
  const name = `Wrap ${label} ${RUN}.pdf`;
  await must('upload', admin.storage.from('documents').upload(`${user.id}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: `${user.id}/${id}.pdf`, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return {
    name,
    label,
    remove: async () => {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([`${user.id}/${id}.pdf`]);
    },
  };
}

const PAGE = '[data-overlay-page="1"]';
const WORDS = 'please confirm the isolation valve position before restart';

// The words of a mark's text drawn across two lines (a word broken inside).
const brokenWords = (page, root) => page.evaluate(({ rootSel, words }) => {
  const nodes = [...document.querySelectorAll(`${rootSel} foreignObject div`)];
  const host = nodes.find((n) => n.textContent.includes('isolation'));
  if (!host) return null;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
  const node = texts.find((t) => t.data.includes('isolation'));
  const broken = [];
  let from = 0;
  for (const word of words.split(' ')) {
    const at = node.data.indexOf(word, from);
    from = at + word.length;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + word.length);
    const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
    if (tops.size > 1) broken.push(word);
  }
  const lines = new Set();
  const all = document.createRange();
  all.selectNodeContents(node);
  [...all.getClientRects()].forEach((r) => lines.add(Math.round(r.top)));
  return { broken, lines: lines.size };
}, { rootSel: root, words: WORDS });

async function placeText(page, at) {
  const before = await page.locator(`${PAGE} [data-annotation-id]`).count();
  await page.keyboard.press('t');
  await page.mouse.move(at(0.12, 0.3).x, at(0.12, 0.3).y);
  await page.mouse.down();
  await page.mouse.move(at(0.32, 0.3).x, at(0.32, 0.3).y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.type(WORDS);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.locator(`${PAGE} [data-annotation-id]`).count()).toBeGreaterThan(before);
}

async function placeCallout(page, at) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('q');
  await expect(page.locator('[aria-label="Callout"][aria-pressed="true"], .is-active[aria-label="Callout"]').first()).toBeVisible();
  await page.mouse.move(at(0.5, 0.75).x, at(0.5, 0.75).y);
  await page.mouse.down();
  await page.mouse.move(at(0.6, 0.62).x, at(0.6, 0.62).y, { steps: 6 });
  await page.mouse.up();
  // The callout's editor is open and has the caret.
  await expect.poll(() => page.evaluate(() => document.activeElement?.isContentEditable === true)).toBe(true);
  await page.keyboard.type(WORDS);
  await page.keyboard.press('Escape');
  await expect(page.locator(`${PAGE} [data-callout-id]`).first()).toBeVisible();
}

for (const flagOn of [true, false]) {
  test(`text boxes and callouts ${flagOn ? 'wrap at spaces with' : 'keep the old wrap without'} the flag`, async ({ page }) => {
    test.setTimeout(150_000);
    if (flagOn) await page.addInitScript(() => localStorage.setItem('survey.flag.word-wrap', '1'));
    const sheet = await seedSheet(flagOn ? 'on' : 'off');
    try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText(`Wrap test ${sheet.label}`)).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1000);
    const pageBox = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
    const at = (fx, fy) => ({ x: pageBox.x + pageBox.width * fx, y: pageBox.y + pageBox.height * fy });

    await placeText(page, at);
    await placeCallout(page, at);
    await page.waitForTimeout(1000);

    const text = await brokenWords(page, `${PAGE} [data-annotation-id]`);
    const callout = await brokenWords(page, `${PAGE} [data-callout-id]`);
    expect(text, 'text box drawn').not.toBeNull();
    expect(callout, 'callout drawn').not.toBeNull();
    expect(text.lines).toBeGreaterThan(2);
    expect(callout.lines).toBeGreaterThan(2);
    if (flagOn) {
      expect(text.broken).toEqual([]);
      expect(callout.broken).toEqual([]);
      // A reload draws them the same way (the mode is saved with the mark).
      await page.reload();
      await expect.poll(async () => (await brokenWords(page, `${PAGE} [data-callout-id]`))?.lines ?? 0, { timeout: 60_000 }).toBeGreaterThan(2);
      expect((await brokenWords(page, `${PAGE} [data-annotation-id]`)).broken).toEqual([]);
      expect((await brokenWords(page, `${PAGE} [data-callout-id]`)).broken).toEqual([]);
    } else {
      expect(text.broken.length + callout.broken.length).toBeGreaterThan(0);
    }
    } finally {
      await sheet.remove();
    }
  });
}
