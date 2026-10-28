// Nightly beta 'conditional-lines', kept hidden (owner 2026-10-27: "wire it
// in, hide it"): a checklist line shows only once another line has a
// certain answer, e.g. Address only when Protocol is OSDP.
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const [CABLE, FRAME, DOOR] = E2E_SURVEY.checklist;
let original = null;

// Text lines, so the spec can blank its answers again (a pick-one answer
// cannot be cleared, and the specs after this one need D-1-17 blank).
async function writeTemplate(lines) {
  const config = structuredClone(original);
  config.modules[0].categories[0].checklist = lines;
  const { error } = await adminClient().from('templates').update({ config }).eq('id', E2E_SURVEY.templateId);
  if (error) throw error;
}

test.beforeAll(async () => {
  const { data } = await adminClient().from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
  original = data.config;
});

test.afterAll(async () => {
  if (original) await adminClient().from('templates').update({ config: original }).eq('id', E2E_SURVEY.templateId);
});

async function openSurveyItem(page) {
  await page.getByText(E2E_SURVEY.documentName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]:visible').first().waitFor({ timeout: 60_000 });
  const category = page.getByRole('button', { name: `Show Survey Markers in ${E2E_SURVEY.categoryName}` });
  const latest = page.getByRole('button', { name: 'Use latest version' });
  if (!(await category.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    const chooser = page.getByText('Choose a survey template', { exact: true });
    await expect(chooser.or(category).or(latest).first()).toBeVisible({ timeout: 30_000 });
    if (await chooser.isVisible()) await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
  }
  // Take the template version this spec just wrote.
  const takeLatest = async () => { if (await latest.waitFor({ timeout: 6_000 }).then(() => true, () => false)) await latest.click(); };
  await takeLatest();
  if (!(await category.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /^Survey template: .*Switch template$/ }).filter({ visible: true }).first().click();
    await page.getByRole('menuitem', { name: E2E_SURVEY.templateName }).or(page.getByRole('menuitemradio', { name: E2E_SURVEY.templateName })).or(page.getByRole('option', { name: E2E_SURVEY.templateName })).first().click();
    await takeLatest();
  }
  await expect(category).toBeVisible();
  const expand = page.getByRole('button', { name: 'Expand marker details' }).first();
  if (!(await expand.isVisible().catch(() => false))) await category.click();
  await expand.click();
}

const box = (page, line) => page.getByRole('textbox', { name: `${line} answer` });
async function answer(page, line, value) {
  await box(page, line).fill(value);
  await box(page, line).press('Enter');
  await expect(box(page, line)).toHaveValue(value);
}

const CONDITIONAL = [
  { id: CABLE.id, text: CABLE.text, kind: 'text' },
  { id: FRAME.id, text: FRAME.text, kind: 'text', showIf: { itemId: CABLE.id, value: 'OSDP' } },
  { id: DOOR.id, text: DOOR.text, kind: 'text' },
];

test('flag on: the line shows once the line above has its answer, and hides again', async ({ page }) => {
  await writeTemplate(CONDITIONAL);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.custom-answers', '1');
    localStorage.setItem('survey.flag.conditional-lines', '1');
  });
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurveyItem(page);

  await expect(box(page, CABLE.text)).toBeVisible();
  await expect(box(page, FRAME.text)).toHaveCount(0);
  await expect(page.getByText('0/2', { exact: true }).first()).toBeVisible();

  await answer(page, CABLE.text, 'Wiegand');
  await expect(box(page, FRAME.text)).toHaveCount(0);
  await answer(page, CABLE.text, 'OSDP');
  await expect(box(page, FRAME.text)).toBeVisible();
  await expect(page.getByText('1/3', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/conditional-lines-shown.png' });

  // Blank again: the line hides, and D-1-17 ends blank for the specs after.
  await answer(page, CABLE.text, '');
  await expect(box(page, FRAME.text)).toHaveCount(0);
  await expect(page.getByText('0/2', { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1500);
});

test('flag off (the default, Nightly too): every line shows, the condition is ignored', async ({ page }) => {
  await writeTemplate(CONDITIONAL);
  await page.addInitScript(() => localStorage.setItem('survey.flag.custom-answers', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurveyItem(page);
  await expect(box(page, FRAME.text)).toBeVisible();
  await expect(page.getByText('0/3', { exact: true }).first()).toBeVisible();
});

test('flag on: the template editor sets and clears a line\'s condition', async ({ page }) => {
  await writeTemplate([
    { id: CABLE.id, text: CABLE.text },
    { id: FRAME.id, text: FRAME.text, kind: 'text' },
    { id: DOOR.id, text: DOOR.text, kind: 'text' },
  ]);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.custom-answers', '1');
    localStorage.setItem('survey.flag.conditional-lines', '1');
  });
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  await page.getByText(E2E_SURVEY.templateName, { exact: true }).filter({ visible: true }).first().click();
  const category = page.getByRole('button', { name: `Expand ${E2E_SURVEY.categoryName}`, exact: true }).filter({ visible: true }).first();
  const when = page.getByRole('button', { name: `When "${FRAME.text}" shows`, exact: true }).filter({ visible: true }).first();
  if (!(await when.isVisible().catch(() => false))) await category.click();
  await expect(when).toBeVisible({ timeout: 30_000 });
  // The first line has nothing above it to wait on.
  await when.click();
  await page.getByRole('listbox', { name: `When "${FRAME.text}" shows` }).getByRole('option', { name: `When "${CABLE.text}" is N/A` }).click();
  await page.screenshot({ path: 'test-results/conditional-lines-editor.png' });
  await page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first().click();
  const stored = async () => {
    const { data } = await adminClient().from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
    return data.config.modules[0].categories[0].checklist[1].showIf ?? null;
  };
  await expect.poll(stored, { timeout: 20_000 }).toEqual({ itemId: CABLE.id, value: 'N/A' });

  await when.click();
  await page.getByRole('listbox', { name: `When "${FRAME.text}" shows` }).getByRole('option', { name: 'Always shown' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first().click();
  await expect.poll(stored, { timeout: 20_000 }).toBe(null);
});
