// Every mark's hover outline traces the ink that is drawn (owner 2026-11-12:
// a callout's blue hover outline followed a leader with its knee somewhere
// else than the drawn one). One mark of each kind is drawn on a blank sheet,
// then for each one the spec captures the frame without the outline and the
// frame with the pointer resting on the mark, and compares the two pixel by
// pixel:
//   - the outline is the pixels that changed; every one of them must sit
//     within a few pixels of the ink (no outline off on its own);
//   - every ink pixel must be near the outline or inside it (no ink left
//     without an outline, e.g. a leader the outline skipped).
// It also checks a picked callout shows only Drawboard's grabbers: the arrow
// tip, the knee and its text box's resize grabbers (the attach and mid-line
// grabbers of 2026-10-26 were taken back). Runs at desktop, tablet and phone
// widths with a mouse.
import { PNG } from 'pngjs';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const LAYOUTS = [
  { name: 'desktop', viewport: { width: 1400, height: 900 } },
  { name: 'tablet', viewport: { width: 1024, height: 1366 } },
  { name: 'phone', viewport: { width: 430, height: 932 } },
];

// How far (screen px) an outline pixel may sit from the ink, and an ink pixel
// from the outline. Outlines are the ink's width plus about 4 px.
const NEAR = 8;

async function open(page, label) {
  const sheet = await seedSheet(label);
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  // A phone opens the file from its row; wider layouts show Open file first.
  const openFile = page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
  await openFile.waitFor({ timeout: 3_000 }).then(() => openFile.click()).catch(() => {});
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  // Only marks on a white page: the sheet's own drawing (its title) and any
  // page-tile repaint can never pass for ink or outline.
  await page.addStyleTag({
    content: '.survey-pdfjs-page-div canvas, .survey-pdfjs-page-div .textLayer { visibility: hidden !important; }',
  });
  return { sheet, pageDiv };
}

const toolButton = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();

async function drag(page, points) {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i += 1) {
    await page.mouse.move(points[i].x, points[i].y, { steps: 6 });
  }
  await page.mouse.up();
}

const markCount = (page) => page.evaluate(() => {
  const layer = document.querySelector('[data-overlay-page="1"] [data-svg-annotation-layer]')
    || document.querySelector('[data-svg-annotation-layer="1"]');
  if (!layer) return 0;
  const ids = new Set();
  layer.querySelectorAll('[data-annotation-id], [data-callout-id]').forEach((n) => {
    ids.add(n.getAttribute('data-annotation-id') || `c:${n.getAttribute('data-callout-id')}`);
  });
  return ids.size;
});

// Nothing hovered, nothing picked, no editor focused: the pointer rests on a
// blank strip of the page no mark is drawn on.
let restPoint = { x: 2, y: 2 };
async function rest(page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.mouse.move(restPoint.x, restPoint.y);
  await page.waitForTimeout(250);
}

async function capture(page, clip) {
  // Two frames in a row must agree before one counts, so a repaint mid-shot
  // never reads as an outline.
  let prev = null;
  for (let i = 0; i < 6; i += 1) {
    const buf = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
    if (prev && buf.equals(prev)) return PNG.sync.read(buf);
    prev = buf;
    await page.waitForTimeout(120);
  }
  return PNG.sync.read(prev);
}

// Pixels within `r` (8-neighbour steps) of any set pixel.
function grow(mask, w, h, r) {
  let cur = mask.slice();
  for (let k = 0; k < r; k += 1) {
    const next = cur.slice();
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (cur[y * w + x]) continue;
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy += 1) {
          for (let dx = -1; dx <= 1 && !hit; dx += 1) {
            const nx = x + dx; const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && cur[ny * w + nx]) hit = true;
          }
        }
        if (hit) next[y * w + x] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

// Pixels the outline closes in: not reachable from the clip's border without
// crossing the outline.
function enclosedBy(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (seen[i] || mask[i]) return;
    seen[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x += 1) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += 1) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w; const y = (i - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) if (!seen[i] && !mask[i]) inside[i] = 1;
  return inside;
}

function compare(plain, hovered) {
  const { width: w, height: h } = plain;
  const ink = new Uint8Array(w * h);
  const halo = new Uint8Array(w * h);
  const faint = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    const [r, g, b] = [plain.data[o], plain.data[o + 1], plain.data[o + 2]];
    // Ink: clearly not the white page. Faint ink (a label pill's light
    // border) still counts as something an outline may hug.
    const strength = 255 * 3 - (r + g + b);
    if (strength > 90) ink[i] = 1;
    if (strength > 20) faint[i] = 1;
    const d = Math.abs(r - hovered.data[o]) + Math.abs(g - hovered.data[o + 1]) + Math.abs(b - hovered.data[o + 2]);
    if (d > 40) halo[i] = 1;
  }
  const nearInk = grow(faint, w, h, NEAR);
  const haloZone = grow(halo, w, h, 2);
  const nearHalo = grow(halo, w, h, NEAR);
  const inside = enclosedBy(haloZone, w, h);
  let haloCount = 0; let strayHalo = 0; let inkCount = 0; let bareInk = 0;
  const stray = []; const bare = [];
  for (let i = 0; i < w * h; i += 1) {
    if (halo[i]) {
      haloCount += 1;
      if (!nearInk[i]) { strayHalo += 1; if (stray.length < 5) stray.push([i % w, Math.floor(i / w)]); }
    }
    if (ink[i]) {
      inkCount += 1;
      if (!nearHalo[i] && !inside[i]) { bareInk += 1; if (bare.length < 5) bare.push([i % w, Math.floor(i / w)]); }
    }
  }
  return { inkCount, haloCount, strayHalo, bareInk, stray, bare };
}

// The solid ink pixel nearest the clip's middle (a hollow shape's border, a
// line's stroke; never a faint anti-aliased edge) - where the pointer rests to
// hover the mark.
function inkPoint(png) {
  const { width: w, height: h } = png;
  const strength = (x, y) => {
    const o = (y * w + x) * 4;
    return 255 * 3 - (png.data[o] + png.data[o + 1] + png.data[o + 2]);
  };
  let max = 0;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) max = Math.max(max, strength(x, y));
  if (max <= 90) return null;
  let best = null;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      // Solid: near the strongest ink, and so is a neighbour along the stroke.
      if (strength(x, y) < max * 0.7) continue;
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => strength(x + dx, y + dy) >= max * 0.7)) continue;
      const d = Math.hypot(x - w / 2, y - h / 2);
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  return best;
}

for (const layout of LAYOUTS) {
  test(`${layout.name}: every mark's hover outline traces its ink; a picked callout has only tip, knee and box grabbers`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(layout.viewport);
    const { sheet, pageDiv } = await open(page, `hover-outline-${layout.name}`);
    try {
      const box = await pageDiv.boundingBox();
      const vp = page.viewportSize();
      // The page's part that is on screen: cells are laid out inside it.
      const left = Math.max(box.x, 0) + 8;
      const top = Math.max(box.y, 0) + 70;
      const right = Math.min(box.x + box.width, vp.width) - 8;
      const bottom = Math.min(box.y + box.height, vp.height) - 60;
      restPoint = { x: left + 4, y: top - 30 };
      const cols = 3; const rows = 5;
      const cw = (right - left) / cols; const ch = (bottom - top) / rows;
      // A mark with `wide` takes a whole row (a measurement's label is a
      // fixed screen size and outgrows a phone's narrow cell).
      const cell = (n) => {
        const c = n % cols; const r = Math.floor(n / cols);
        const span = marks[n].wide ? cols - c : 1;
        const x0 = left + c * cw; const y0 = top + r * ch;
        const at = (fx, fy) => ({ x: x0 + cw * span * fx, y: y0 + ch * fy });
        return { at, clip: { x: Math.round(x0), y: Math.round(y0), width: Math.floor(cw * span), height: Math.floor(ch) } };
      };

      const marks = [
        { kind: 'pen', key: 'p', draw: (at) => drag(page, [at(0.2, 0.6), at(0.4, 0.3), at(0.6, 0.7), at(0.8, 0.35)]) },
        { kind: 'highlighter', key: 'h', draw: (at) => drag(page, [at(0.2, 0.5), at(0.5, 0.45), at(0.8, 0.55)]) },
        { kind: 'rectangle', key: 'r', draw: (at) => drag(page, [at(0.2, 0.25), at(0.8, 0.75)]) },
        { kind: 'ellipse', key: 'o', draw: (at) => drag(page, [at(0.2, 0.25), at(0.8, 0.75)]) },
        { kind: 'line', key: 'l', draw: (at) => drag(page, [at(0.2, 0.75), at(0.8, 0.25)]) },
        { kind: 'arrow', key: 'a', draw: (at) => drag(page, [at(0.2, 0.3), at(0.8, 0.7)]) },
        {
          kind: 'polygon', key: 'g', draw: async (at) => {
            for (const [fx, fy] of [[0.25, 0.75], [0.5, 0.25], [0.78, 0.7]]) {
              const p = at(fx, fy); await page.mouse.click(p.x, p.y); await page.waitForTimeout(120);
            }
            await page.keyboard.press('Enter');
          },
        },
        {
          kind: 'polyline', key: 'k', draw: async (at) => {
            for (const [fx, fy] of [[0.2, 0.7], [0.45, 0.3], [0.65, 0.65], [0.82, 0.3]]) {
              const p = at(fx, fy); await page.mouse.click(p.x, p.y); await page.waitForTimeout(120);
            }
            await page.keyboard.press('Enter');
          },
        },
        { kind: 'counter', key: 'c', draw: async (at) => { const p = at(0.5, 0.5); await page.mouse.click(p.x, p.y); } },
        {
          kind: 'text', key: 't', draw: async (at) => {
            const p = at(0.2, 0.4); await page.mouse.click(p.x, p.y);
            await page.keyboard.type('Door 12');
            await page.keyboard.press('Escape');
          },
        },
        {
          kind: 'cloud', key: null, draw: async (at) => {
            await toolButton(page, 'Shapes').click();
            await toolButton(page, 'Cloud').click();
            await drag(page, [at(0.2, 0.25), at(0.8, 0.75)]);
          },
        },
        {
          // Tip top-left, box bottom-right; then the knee is dragged up so
          // the leader bends well away from a straight tip-to-box line.
          kind: 'callout', key: 'q', draw: async (at) => {
            await drag(page, [at(0.1, 0.12), at(0.28, 0.62)]);
            await expect.poll(() => page.evaluate(() => document.activeElement?.isContentEditable === true)).toBe(true);
            await page.keyboard.type('jbjjk');
            await page.keyboard.press('Escape');
          },
        },
        {
          kind: 'length', key: null, wide: true, draw: async (at) => {
            await toolButton(page, 'Shapes').click();
            await page.locator('[data-measure-tool="menu"]').filter({ visible: true }).first().click();
            await page.locator('[data-measure-tool="length"]').filter({ visible: true }).first().click();
            await drag(page, [at(0.15, 0.6), at(0.85, 0.6)]);
          },
          // On its line, not its label.
          hoverAt: [0.5, 0.6],
        },
      ];

      for (let n = 0; n < marks.length; n += 1) {
        const m = marks[n];
        const { at } = cell(n);
        await rest(page);
        const before = await markCount(page);
        if (m.key) await page.keyboard.press(m.key);
        await m.draw(at);
        await expect.poll(() => markCount(page), { message: `${m.kind} drawn` }).toBeGreaterThan(before);
        await page.keyboard.press('Escape');
      }

      // Bend the callout's leader: pick it, drag its knee well off the line.
      await rest(page);
      await page.keyboard.press('v');
      const calloutCell = cell(marks.findIndex((m) => m.kind === 'callout'));
      const words = page.locator('[data-svg-annotation-layer="1"] foreignObject').filter({ hasText: 'jbjjk' }).last();
      const wb = await words.boundingBox();
      await page.mouse.click(wb.x + wb.width / 2, wb.y + wb.height / 2);
      const overlay = page.locator('[data-callout-handle-overlay="true"]').filter({ visible: true }).first();
      await expect(overlay.locator('[data-callout-part="knee"]')).toHaveCount(1);
      // Drawboard's set only.
      await expect(overlay.locator('[data-callout-leader-grabber]')).toHaveCount(0);
      for (const part of ['attach', 'segTip', 'segBox']) {
        await expect(overlay.locator(`[data-callout-part="${part}"]`)).toHaveCount(0);
      }
      const knee = await overlay.locator('[data-callout-part="knee"]').boundingBox();
      const kneeAt = { x: knee.x + knee.width / 2, y: knee.y + knee.height / 2 };
      const kneeTo = calloutCell.at(0.7, 0.2);
      await page.mouse.move(kneeAt.x, kneeAt.y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i += 1) {
        await page.mouse.move(kneeAt.x + ((kneeTo.x - kneeAt.x) * i) / 12, kneeAt.y + ((kneeTo.y - kneeAt.y) * i) / 12);
        await page.waitForTimeout(20);
      }
      await page.mouse.up();
      await page.waitForTimeout(400);

      const failures = [];
      for (let n = 0; n < marks.length; n += 1) {
        const { clip } = cell(n);
        await rest(page);
        const plain = await capture(page, clip);
        const p = marks[n].hoverAt
          ? { x: Math.round(clip.width * marks[n].hoverAt[0]), y: Math.round(clip.height * marks[n].hoverAt[1]) }
          : inkPoint(plain);
        expect(p, `${marks[n].kind}: ink in its cell`).not.toBeNull();
        await page.mouse.move(clip.x + p.x, clip.y + p.y, { steps: 3 });
        await page.waitForTimeout(300);
        const hovered = await capture(page, clip);
        const r = compare(plain, hovered);
        // HOVER_OUTLINE_DUMP=<folder> keeps both frames of every mark.
        if (process.env.HOVER_OUTLINE_DUMP) {
          const fs = await import('node:fs');
          fs.mkdirSync(process.env.HOVER_OUTLINE_DUMP, { recursive: true });
          fs.writeFileSync(`${process.env.HOVER_OUTLINE_DUMP}/${layout.name}-${marks[n].kind}-plain.png`, PNG.sync.write(plain));
          fs.writeFileSync(`${process.env.HOVER_OUTLINE_DUMP}/${layout.name}-${marks[n].kind}-hover.png`, PNG.sync.write(hovered));
        }
        const ok = r.haloCount > 40 && r.strayHalo <= Math.max(6, r.haloCount * 0.005) && r.bareInk <= Math.max(6, r.inkCount * 0.01);
        if (!ok) failures.push(`${marks[n].kind}: ${JSON.stringify(r)}`);
      }
      expect(failures, failures.join('\n')).toEqual([]);
    } finally {
      await sheet.remove();
    }
  });
}
