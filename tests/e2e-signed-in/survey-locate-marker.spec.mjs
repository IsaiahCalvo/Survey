// Locate on page (owner note 2026-10-26, item 28): "it doesn't automatically
// go to it every single time and center on it ... It should zoom properly to
// the extents of it as well, and it should do that on the first click."
// A 36-sheet drawing with Survey Markers on far-apart sheets: every first click
// on Locate lands the marker centred in the part of the viewer you can see
// (between the open panels) and zoomed so it fills a fair share of it.
// Owner 2026-11-09: "it should animate to that. It should pan and zoom to it.
// Those can zoom in, but not to that degree." So the move now plays over
// several frames (captured in slow motion), and the zoom stops well short of
// the old half-the-view / 800%.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';
import { SLOW, SLOW_TIME_SCRIPT } from './slowTime.mjs';

const FIXTURE = 'debug/fixtures/package2-rev4.pdf';

const MARKERS = [
  { id: 'm-p1-small', pageNumber: 1, name: 'Camera 1', bounds: { x: 420, y: 600, width: 24, height: 24 } },
  { id: 'm-p14-wide', pageNumber: 14, name: 'Camera 2', bounds: { x: 420, y: 150, width: 220, height: 70 } },
  { id: 'm-p30-mid', pageNumber: 30, name: 'Camera 3', bounds: { x: 600, y: 380, width: 60, height: 60 } },
  { id: 'm-p2-tall', pageNumber: 2, name: 'Camera 4', bounds: { x: 300, y: 200, width: 40, height: 300 } },
];

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const docId = randomUUID();
  const templateId = randomUUID();
  const templateName = `E2E Locate ${Date.now()}`;
  const docName = `E2E Locate ${Date.now()}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const template = await admin.from('templates').insert({
    id: templateId, user_id: ownerId, name: templateName, description: 'survey-locate-marker.spec',
    config: {
      modules: [{ id: 'm-sec', name: 'Security', categories: [{ id: 'c-cam', name: 'Camera', checklist: [] }] }],
      entities: [{ id: 'e-gc', name: 'GC', color: '#E53935' }],
    },
  });
  if (template.error) throw template.error;
  const doc = await admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName,
    file_path: filePath, file_size: bytes.length, page_count: 36,
  });
  if (doc.error) throw doc.error;
  const link = await admin.from('document_templates').insert({ document_id: docId, template_id: templateId, linked_by: ownerId });
  if (link.error) throw link.error;

  return { docId, docName, filePath, templateId, templateName };
}

// The markers go in through the app's own annotation-doc module, signed in as
// the owner (Node cannot load the app's ESM sources here).
function addMarkers(page, documentId) {
  const records = Object.fromEntries(MARKERS.map((m) => [m.id, {
    ...m, moduleId: 'm-sec', regionId: null, categoryId: 'c-cam', checklistResponses: {}, color: null,
  }]));
  return page.evaluate(async ({ docId, markers }) => {
    const sync = await import('/src/services/annotationDocSync.js');
    const { supabase } = await import('/src/supabaseClient.js');
    const { data } = await supabase.auth.getUser();
    const handle = await sync.openAnnotationDoc({
      documentId: docId, supabase, actorUserId: data.user.id, enableLocal: false, enableRealtime: false,
    });
    handle.applySurveyMarkers(markers);
    await handle.drain();
    handle.destroy();
  }, { docId: documentId, markers: records });
}

async function cleanup(admin, seeded) {
  await admin.from('documents').delete().eq('id', seeded.docId);
  await admin.storage.from('documents').remove([seeded.filePath]);
  await admin.from('templates').delete().eq('id', seeded.templateId);
}

// Where the marker is drawn, against the part of the viewer no panel covers.
function measure(page, markerId) {
  return page.evaluate((id) => {
    const scroller = document.querySelector('[data-touch-pdf-surface]');
    const group = document.querySelector(`[data-survey-marker-id="${id}"]`);
    const el = group?.querySelector(':scope > rect') || group;
    if (!scroller || !el) return null;
    const v = scroller.getBoundingClientRect();
    let left = v.left;
    let right = v.right;
    for (const node of document.querySelectorAll('[data-viewer-occluder="side"]')) {
      const r = node.getBoundingClientRect();
      if (!(r.width > 0) || r.bottom <= v.top || r.top >= v.bottom) continue;
      if (r.left <= v.left + 4 && r.right > left) left = Math.min(r.right, v.right);
      if (r.right >= v.right - 4 && r.left < right) right = Math.max(r.left, v.left);
    }
    // The tool bars over the top of the viewer.
    let top = v.top;
    for (const node of document.querySelectorAll('[data-viewer-occluder="bar"]')) {
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top <= top + 2 && r.bottom > top) top = Math.min(r.bottom, v.bottom);
    }
    const m = el.getBoundingClientRect();
    return {
      dx: m.left + m.width / 2 - (left + right) / 2,
      dy: m.top + m.height / 2 - (top + v.bottom) / 2,
      fillW: m.width / (right - left),
      fillH: m.height / (v.bottom - top),
    };
  }, markerId);
}

test('Locate on page centres and zooms to the marker on the first click, every time', async ({ page }) => {
  test.setTimeout(420_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  try {
    await page.addInitScript(SLOW_TIME_SCRIPT);
    await signIn(page, E2E_ACCOUNTS.owner);
    await addMarkers(page, seeded.docId);
    await page.getByText(seeded.docName, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    await page.getByText(seeded.templateName, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Show Survey Markers in Camera' }).click();
    const rows = page.locator('.survey-rail__marker-line');
    await expect(rows).toHaveCount(MARKERS.length, { timeout: 30_000 });

    const order = [0, 2, 1, 3, 0, 3, 2, 1];
    for (const [step, index] of order.entries()) {
      const marker = MARKERS[index];
      // The first pass over the four markers is captured in slow motion; the
      // second runs at full speed (and keeps the run short).
      const timeScale = step < 4 ? SLOW : 1;
      // The marker's name is its row's text field.
      const row = rows.filter({ has: page.locator(`input[value="${marker.name}"]`) });
      await page.waitForTimeout(1500);
      // Slow motion: record where the marker is drawn every frame of the move.
      await page.evaluate(({ s, id }) => {
        window.__setTimeScale(s);
        const frames = [];
        window.__locateFrames = frames;
        const tick = () => {
          if (window.__locateFrames !== frames) return;
          const group = document.querySelector(`[data-survey-marker-id="${id}"]`);
          const el = group?.querySelector(':scope > rect') || group;
          const r = el?.getBoundingClientRect();
          frames.push(r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } : null);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, { s: timeScale, id: marker.id });
      await row.getByRole('button', { name: 'Locate on page' }).click();
      await page.waitForTimeout(1200 / timeScale);
      const frames = await page.evaluate(() => {
        const out = window.__locateFrames || [];
        window.__locateFrames = null;
        window.__setTimeScale(1);
        return out;
      });
      const landed = await measure(page, marker.id);
      // Owner 2026-10-28: the grabbers must be one screen size once it lands
      // (they used to keep the old zoom for half a second, then snap).
      const grabber = await page.evaluate((id) => document
        .querySelector(`[data-survey-marker-chrome="${id}"] [data-resize-handle="br"]`)
        ?.getBoundingClientRect().width ?? null, marker.id);
      expect(grabber, `${marker.name} grabber shown`).not.toBeNull();
      expect(Math.abs(grabber - 11), `${marker.name} grabber ${grabber}px`).toBeLessThan(1);
      await page.waitForTimeout(700);
      const at = await measure(page, marker.id);
      console.log(`[locate] ${marker.name} p${marker.pageNumber}`, JSON.stringify(at));
      expect(at, `${marker.name} is drawn after Locate`).not.toBeNull();
      expect(landed, `${marker.name} is on screen once the move ends`).not.toBeNull();
      // Landed and stays: nothing pushes the page after (the survey bar used
      // to leave and come back while the pick changed hands).
      expect(Math.abs(at.dy - landed.dy), `${marker.name} does not move after landing`).toBeLessThan(1.5);
      expect(Math.abs(at.dx), `${marker.name} centred across`).toBeLessThan(6);
      expect(Math.abs(at.dy), `${marker.name} centred down`).toBeLessThan(6);
      const fill = Math.max(at.fillW, at.fillH);
      expect(fill, `${marker.name} zoomed toward it`).toBeGreaterThan(0.04);
      // Was half the view; now about a fifth (a tall marker can take more at
      // the page fit, since Locate never zooms out past fitting the sheet).
      expect(fill, `${marker.name} not blown up`).toBeLessThan(0.42);

      // The move: over several frames, never mostly in one frame (a marker
      // already on screen; a far sheet is reached by a jump to one screen
      // short of it first, by design).
      const drawn = frames.filter(Boolean);
      let moving = 0;
      let biggest = 0;
      let total = 0;
      for (let i = 1; i < drawn.length; i += 1) {
        const step = Math.hypot(drawn[i].x - drawn[i - 1].x, drawn[i].y - drawn[i - 1].y)
          + Math.abs(drawn[i].w - drawn[i - 1].w);
        if (step > 0.5) moving += 1;
        biggest = Math.max(biggest, step);
        total += step;
      }
      console.log(`[locate-frames] ${marker.name}`, JSON.stringify({ moving, biggest: Math.round(biggest), total: Math.round(total), frames: drawn.length }));
      if (timeScale < 1 && total > 40) {
        expect(moving, `${marker.name} animates`).toBeGreaterThanOrEqual(4);
      }
    }
  } finally {
    await cleanup(admin, seeded);
  }
});
