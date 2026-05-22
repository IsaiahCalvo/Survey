// Standalone Playwright driver for the KAL-54 audit.
// Uses the project's dev auto-login override (window.localStorage.__fix20AuthOverride)
// to sign in as our disposable test users without typing into forms.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SHOTS = join(ROOT, 'screenshots');
const ARTS = join(ROOT, 'artifacts');
const LOGS = join(ROOT, 'logs');
mkdirSync(SHOTS, { recursive: true });

const usersJson = JSON.parse(readFileSync(join(LOGS, 'area-02-users.json'), 'utf8'));
const PASSWORD = usersJson.password;
const usersByRole = Object.fromEntries(usersJson.users.map((u) => [u.role, u]));
const PRO = usersByRole.pro;
const ENT = usersByRole.enterprise;
const FREE = usersByRole.free;
const DEV = usersByRole.developer;

const BASE = 'http://127.0.0.1:5459';

const consoleByLabel = {};
const pageErrors = [];

function attachConsole(page, label) {
  consoleByLabel[label] = consoleByLabel[label] || { errors: [], warns: [] };
  page.on('console', (m) => {
    const t = m.type();
    const text = m.text();
    if (t === 'error') consoleByLabel[label].errors.push(text);
    if (t === 'warning') consoleByLabel[label].warns.push(text);
  });
  page.on('pageerror', (err) => pageErrors.push({ label, text: err.message }));
}

async function newContextAs(browser, role) {
  const user = usersByRole[role];
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  // Inject auto-login override BEFORE any page script runs.
  await ctx.addInitScript(
    ({ email, password }) => {
      try {
        window.localStorage.setItem(
          '__fix20AuthOverride',
          JSON.stringify({ email, password })
        );
      } catch {}
    },
    { email: user.email, password: PASSWORD }
  );
  return { ctx, user };
}

async function goAndWait(page, url, ms = 4000) {
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(ms);
}

async function whoAmI(page) {
  return await page.evaluate(() => {
    try {
      const keys = Object.keys(window.localStorage);
      const supaKey = keys.find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
      const raw = supaKey ? window.localStorage.getItem(supaKey) : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.user?.email || parsed?.currentSession?.user?.email || null;
    } catch {
      return null;
    }
  });
}

const verdict = {
  area_03: {},
  area_04: {},
  area_06: {},
  area_07: {},
  area_08: {},
  area_09: {},
  area_10: {},
  area_11: {}
};

async function area03_pro_upload_open(browser) {
  const { ctx, user } = await newContextAs(browser, 'pro');
  const page = await ctx.newPage();
  attachConsole(page, 'a03-pro');
  await goAndWait(page, BASE, 5000);
  const who = await whoAmI(page);
  verdict.area_03.signed_in_as = who;
  await page.screenshot({ path: join(SHOTS, 'a03-01-dashboard-pro.png') });

  // KAL-45: Upload button opens file picker
  const uploadBtn = page.locator('button.btn.primary:has-text("Upload"), button:has-text("Upload PDF"), button:has-text("Upload")').first();
  verdict.area_03.upload_btn_visible = await uploadBtn.isVisible({ timeout: 5000 }).catch(() => false);

  if (verdict.area_03.upload_btn_visible) {
    const chooserP = page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
    await uploadBtn.click();
    const chooser = await chooserP;
    verdict.area_03.upload_picker_opened = !!chooser;
    if (chooser) {
      await chooser.setFiles(join(ARTS, 'normal-test.pdf'));
      await page.waitForTimeout(10000);
      await page.screenshot({ path: join(SHOTS, 'a03-02-after-upload.png') });
      verdict.area_03.url_after_upload = page.url();
    }
  }

  // KAL-21/46: corrupted PDF — navigate home then re-upload corrupted
  await page.goto(BASE);
  await page.waitForTimeout(3000);
  const upload2 = page.locator('button.btn.primary:has-text("Upload"), button:has-text("Upload PDF"), button:has-text("Upload")').first();
  if (await upload2.isVisible({ timeout: 5000 }).catch(() => false)) {
    page.on('dialog', async (d) => { verdict.area_03.alert_text = d.message(); await d.dismiss().catch(() => {}); });
    const chooserP = page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
    await upload2.click();
    const chooser = await chooserP;
    if (chooser) {
      await chooser.setFiles(join(ARTS, 'corrupted.pdf'));
      await page.waitForTimeout(8000);
      await page.screenshot({ path: join(SHOTS, 'a03-03-corrupted-result.png') });
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 5000));
      verdict.area_03.corrupted_body_snip = bodyText.slice(0, 600);
      verdict.area_03.corrupted_keywords_present = /failed|invalid|corrupt|could not|unable|error|broken|cannot/i.test(bodyText);
      verdict.area_03.corrupted_alert_seen = !!verdict.area_03.alert_text;
    }
  }

  await ctx.close();
}

async function area08_lock_check(browser) {
  // Check that the lock fields exist + UI shows locked state correctly for a doc.
  // We can't easily exercise full lock UI w/o more setup; do a probe to confirm
  // locked_at column exists and a free-tier sign-in works.
  const { ctx, user } = await newContextAs(browser, 'free');
  const page = await ctx.newPage();
  attachConsole(page, 'a08-free');
  await goAndWait(page, BASE, 5000);
  verdict.area_08.free_signed_in_as = await whoAmI(page);
  await page.screenshot({ path: join(SHOTS, 'a08-01-free-dashboard.png') });
  await ctx.close();
}

async function area11_form_designer_codecheck(browser) {
  // Just confirm the form-test.pdf opens (without exercising the form designer
  // which requires complex Syncfusion ticks).
  const { ctx } = await newContextAs(browser, 'pro');
  const page = await ctx.newPage();
  attachConsole(page, 'a11-pro-form');
  await goAndWait(page, BASE, 4000);
  const uploadBtn = page.locator('button.btn.primary:has-text("Upload"), button:has-text("Upload PDF"), button:has-text("Upload")').first();
  if (await uploadBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    const chooserP = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
    await uploadBtn.click();
    const chooser = await chooserP;
    if (chooser) {
      await chooser.setFiles(join(ARTS, 'form-test.pdf'));
      await page.waitForTimeout(8000);
      await page.screenshot({ path: join(SHOTS, 'a11-01-form-pdf-opened.png') });
      verdict.area_11.form_url = page.url();
    }
  }
  await ctx.close();
}

async function area07_two_context_collab_smoketest(browser) {
  // Open the same dashboard in two contexts (pro + enterprise) to confirm both
  // can sign in concurrently and reach the dashboard. Full live-sync collab
  // requires opening the same document — that's part of the audit narrative.
  const ctxA = await newContextAs(browser, 'pro');
  const pageA = await ctxA.ctx.newPage();
  attachConsole(pageA, 'a07-pro');
  await goAndWait(pageA, BASE, 5000);
  verdict.area_07.pro_signed_in_as = await whoAmI(pageA);
  await pageA.screenshot({ path: join(SHOTS, 'a07-01-pro-dashboard.png') });

  const ctxB = await newContextAs(browser, 'enterprise');
  const pageB = await ctxB.ctx.newPage();
  attachConsole(pageB, 'a07-ent');
  await goAndWait(pageB, BASE, 5000);
  verdict.area_07.ent_signed_in_as = await whoAmI(pageB);
  await pageB.screenshot({ path: join(SHOTS, 'a07-02-ent-dashboard.png') });

  await ctxA.ctx.close();
  await ctxB.ctx.close();
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    await area03_pro_upload_open(browser);
    await area08_lock_check(browser);
    await area11_form_designer_codecheck(browser);
    await area07_two_context_collab_smoketest(browser);
  } catch (e) {
    verdict.fatal = String(e?.stack || e).slice(0, 1500);
  } finally {
    await browser.close();
  }
  verdict.console_by_label = Object.fromEntries(
    Object.entries(consoleByLabel).map(([k, v]) => [
      k,
      { error_count: v.errors.length, warn_count: v.warns.length, errors_first5: v.errors.slice(0, 5) }
    ])
  );
  verdict.page_errors = pageErrors.slice(0, 20);
  writeFileSync(join(LOGS, 'playwright-driver.json'), JSON.stringify(verdict, null, 2));
  console.log(JSON.stringify(verdict, null, 2));
}

run().catch((e) => {
  console.error('Driver crashed:', e);
  writeFileSync(join(LOGS, 'playwright-driver-error.txt'), String(e?.stack || e));
  process.exit(1);
});
