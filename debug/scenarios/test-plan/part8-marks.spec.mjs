// TEST-PLAN Part 8 — Working with marks, items 49-58
// (docs/handoff-2026-09-29/TEST-PLAN.md). Each item is checked the way the
// owner would do it by hand, and prints one verdict line:
//   [test-plan] <item> <variant> PASS|FAIL <numbers>
//
// Desktop: Chromium 1440x900, real mouse + keyboard. The app maps shortcuts
// per OS: Copy / Cut / Paste / Duplicate / Undo answer to Ctrl AND Cmd (Meta)
// everywhere, so both are pressed; the hold-to-move key is Cmd on a Mac and
// Ctrl elsewhere (utils/moveModifier.js), so item 51 runs Ctrl on Linux, Meta
// on Linux (must NOT move) and Meta with the page told it is on a Mac.
// Phone (item 49): 390x844 touch in Chromium (trusted CDP touch) and WebKit,
// the iOS Safari / WKWebView engine (touch-typed pointer events; see lib.mjs).
//
// Not in CI (needs a browser). Run it like the click-every-control walk:
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/part8-marks.spec.mjs
// Screenshots + one JSON verdict per item: test-results/test-plan/ (or
// TEST_PLAN_OUT). Only local fake data (?testPdf=…); every request that is
// not to the dev server is blocked.
import { test, expect } from '@playwright/test';
import * as L from './lib.mjs';

test.use({ video: 'off', screenshot: 'off' });
test.describe.configure({ timeout: 300_000 });

const near = (a, b, tol = 2.5) => Math.abs(a - b) <= tol;
const byId = async (page, id) => (await L.marks(page)).find((m) => m.id === id) || null;
const last = async (page) => { const m = await L.marks(page); return m[m.length - 1]; };

async function viewer(t, opts = {}) {
  const env = await L.launch(opts);
  t.info().annotations.push({ type: 'browser', description: `${opts.engine || 'chromium'} ${opts.device || 'desktop'}${opts.mac ? ' (Mac)' : ''}` });
  const v = await L.openViewer(env, opts);
  return { env, ...v };
}

// ------------------------------------------------------------------ 49
for (const [engine, device] of [['chromium', 'desktop'], ['chromium', 'phone'], ['webkit', 'phone']]) {
  test(`49 resize flips — ${engine} ${device}`, async () => {
    const { env, page, errors, touch } = await viewer(test, { engine, device });
    try {
      await L.drawRect(page, 200, 660, 300, 740);
      const r0 = await last(page);
      const [ex, ey] = await L.at(page, 250, 660);
      if (touch) await touch.tap(ex, ey); else await L.click(page, ex, ey);
      // WebKit drags are synthetic (untrusted): the press is handed to the
      // selection only under Select (the Pan hand-off needs a real press).
      if (engine === 'webkit') await L.tool(page, 'select');
      const mr = (await L.handles(page)).find((h) => h.h === 'mr');
      expect(mr, 'right grabber shown').toBeTruthy();
      const { scale } = await L.pageBox(page);
      // right grabber from x=300 to x=120: 80 past the left side (x=200)
      const dx = -180 * scale;
      if (touch) await touch.drag(mr.x, mr.y, mr.x + dx, mr.y, { steps: 16 });
      else await L.drag(page, mr.x, mr.y, mr.x + dx, mr.y, { steps: 16 });
      const r1 = await byId(page, r0.id);
      const path = await L.shot(page, `49-${engine}-${device}`);
      const ok = !!r1 && near(r1.left, r0.left - 81, 4) && near(r1.w, 81, 4) && near(r1.h, r0.h, 1);
      L.record(49, `${engine}-${device}`, ok ? 'PASS' : 'FAIL', `rect x ${r0.left}..${r0.left + r0.w} -> ${r1?.left}..${r1 ? r1.left + r1.w : '?'} (w ${r0.w} -> ${r1?.w}); input ${touch?.kind || 'mouse'}; ${path}`);
      expect(ok, 'shape flipped and kept growing the other way').toBe(true);
      expect(errors).toEqual([]);
    } finally { await env.browser.close(); }
  });
}

// ------------------------------------------------------------------ 50
test('50 tight grab areas — chromium desktop', async () => {
  const { env, page, errors } = await viewer(test);
  try {
    await L.drawRect(page, 200, 660, 300, 740);
    const r0 = await last(page);
    const [ex, ey] = await L.at(page, 250, 660);
    await L.click(page, ex, ey);
    const hs = await L.handles(page);
    const tl = hs.find((h) => h.h === 'tl');
    const br = hs.find((h) => h.h === 'br');
    const out = {};
    for (const off of [4, 12]) {
      await L.click(page, ex, ey);
      let marquee = false;
      await L.drag(page, tl.x - off, tl.y - off, br.x + 20, br.y + 20, {
        mid: async () => { marquee = await page.evaluate(() => !!document.querySelector('[data-marquee-selection-preview]')); },
      });
      const r1 = await byId(page, r0.id);
      const resized = r1.w !== r0.w || r1.left !== r0.left;
      out[off] = { marquee, resized, picked: (await L.selection(page)).some((s) => s.endsWith(r0.id)) };
      if (resized) await L.key(page, 'Control+z');
    }
    const path = await L.shot(page, '50-desktop');
    // 12 px out from the corner (≈7 px clear of the grabber dot): a box-select.
    // 4 px out (on the grabber's own small pad): still a resize.
    const ok = out[12].marquee && !out[12].resized && out[12].picked && out[4].resized;
    L.record(50, 'chromium-desktop', ok ? 'PASS' : 'FAIL', `press 12px outside corner: marquee=${out[12].marquee} resized=${out[12].resized} picked-by-box=${out[12].picked}; 4px outside: resized=${out[4].resized}; ${path}`);
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  } finally { await env.browser.close(); }
});

// ------------------------------------------------------------------ 51
for (const v of [
  { name: 'linux-Control', mac: false, key: 'Control', expectMove: true },
  { name: 'linux-Meta', mac: false, key: 'Meta', expectMove: false },
  { name: 'mac-Meta', mac: true, key: 'Meta', expectMove: true },
]) {
  test(`51 hold-key drag — ${v.name}`, async () => {
    const { env, page, errors } = await viewer(test, { mac: v.mac });
    try {
      await L.drawRect(page, 340, 680, 352, 692); // a small mark: its grabbers cover it
      const s0 = await last(page);
      const [px, py] = await L.at(page, 346, 680);
      await L.click(page, px, py);
      const picked = (await L.selection(page)).length === 1;
      const [cx, cy] = await L.at(page, 346, 686); // inside its box
      let midHandles = null;
      await L.drag(page, cx, cy, cx + 60, cy + 30, { modifiers: [v.key], mid: async () => { midHandles = (await L.handles(page)).length; } });
      const s1 = await byId(page, s0.id);
      await L.wait(1200);
      const s2 = await byId(page, s0.id);
      const { scale } = await L.pageBox(page);
      const moved = near(s1.left, s0.left + 60 / scale, 2) && near(s1.top, s0.top + 30 / scale, 2);
      const stayed = s2.left === s1.left && s2.top === s1.top;
      const path = await L.shot(page, `51-${v.name}`);
      const ok = picked && (v.expectMove ? (moved && stayed && midHandles === 0) : (!moved));
      L.record(51, v.name, ok ? 'PASS' : 'FAIL', `${v.key}-drag: ${s0.left},${s0.top} -> ${s1.left},${s1.top} (1.2 s later ${s2.left},${s2.top}); grabbers during drag ${midHandles}; expected ${v.expectMove ? 'move' : 'no move (not the move key on this OS)'}; ${path}`);
      expect(ok).toBe(true);
      expect(errors).toEqual([]);
    } finally { await env.browser.close(); }
  });
}

// ------------------------------------------------------------------ 52 / 53
for (const mod of ['Control', 'Meta']) {
  test(`52 duplicate — ${mod}+D`, async () => {
    const { env, page, errors } = await viewer(test);
    try {
      await L.drawRect(page, 200, 660, 300, 740);
      const r0 = await last(page);
      const [ex, ey] = await L.at(page, 250, 660);
      await L.click(page, ex, ey);
      const n0 = (await L.marks(page)).length;
      await L.key(page, `${mod}+d`);
      await L.wait(400);
      const ms = await L.marks(page);
      const copy = ms[ms.length - 1];
      const sel = await L.selection(page);
      const path = await L.shot(page, `52-${mod}`);
      const ok = ms.length === n0 + 1 && copy.id !== r0.id && near(copy.left, r0.left + 16, 1) && near(copy.top, r0.top + 16, 1)
        && sel.length === 1 && sel[0].endsWith(copy.id);
      L.record(52, `${mod}+D`, ok ? 'PASS' : 'FAIL', `marks ${n0} -> ${ms.length}; copy at ${copy.left},${copy.top} (original ${r0.left},${r0.top}); picked: ${sel.length === 1 && sel[0].endsWith(copy.id) ? 'the copy only' : JSON.stringify(sel)}; ${path}`);
      expect(ok).toBe(true);
      expect(errors).toEqual([]);
    } finally { await env.browser.close(); }
  });

  test(`53 paste picks copies — ${mod}+C/V`, async () => {
    const { env, page, errors } = await viewer(test);
    try {
      await L.drawRect(page, 200, 660, 300, 740);
      const r0 = await last(page);
      const [ex, ey] = await L.at(page, 250, 660);
      await L.click(page, ex, ey);
      await L.key(page, `${mod}+c`);
      await L.key(page, `${mod}+v`);
      await L.wait(500);
      const copy = await last(page);
      const sel = await L.selection(page);
      await L.key(page, 'ArrowRight');
      await L.wait(900);
      const o1 = await byId(page, r0.id);
      const c1 = await byId(page, copy.id);
      const ok = copy.id !== r0.id && sel.length === 1 && sel[0].endsWith(copy.id)
        && o1.left === r0.left && near(c1.left, copy.left + 1, 0.2);
      L.record(53, `${mod}+C/V`, ok ? 'PASS' : 'FAIL', `after paste picked: ${sel.length === 1 && sel[0].endsWith(copy.id) ? 'the copy' : JSON.stringify(sel)}; ArrowRight: original x ${r0.left} -> ${o1.left}, copy x ${copy.left} -> ${c1.left}`);
      expect(ok).toBe(true);
      expect(errors).toEqual([]);
    } finally { await env.browser.close(); }
  });
}

// ------------------------------------------------------------------ 54 / 55
// One rect, one callout, one Survey Marker, side by side on page 1's blank band.
async function seedMix(page) {
  await L.drawRect(page, 60, 660, 140, 720);
  await L.drawCallout(page, 160, 700, 200, 670, 'Hi');
  await L.placeMarker(page, 420, 690, 460, 720);
  await page.evaluate(() => document.activeElement?.blur?.());
  await L.key(page, 'Escape');
  await L.tool(page, 'select');
}
const mixState = async (page) => {
  const ms = await L.marks(page);
  return {
    rects: ms.filter((m) => m.type.toLowerCase() === 'rect' && m.top > 600).map((m) => ({ id: m.id, x: m.left, y: m.top })),
    callouts: (await L.calloutBoxes(page)).map((c) => ({ id: c.id, x: c.left, y: c.top })),
    markers: (await L.surveyMarkers(page)).map((m) => ({ id: m.id, x: m.x, y: m.y })),
    sel: await L.selection(page),
  };
};
async function boxSelectMix(page) {
  const [x0, y0] = await L.at(page, 40, 640);
  const [x1, y1] = await L.at(page, 480, 735);
  await L.drag(page, x0, y0, x1, y1);
}

for (const mod of ['Control', 'Meta']) {
  test(`54 mixed clipboard — ${mod}+C/V`, async () => {
    const { env, page, errors } = await viewer(test, { survey: true });
    try {
      await seedMix(page);
      await boxSelectMix(page);
      const a = await mixState(page);
      const cams0 = (await L.surveyPanelText(page)).match(/Cameras (\d+)/)?.[1];
      await L.key(page, `${mod}+c`);
      await L.key(page, `${mod}+v`);
      await L.wait(900);
      const b = await mixState(page);
      const cams1 = (await L.surveyPanelText(page)).match(/Cameras (\d+)/)?.[1];
      const newRect = b.rects.find((r) => !a.rects.some((o) => o.id === r.id));
      const newCallout = b.callouts.find((r) => !a.callouts.some((o) => o.id === r.id));
      const newMarker = b.markers.find((r) => !a.markers.some((o) => o.id === r.id));
      const path = await L.shot(page, `54-${mod}`);
      // same layout: the three copies keep the originals' offsets (screen px)
      const { scale } = await L.pageBox(page);
      const d = (n, o) => (n && o ? [Math.round(n.x - o.x), Math.round(n.y - o.y)] : null);
      const dr = newRect ? [Math.round((newRect.x - a.rects[0].x) * scale), Math.round((newRect.y - a.rects[0].y) * scale)] : null;
      const dc = d(newCallout, a.callouts[0]);
      const dm = d(newMarker, a.markers[0]);
      const sameLayout = dr && dc && dm && Math.abs(dr[0] - dc[0]) <= 3 && Math.abs(dr[1] - dc[1]) <= 3 && Math.abs(dc[0] - dm[0]) <= 3 && Math.abs(dc[1] - dm[1]) <= 3;
      const ok = a.sel.length === 3 && !!newRect && !!newCallout && !!newMarker && sameLayout && Number(cams1) === Number(cams0) + 1;
      L.record(54, `${mod}+C/V`, ok ? 'PASS' : 'FAIL', `picked ${a.sel.length}; pasted rect/callout/marker: ${!!newRect}/${!!newCallout}/${!!newMarker}; offsets px rect ${dr} callout ${dc} marker ${dm}; Survey panel Cameras ${cams0} -> ${cams1} (new item); ${path}`);
      expect(ok).toBe(true);
      expect(errors).toEqual([]);
    } finally { await env.browser.close(); }
  });
}

test('55 Survey Markers join selections — box-select, drag, one undo', async () => {
  const { env, page, errors } = await viewer(test, { survey: true });
  try {
    await seedMix(page);
    await boxSelectMix(page);
    const a = await mixState(page);
    const [gx, gy] = await L.at(page, 100, 660);
    const steps = await L.historySteps(page, () => L.drag(page, gx, gy, gx + 40, gy + 30));
    const b = await mixState(page);
    await L.key(page, 'Control+z');
    await L.wait(900);
    const c = await mixState(page);
    const { scale } = await L.pageBox(page);
    const movedAll = near((b.rects[0].x - a.rects[0].x) * scale, 40, 3) && near(b.callouts[0].x - a.callouts[0].x, 40, 3) && near(b.markers[0].x - a.markers[0].x, 40, 3);
    const backAll = c.rects[0].x === a.rects[0].x && c.callouts[0].x === a.callouts[0].x && c.markers[0].x === a.markers[0].x;
    const path = await L.shot(page, '55-after-undo');
    const ok = a.sel.length === 3 && a.sel.some((s) => s.startsWith('surveyMarker:')) && movedAll && backAll && steps.local + steps.legacy === 1;
    L.record(55, 'chromium-desktop', ok ? 'PASS' : 'FAIL', `box picked ${a.sel.map((s) => s.split(':')[0]).join('+')}; drag moved rect/callout/marker ${Math.round((b.rects[0].x - a.rects[0].x) * scale)}/${b.callouts[0].x - a.callouts[0].x}/${b.markers[0].x - a.markers[0].x} px; undo steps recorded ${steps.local + steps.legacy} (local ${steps.local}, snapshot ${steps.legacy}); one Ctrl+Z put all back: ${backAll}; ${path}`);
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  } finally { await env.browser.close(); }
});

// ------------------------------------------------------------------ 56
test('56 Survey Marker cut and paste keeps the item', async () => {
  const { env, page, errors } = await viewer(test, { survey: true });
  try {
    await L.placeMarker(page, 420, 690, 460, 720);
    await page.locator('.survey-rail__answers').first().getByRole('button', { name: 'Y', exact: true }).click();
    await L.wait(300);
    await page.evaluate(() => document.activeElement?.blur?.());
    const progress0 = (await L.surveyPanelText(page)).match(/(\d+)\/2/)?.[0];
    const m0 = (await L.surveyMarkers(page))[0];
    await L.key(page, 'Escape'); await L.tool(page, 'select');
    await L.click(page, m0.x, m0.y);
    const picked = (await L.selection(page)).some((s) => s.startsWith('surveyMarker:'));
    await L.key(page, 'Control+x');
    await L.wait(700);
    const afterCut = { onPage: (await L.surveyMarkers(page)).length, notOnPageTag: await page.locator('[data-testid="survey-marker-unplaced-tag"]').count(), tip: await page.locator('[data-testid="survey-marker-unplaced-tag"]').first().getAttribute('aria-label').catch(() => null), panel: await L.surveyPanelText(page) };
    const cutShot = await L.shot(page, '56-cut');
    await L.key(page, 'Control+v');
    await L.wait(900);
    const m1 = (await L.surveyMarkers(page))[0];
    const progress1 = (await L.surveyPanelText(page)).match(/(\d+)\/2/)?.[0];
    const tagAfter = await page.locator('[data-testid="survey-marker-unplaced-tag"]').count();
    const ok = picked && afterCut.onPage === 0 && afterCut.notOnPageTag === 1 && /Cameras 1/.test(afterCut.panel)
      && !!m1 && m1.id === m0.id && progress1 === progress0 && progress0 === '1/2' && tagAfter === 0;
    L.record(56, 'chromium-desktop', ok ? 'PASS' : 'FAIL', `cut: marker off page (${afterCut.onPage} on page), panel keeps the item, its Locate reads "${afterCut.tip}" (orange); paste: same id back ${m1?.id === m0.id}, answers ${progress0} -> ${progress1}; ${cutShot}`);
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  } finally { await env.browser.close(); }
});

// ------------------------------------------------------------------ 57
test('57 copy survey items to another space', async () => {
  const { env, page, errors } = await viewer(test);
  try {
    await page.getByRole('button', { name: 'Spaces' }).first().click();
    await L.wait(700);
    await (await L.firstVisible(page.getByRole('button', { name: 'Create space' }))).click();
    await L.wait(700);
    await page.evaluate(() => document.activeElement?.blur());
    const add = page.getByPlaceholder(/Add pages/).first();
    await add.fill('1'); await add.press('Enter'); await L.wait(500);
    await page.locator('.spaces-switch:not(.spaces-switch--s)[role=switch]').first().click();
    await L.wait(800);
    await L.enterSurvey(page);
    await L.placeMarker(page, 100, 690, 140, 720);
    await L.placeMarker(page, 200, 690, 240, 720, 'Doors');
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.locator('.survey-rail__cats-head button[aria-label="Select"]').click();
    await page.locator('.survey-rail__cats-head button[aria-label="Select all"]').click();
    await page.locator('.survey-rail__cats-head button[aria-label="Copy"]').click();
    await L.wait(600);
    const dialog = await page.evaluate(() => [...document.querySelectorAll('[role=dialog]')].map((d) => d.innerText.replace(/\s+/g, ' ').trim()).join(' | '));
    await page.locator('[role=dialog] button', { hasText: 'New Work' }).first().click();
    await L.wait(1200);
    const dialogOpen = await page.locator('[role=dialog]').count();
    const path = await L.shot(page, '57-copied');
    const counts = async (moduleName) => {
      await page.locator('.survey-rail button, .survey-rail [role=tab]').filter({ hasText: new RegExp(`^\\s*${moduleName}\\s*$`) }).first().click();
      await L.wait(600);
      const text = await L.surveyPanelText(page);
      return `${text.match(/Cameras (\d+)/)?.[1]}/${text.match(/Doors (\d+)/)?.[1]}`;
    };
    const source = await counts('Existing Survey Data');
    const target = await counts('New Work');
    const ok = errors.length === 0 && dialogOpen === 0 && source === '1/1' && target === '1/1';
    L.record(57, 'chromium-desktop', ok ? 'PASS' : 'FAIL', `picker "${dialog}"; after copy: page errors ${errors.length}, Cameras/Doors items in Existing Survey Data ${source}, in New Work ${target}; ${path}`);
    expect(ok).toBe(true);
  } finally { await env.browser.close(); }
});

// ------------------------------------------------------------------ 58
test('58 lock and unlock', async () => {
  const { env, page, errors } = await viewer(test);
  try {
    const menu = async (label) => {
      await page.locator('[data-annotation-context-menu] button, [data-annotation-context-menu] [role=menuitem]').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click();
      await L.wait(500);
    };
    await L.drawRect(page, 100, 660, 180, 720);
    const r0 = await last(page);
    const [ax, ay] = await L.at(page, 120, 660); // top edge, clear of the grabbers
    await L.click(page, ax, ay);
    await L.click(page, ax, ay, { button: 'right' });
    await menu('Lock');
    const badge = await page.locator('[data-selection-lock-badge]').count();
    const grabbers = (await L.handles(page)).length;
    const lockedShot = await L.shot(page, '58-locked');
    await L.drag(page, ax, ay, ax + 60, ay + 40);
    const afterDrag = await byId(page, r0.id);
    await L.click(page, ax, ay);
    await L.key(page, 'Delete');
    await L.key(page, 'Backspace');
    const afterDelete = await byId(page, r0.id);
    await L.tool(page, 'eraser');
    const [e0x, e0y] = await L.at(page, 90, 690);
    const [e1x, e1y] = await L.at(page, 190, 690);
    await L.drag(page, e0x, e0y, e1x, e1y, { steps: 16 });
    await L.wait(700);
    const afterErase = await byId(page, r0.id);
    await L.tool(page, 'select');
    await L.click(page, ax, ay);
    await L.click(page, ax, ay, { button: 'right' });
    await menu('Unlock');
    const badge2 = await page.locator('[data-selection-lock-badge]').count();
    const grabbers2 = (await L.handles(page)).length;
    await L.drag(page, ax, ay, ax + 60, ay + 40);
    const afterUnlockDrag = await byId(page, r0.id);
    const kept = (o) => !!o && o.left === r0.left && o.top === r0.top && o.w === r0.w && o.h === r0.h;
    const ok = badge === 1 && grabbers === 0 && kept(afterDrag) && kept(afterDelete) && kept(afterErase)
      && badge2 === 0 && grabbers2 === 8 && afterUnlockDrag.left !== r0.left;
    L.record(58, 'chromium-desktop', ok ? 'PASS' : 'FAIL', `locked: badge ${badge}, grabbers ${grabbers}; drag/delete/erase left it at ${afterErase?.left},${afterErase?.top} ${afterErase?.w}x${afterErase?.h} (was ${r0.left},${r0.top} ${r0.w}x${r0.h}); unlocked: badge ${badge2}, grabbers ${grabbers2}, drag moved it to ${afterUnlockDrag.left},${afterUnlockDrag.top}; ${lockedShot}`);
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  } finally { await env.browser.close(); }
});
