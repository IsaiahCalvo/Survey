// agent-cli/form-field-persistence-e2e.mjs — guard for PDF form-field edit persistence.
//
// Drives the real app in Chromium (dev auto-login): opens a document that has an
// AcroForm text field, types a value, blurs (blur flushes immediately per the
// usePdfjsFormFieldPersistence contract), then reloads + reopens the doc and asserts
// the value survived. Form-field values persist as 'form-field' annotations through the
// same Yjs/Supabase pipeline as visual annotations.
//
// Guards the already-extracted usePdfjsFormFieldPersistence hook + the save pipeline.
//
//   APP_URL=http://localhost:5186 node agent-cli/form-field-persistence-e2e.mjs ["Doc.pdf"]
//   HEADFUL=1 APP_URL=... node agent-cli/form-field-persistence-e2e.mjs
//
// Exit 0 = value persisted. Exit 1 = failed.
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2] || 'clickable-link-test.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `  (${detail})` : ''}`);
};

// selector for a fillable text form field (text input or textarea, not checkbox/radio)
const TEXT_FIELD = '.pdfjsFormLayer input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), .pdfjsFormLayer textarea';

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

const openDoc = async () => {
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 45000 }); await tile.click();
  const openBtn = page.getByRole('button', { name: /open file/i }).first();
  await openBtn.waitFor({ state: 'visible', timeout: 15000 }); await openBtn.click();
  await page.waitForSelector('.survey-pdfjs-viewer', { timeout: 30000 });
  await page.waitForSelector('.pdfjsFormLayer', { timeout: 20000 });
};

try {
  await page.goto(APP_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await openDoc();
  await page.waitForTimeout(1500);

  const field = page.locator(TEXT_FIELD).first();
  await field.waitFor({ state: 'visible', timeout: 15000 });
  check('0. document has a fillable text form field', await field.count() > 0);

  // record the annotation-id of the field so we assert the SAME field after reopen
  const fieldId = await field.evaluate((el) => {
    const sec = el.closest('section[data-annotation-id]');
    return sec ? sec.getAttribute('data-annotation-id') : null;
  });

  const VALUE = 'E2E-FORM-' + Date.now().toString().slice(-6);

  // ── type + blur ────────────────────────────────────────────────────────────
  await field.click();
  await field.fill(''); // clear anything present
  await field.type(VALUE, { delay: 20 });
  const liveValue = await field.inputValue();
  await page.keyboard.press('Tab'); // blur → immediate flush
  await page.waitForTimeout(1500);  // let the save reach the backend
  check('1. value is typed into the field', liveValue === VALUE, `live="${liveValue}"`);

  // ── reload + reopen ──────────────────────────────────────────────────────────
  await page.goto(APP_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await openDoc();

  // find the same field (prefer by annotation-id) and poll for the restored value
  const reField = fieldId
    ? page.locator(`.pdfjsFormLayer section[data-annotation-id="${fieldId}"] input, .pdfjsFormLayer section[data-annotation-id="${fieldId}"] textarea`).first()
    : page.locator(TEXT_FIELD).first();
  await reField.waitFor({ state: 'visible', timeout: 20000 });

  let restored = '';
  for (let i = 0; i < 20; i++) {
    restored = await reField.inputValue().catch(() => '');
    if (restored === VALUE) break;
    await page.waitForTimeout(500);
  }
  check('2. form-field value persists across reload + reopen', restored === VALUE,
    `fieldId=${fieldId}, restored="${restored}", expected="${VALUE}"`);

  await page.screenshot({ path: 'agent-cli/form-field-persistence-e2e-result.png' });
} catch (e) {
  check('harness completed without error', false, e.message);
} finally {
  await browser.close();
}

const failed = checks.filter(c => !c.pass);
console.log(`\n${failed.length === 0 ? '✅ PASS' : '❌ FAIL'}: ${checks.length - failed.length}/${checks.length} form-field checks passed`);
if (failed.length) { console.log('   failed: ' + failed.map(c => c.name).join('; ')); process.exitCode = 1; }
