// Disabled-actions audit (owner 2026-10-06).
//
// "When I'm in select mode, if nothing is selected, I shouldn't be able to
//  copy, move, duplicate, share, or even delete anything. Those icons need to
//  be visibly disabled, or else the user can't tell whether they can interact
//  with those buttons ... That goes for all types of buttons."
//
// WHAT IT CHECKS, on a 1440x900 desktop and a 390x844 touch phone:
//   1. NAMED controls in named states are enabled or disabled as they should
//      be (select mode with nothing picked / one picked / all picked, an empty
//      clipboard, the only page, the top mark, an empty survey, no bookmarks).
//   2. EVERY disabled control visible in each state wears the ONE disabled
//      look (src/styles/states.css section 6): its ink and every theme-inked
//      glyph stroke are --disabled-ink, it is not faded with an element
//      opacity, and on desktop the pointer is not-allowed.
//   3. A disabled control does nothing: hovering it changes nothing (desktop)
//      and a forced click opens no dialog / menu and leaves an open menu open.
//   4. No ENABLED control is painted in the disabled ink ("looks off, works").
// It screenshots each state (the folder is DISABLED_AUDIT_SHOTS, or the test's
// output folder) and prints one line per check, failing once at the end.
//
// Run it by hand against a dev server (it is not in the CI shards):
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 npx playwright test \
//     --config debug/playwright.config.mjs debug/scenarios/disabled-actions-audit.spec.mjs
// add PW_CHROMIUM_PATH=/path/to/chrome when Playwright's Chromium is missing.
// Only local fake data: the hub preview and a test PDF; every request that is
// not to the local dev server is blocked.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const VIEWER = '/?testPdf=clickable-link-test.pdf&surveyTemplateWorkflowE2E=1';
const HOME = '/?hubPreview=1&workflowE2E=1&signedIn=1';
const PHONE = '&mobileNav=tabs&nativeShell=expo';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE_DEVICE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA };
// A survey template with categories and NO items (so Export has nothing).
const TEMPLATES = [{
  id: 'audit-template', name: 'Audit Template', entities: [],
  modules: [{ id: 'audit-mod', name: 'Main', categories: [
    { id: 'audit-c1', name: 'Cameras', color: '#d8a84e', checklist: [] },
    { id: 'audit-c2', name: 'Doors', color: '#5ba1f0', checklist: [] },
  ] }],
}, {
  // A second template, so "all picked" is more than one (Share opens one).
  id: 'audit-template-2', name: 'Audit Template Two', entities: [],
  modules: [{ id: 'audit-mod-2', name: 'Main', categories: [] }],
}];

test.use({
  video: 'off',
  screenshot: 'off',
  actionTimeout: 5000,
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 300_000 });

// ---------------------------------------------------------------- inspection

// Every visible control, with what the shared rule cares about. Runs in the page.
function readControls() {
  const probe = document.createElement('span');
  probe.style.color = 'var(--disabled-ink)';
  document.body.appendChild(probe);
  const ink = getComputedStyle(probe).color;
  probe.remove();
  const sel = 'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"], [role="option"]';
  const out = [];
  for (const e of document.querySelectorAll(sel)) {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    // Hidden behind something else (the home hub under an open viewer)?
    const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
    if (!hit || !(hit === e || e.contains(hit) || hit.contains(e))) continue;
    let opacity = 1;
    for (let n = e; n && n !== document.body; n = n.parentElement) {
      const o = Number(getComputedStyle(n).opacity);
      if (Number.isFinite(o)) opacity *= o;
    }
    const strokes = [];
    for (const g of e.querySelectorAll('svg, svg *')) {
      const attr = g.getAttribute('stroke');
      if (attr && !/^(var\(|currentColor)/.test(attr)) continue; // a drawing's own colour
      const s = getComputedStyle(g).stroke;
      if (s && s !== 'none') strokes.push(s);
    }
    out.push({
      name: (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 48),
      disabled: e.disabled === true || e.getAttribute('aria-disabled') === 'true',
      color: cs.color,
      cursor: cs.cursor,
      opacity: Math.round(opacity * 100) / 100,
      strokes: [...new Set(strokes)],
      ink,
    });
  }
  return out;
}

const overlays = (page) => page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')]
  .filter((e) => e.getBoundingClientRect().width > 0).length);

function auditor(page, testInfo, label, { phone }) {
  const rows = [];
  const shotsDir = process.env.DISABLED_AUDIT_SHOTS || testInfo.outputPath('shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const record = (name, problem) => rows.push({ name, problem });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0].slice(0, 160)));

  // Check every visible control in this state, plus the named expectations.
  async function state(name, expected = {}) {
    await page.waitForTimeout(250);
    const slug = `${phone ? 'phone' : 'desktop'}-${name}`.replace(/[^\w.-]+/g, '-');
    await page.screenshot({ path: path.join(shotsDir, `${slug}.png`) });
    const controls = await page.evaluate(readControls);
    let disabledCount = 0;
    for (const c of controls) {
      if (c.disabled) {
        disabledCount += 1;
        const bad = [];
        if (c.color !== c.ink) bad.push(`ink ${c.color} (want ${c.ink})`);
        const off = c.strokes.filter((s) => s !== c.ink);
        if (off.length) bad.push(`glyph ${off.join('/')}`);
        if (c.opacity < 0.99) bad.push(`faded to ${c.opacity}`);
        if (!phone && c.cursor !== 'not-allowed') bad.push(`cursor ${c.cursor}`);
        if (bad.length) record(`${name}: "${c.name}" looks off`, bad.join('; '));
      } else if (c.color === c.ink) {
        record(`${name}: "${c.name}" enabled`, 'painted in the disabled ink');
      }
    }
    for (const [control, want] of Object.entries(expected)) {
      const found = controls.filter((c) => c.name === control);
      if (!found.length) { record(`${name}: "${control}" ${want}`, 'not on screen'); continue; }
      const is = found.some((c) => c.disabled) ? 'disabled' : 'enabled';
      record(`${name}: "${control}" ${want}`, is === want ? null : `is ${is}`);
    }
    record(`${name}: ${disabledCount} disabled / ${controls.length} controls share the look`, null);
  }

  // A disabled control does nothing: no hover change (desktop), and a forced
  // click opens nothing and closes nothing.
  async function inert(name, control, { scope = null } = {}) {
    const base = scope ? page.locator(scope) : page;
    const target = base.getByRole('button', { name: control, exact: true })
      .or(base.getByRole('menuitem', { name: control, exact: true })).filter({ visible: true }).first();
    if (!(await target.count())) { record(`${name}: "${control}" inert`, 'not on screen'); return; }
    const look = () => target.evaluate((e) => {
      const g = e.querySelector('svg, span') || e;
      const cs = getComputedStyle(e);
      return [cs.color, cs.backgroundColor, cs.boxShadow, getComputedStyle(g).scale, getComputedStyle(g).transform].join('|');
    });
    if (!phone) {
      const before = await look();
      await target.hover({ force: true });
      await page.waitForTimeout(220);
      const after = await look();
      if (before !== after) { record(`${name}: "${control}" inert`, `hover changed it (${before} -> ${after})`); return; }
    }
    const before = await overlays(page);
    await target.click({ force: true, timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(350);
    const after = await overlays(page);
    record(`${name}: "${control}" inert`, before === after ? null : `click changed the open dialogs/menus (${before} -> ${after})`);
  }

  async function finish() {
    if (errors.length) record('page errors', errors.join(' | '));
    const failed = rows.filter((r) => r.problem);
    const lines = rows.map((r) => `${r.problem ? 'FAIL' : ' ok '}  ${r.name}${r.problem ? `  —  ${r.problem}` : ''}`);
    console.log(`\n=== ${label}: ${rows.length - failed.length}/${rows.length} checks OK (shots: ${shotsDir}) ===\n${lines.join('\n')}\n`);
    expect(failed.map((r) => `${r.name} — ${r.problem}`), `${label}: disabled-state problems`).toEqual([]);
  }
  return { state, inert, finish, record };
}

// ------------------------------------------------------------------- helpers

const visible = (loc) => loc.filter({ visible: true }).first();
const btn = (page, name) => visible(page.getByRole('button', { name, exact: true }));
const press = (phone, loc) => (phone ? loc.tap() : loc.click());

async function prepare(context) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await context.addInitScript((t) => { try { localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(t)); } catch {} }, TEMPLATES);
}

async function openHome(page, phone) {
  await page.goto(HOME + (phone ? PHONE : ''));
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(1200);
}

async function openViewer(page, phone) {
  await page.goto(VIEWER + (phone ? PHONE : ''));
  await expect(btn(page, 'Pan')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.survey-pdfjs-page-div').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
}

const SELECT_ACTIONS = ['Duplicate', 'Move', 'Copy', 'Share', 'Delete'];
const all = (names, want) => Object.fromEntries(names.map((n) => [n, want]));

// Documents / Projects / Templates: select mode with nothing, all, then none.
async function walkHomeSelect(page, a, phone) {
  const tabs = [
    { tab: 'Documents', actions: SELECT_ACTIONS, multiShare: true },
    { tab: 'Projects', actions: ['Duplicate', 'Share', 'Delete'], multiShare: false },
    { tab: 'Templates', actions: ['Duplicate', 'Share', 'Delete'], multiShare: false },
  ];
  for (const { tab, actions, multiShare } of tabs) {
    const tabButton = visible(page.getByRole('button', { name: tab, exact: true }).or(page.getByRole('tab', { name: tab, exact: true })));
    await press(phone, tabButton);
    await page.waitForTimeout(1000);
    await press(phone, btn(page, 'Select'));
    await page.waitForTimeout(500);
    await a.state(`${tab} select-mode nothing picked`, { 'Select all': 'enabled', ...all(actions, 'disabled') });
    await a.inert(`${tab} nothing picked`, 'Delete');
    await a.inert(`${tab} nothing picked`, 'Duplicate');
    await press(phone, btn(page, 'Select all'));
    await page.waitForTimeout(400);
    const want = all(actions, 'enabled');
    // Share opens ONE project / template; with several picked it is off.
    if (!multiShare) want.Share = 'disabled';
    await a.state(`${tab} select-mode all picked`, { 'Select none': 'enabled', ...want });
    await press(phone, btn(page, 'Select none'));
    await page.waitForTimeout(400);
    await a.state(`${tab} select-mode none again`, all(actions, 'disabled'));
    await press(phone, btn(page, 'Done'));
    await page.waitForTimeout(400);
  }
}

async function openSurvey(page, phone) {
  // Owner 2026-10-07: the desktop Survey tab opens the panel (no chevron).
  await press(phone, btn(page, phone ? 'Open survey' : 'Survey'));
  await page.waitForTimeout(1200);
  const tpl = visible(page.getByRole('button', { name: /Audit Template/ }));
  if (await tpl.count()) { await press(phone, tpl); await page.waitForTimeout(1500); }
}

// ------------------------------------------------------------------- desktop

test.describe('desktop 1440x900', () => {
  test.use(DESKTOP);

  test('home: select mode', async ({ page, context }, testInfo) => {
    await prepare(context);
    const a = auditor(page, testInfo, 'desktop home', { phone: false });
    try {
      await openHome(page, false);
      await walkHomeSelect(page, a, false);
    } finally { await a.finish(); }
  });

  test('viewer: history, pages, marks, bookmarks, survey', async ({ page, context }, testInfo) => {
    await prepare(context);
    const a = auditor(page, testInfo, 'desktop viewer', { phone: false });
    try {
      await openViewer(page, false);
      // A one-page document, nothing done yet.
      await a.state('fresh document', { Undo: 'disabled', Redo: 'disabled', 'Previous page': 'disabled', 'Next page': 'disabled' });
      await a.inert('fresh document', 'Undo');

      // The page menu: empty clipboard, the only page, nothing to reset.
      await btn(page, 'Pages').click();
      await page.waitForTimeout(1200);
      await page.locator('img[alt="Page 1"]').first().click({ button: 'right' });
      await page.waitForTimeout(500);
      await a.state('page menu', { Cut: 'enabled', Copy: 'enabled', Paste: 'disabled', Reset: 'disabled', Delete: 'disabled', Rotate: 'enabled' });
      await a.inert('page menu', 'Paste');
      await page.keyboard.press('Escape');
      await page.mouse.click(700, 880);
      await page.waitForTimeout(300);

      // Bookmarks with none: Edit has nothing to edit.
      await btn(page, 'Bookmarks').click();
      await page.waitForTimeout(800);
      await a.state('bookmarks none', { 'Edit bookmarks': 'disabled', 'Add bookmark': 'enabled' });

      // The top mark's menu: nothing above it, empty clipboard.
      const top = await page.evaluate(() => {
        const layer = document.querySelector('[data-svg-annotation-layer="1"]');
        const marks = [...(layer?.querySelectorAll('[data-annotation-index]') || [])];
        if (!marks.length) return null;
        const max = marks.reduce((m, e) => (Number(e.dataset.annotationIndex) > Number(m.dataset.annotationIndex) ? e : m));
        // A point ON the drawn line (a stroke's box centre can be bare paper).
        const shape = [max, ...max.querySelectorAll('*')].find((n) => typeof n.getTotalLength === 'function' && n.getTotalLength() > 0);
        if (shape) {
          const pt = shape.getPointAtLength(shape.getTotalLength() / 2).matrixTransform(shape.getScreenCTM());
          return { x: pt.x, y: pt.y, index: Number(max.dataset.annotationIndex), count: marks.length };
        }
        const r = max.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, index: Number(max.dataset.annotationIndex), count: marks.length };
      });
      if (!top) a.record('mark menu', 'no marks on the test page');
      else {
        await btn(page, 'Rectangle Select').click();
        await page.waitForTimeout(300);
        await page.mouse.click(top.x, top.y, { button: 'right' });
        await page.waitForTimeout(500);
        await a.state('top mark menu', { Paste: 'disabled', 'Bring to front': 'disabled', 'Bring forward': 'disabled', 'Send to back': 'enabled', Copy: 'enabled' });
        await a.inert('top mark menu', 'Bring forward');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await btn(page, 'Pan').click();
      }

      // The survey: no items yet, so Export has nothing; categories select mode.
      await openSurvey(page, false);
      await a.state('survey no items', { 'Export to Excel': 'disabled' });
      await a.inert('survey no items', 'Export to Excel');
      const rail = page.locator('.survey-rail');
      await visible(rail.getByRole('button', { name: 'Select', exact: true })).click();
      await page.waitForTimeout(400);
      await a.state('survey categories nothing picked', { 'Select all': 'enabled', Move: 'disabled', Copy: 'disabled', Delete: 'disabled' });
      await visible(rail.getByRole('button', { name: 'Select all', exact: true })).click();
      await page.waitForTimeout(300);
      // No move flow for categories; their copy copies items, and there are none.
      await a.state('survey categories all picked', { Delete: 'enabled', Move: 'disabled', Copy: 'disabled' });
    } finally { await a.finish(); }
  });
});

// --------------------------------------------------------------------- phone

test.describe('phone 390x844', () => {
  test.use(PHONE_DEVICE);

  test('home: select mode', async ({ page, context }, testInfo) => {
    await prepare(context);
    const a = auditor(page, testInfo, 'phone home', { phone: true });
    try {
      await openHome(page, true);
      await walkHomeSelect(page, a, true);
    } finally { await a.finish(); }
  });

  test('viewer: header, pages, survey', async ({ page, context }, testInfo) => {
    await prepare(context);
    const a = auditor(page, testInfo, 'phone viewer', { phone: true });
    try {
      await openViewer(page, true);
      await a.state('fresh document', { Undo: 'disabled', Redo: 'disabled', 'Previous page': 'disabled', 'Next page': 'disabled' });
      await a.inert('fresh document', 'Undo');

      // The Pages sheet: Paste with an empty clipboard.
      await btn(page, 'Open pages, search, and bookmarks').tap();
      await page.waitForTimeout(1500);
      await a.state('pages sheet', { Paste: 'disabled' });
      await a.inert('pages sheet', 'Paste');
      // The page's own menu (long press / More on the card).
      const more = visible(page.getByRole('button', { name: 'Page 1 actions', exact: true }));
      if (await more.count()) {
        await more.tap();
        await page.waitForTimeout(500);
        if (await page.locator('[role="menu"]').filter({ visible: true }).count()) {
          await a.state('page menu', { 'Move up': 'disabled', 'Move down': 'disabled', Paste: 'disabled', Reset: 'disabled', Delete: 'disabled', Copy: 'enabled' });
          await a.inert('page menu', 'Move up');
        }
      }
      await page.goto('about:blank');
      await openViewer(page, true);
      await openSurvey(page, true);
      await a.state('survey no items', { 'Export to Excel': 'disabled' });
    } finally { await a.finish(); }
  });
});
