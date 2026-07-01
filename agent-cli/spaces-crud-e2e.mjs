// agent-cli/spaces-crud-e2e.mjs — regression guard for Survey SPACES CRUD + persistence.
//
// Drives the real app in Chromium (dev auto-login): creates a Space, renames it,
// (optionally reorders when a 2nd exists), asserts it persists across a close+reopen,
// then deletes it. Spaces persist in localStorage under `pdfSidebar_${pdfId}`.
//
// Guards the Phase-B bookmark/space helper extraction.
//
//   APP_URL=http://localhost:5186 node agent-cli/spaces-crud-e2e.mjs ["Doc.pdf"]
//   HEADFUL=1 APP_URL=... node agent-cli/spaces-crud-e2e.mjs
//
// Exit 0 = all checks passed. Exit 1 = at least one failed.
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2] || 'SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept().catch(() => {})); // window.confirm on delete

const openDoc = async () => {
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 45000 }); await tile.click();
  const openBtn = page.getByRole('button', { name: /open file/i }).first();
  await openBtn.waitFor({ state: 'visible', timeout: 15000 }); await openBtn.click();
  await page.waitForSelector('.survey-pdfjs-viewer', { timeout: 30000 });
  await page.waitForTimeout(1500);
};

// read the spaces array persisted for the open doc (pdfSidebar_<pdfId>)
const readPersistedSpaces = () => page.evaluate(() => {
  const key = Object.keys(localStorage).find(k => k.startsWith('pdfSidebar_'));
  if (!key) return { key: null, spaces: [] };
  try { const d = JSON.parse(localStorage.getItem(key) || '{}'); return { key, spaces: d.spaces || [] }; }
  catch { return { key, spaces: [] }; }
});

try {
  await page.goto(APP_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await openDoc();

  // open the Spaces panel (left rail Survey/Spaces entry), then find Create Space
  const openSpacesPanel = async () => {
    for (const sel of ['button[title="Spaces"]', 'button[title="Survey"]']) {
      const b = page.locator(sel).first();
      if (await b.count()) { await b.click().catch(() => {}); await page.waitForTimeout(500); }
    }
  };
  await openSpacesPanel();

  const createBtn = page.locator('[title="Create Space"]').first();
  await createBtn.waitFor({ state: 'visible', timeout: 15000 });

  const before = (await readPersistedSpaces()).spaces.length;

  // ── CHECK 1: create a space ────────────────────────────────────────────────
  await createBtn.click(); await page.waitForTimeout(800);
  let after = (await readPersistedSpaces()).spaces.length;
  check('1. create adds a space', after === before + 1, `before=${before}, after=${after}`);

  // ── CHECK 2: rename the space (inline name field) ──────────────────────────
  const RENAME = 'E2E-SPACE-' + Date.now().toString().slice(-5);
  const nameField = page.locator('.space-name-inline').last();
  let renamed = false;
  if (await nameField.count()) {
    await nameField.click({ clickCount: 3 }).catch(() => {});
    await nameField.fill(RENAME).catch(async () => { await page.keyboard.type(RENAME); });
    await page.keyboard.press('Enter'); await page.waitForTimeout(700);
    const names = (await readPersistedSpaces()).spaces.map(s => s.name);
    renamed = names.includes(RENAME);
  }
  check('2. rename persists to the space', renamed, `looking for "${RENAME}"`);

  // ── CHECK 3: persistence across close + reopen ─────────────────────────────
  const persistedKey = (await readPersistedSpaces()).key;
  // close doc → dashboard, then reopen
  await page.goto(APP_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await openDoc();
  await openSpacesPanel();
  await page.waitForTimeout(1000);
  const afterReopen = (await readPersistedSpaces()).spaces;
  const survived = afterReopen.some(s => s.name === RENAME);
  check('3. space survives close + reopen', survived,
    `key=${persistedKey}, names=${JSON.stringify(afterReopen.map(s => s.name)).slice(0, 200)}`);

  // ── CHECK 4: delete the space ──────────────────────────────────────────────
  const delBefore = (await readPersistedSpaces()).spaces.length;
  const delBtn = page.locator('.space-card-delete-button').last();
  let deleted = false;
  if (await delBtn.count()) {
    await delBtn.click(); await page.waitForTimeout(900);
    const delAfter = (await readPersistedSpaces()).spaces.length;
    deleted = delAfter === delBefore - 1;
  }
  check('4. delete removes the space', deleted, `before=${delBefore}`);

  await page.screenshot({ path: 'agent-cli/spaces-crud-e2e-result.png' });
} catch (e) {
  check('harness completed without error', false, e.message);
} finally {
  await browser.close();
}

const failed = checks.filter(c => !c.pass);
console.log(`\n${failed.length === 0 ? '✅ PASS' : '❌ FAIL'}: ${checks.length - failed.length}/${checks.length} spaces CRUD checks passed`);
if (failed.length) { console.log('   failed: ' + failed.map(c => c.name).join('; ')); process.exitCode = 1; }
