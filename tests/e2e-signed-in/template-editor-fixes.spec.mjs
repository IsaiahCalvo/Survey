// Isaiah's issue note 2026-10-26, templates batch:
//  - an open category's Select shows its actions IN the category's row (no
//    extra line), with Move; Move / Copy pick template -> module -> category;
//  - module tabs show what fits and a "+N" menu with the rest;
//  - dragging a module tab in the Survey panel reorders the template, and the
//    home Templates page shows the same order (and the other way round);
//  - a dragged module tab only moves (no stretch / squash).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_DOCUMENT, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, pickValue, signIn, test } from './helpers.mjs';

const MODULE_NAMES = ['Installation', 'Rough-in', 'Trim out', 'Punch list', 'Closeout', 'Testing', 'Commissioning', 'Warranty', 'Extra long module name here that runs well past the width of the Survey panel on any screen'];

test.describe.configure({ mode: 'serial' });

let seeded = null;

async function ownerId(admin) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
}

test.beforeAll(async () => {
  const admin = adminClient();
  const uid = await ownerId(admin);
  const stamp = Date.now();
  const templateId = randomUUID();
  const documentId = randomUUID();
  const documentName = `E2E Template Fixes ${stamp}.pdf`;
  const templateName = `Fixes Kit ${stamp % 100000}`;
  const bytes = fs.readFileSync(path.resolve(E2E_DOCUMENT.fixture));
  const filePath = `${uid}/${documentId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const doc = await admin.from('documents').insert({ id: documentId, user_id: uid, project_id: E2E_PROJECT.id, name: documentName, file_path: filePath, file_size: bytes.length, page_count: 1 });
  if (doc.error) throw doc.error;
  const modules = MODULE_NAMES.map((name, i) => ({
    id: `mod-${i}`,
    name,
    categories: [
      { id: `cat-${i}-door`, name: 'Door', checklist: [{ id: `cl-${i}-a`, text: 'Frame set' }] },
      { id: `cat-${i}-cam`, name: 'Camera', checklist: [{ id: `cl-${i}-b`, text: 'Mounted' }] },
    ],
  }));
  const tpl = await admin.from('templates').insert({ id: templateId, user_id: uid, name: templateName, config: { modules, entities: [] } });
  if (tpl.error) throw tpl.error;
  const link = await admin.from('document_templates').insert({ document_id: documentId, template_id: templateId, linked_by: uid });
  if (link.error) throw link.error;
  // A second template whose newest version added a category this document
  // has not taken (it kept the older version: see the last test).
  const otherTemplateId = randomUUID();
  const otherTemplateName = `Other Kit ${stamp % 100000}`;
  const other = await admin.from('templates').insert({ id: otherTemplateId, user_id: uid, name: otherTemplateName, config: { modules: [{ id: 'other-mod', name: 'Other module', categories: [
    { id: 'other-kept', name: 'Kept category', checklist: [{ id: 'other-cl-a', text: 'Checked' }] },
    { id: 'other-new', name: 'Newer category', checklist: [{ id: 'other-cl-b', text: 'Checked' }] },
  ] }], entities: [] } });
  if (other.error) throw other.error;
  seeded = { templateId, documentId, documentName, templateName, filePath, uid, otherTemplateId, otherTemplateName };
});

test.afterAll(async () => {
  if (!seeded) return;
  const admin = adminClient();
  await admin.from('document_templates').delete().eq('document_id', seeded.documentId);
  await admin.from('documents').delete().eq('id', seeded.documentId);
  await admin.storage.from('documents').remove([seeded.filePath]);
  await admin.from('templates').delete().eq('id', seeded.templateId);
  await admin.from('templates').delete().eq('id', seeded.otherTemplateId);
});

// Three markers, D-1..D-3, in Installation / Door (written the way the app
// writes them; realtime off).
async function seedMarkers(page) {
  await page.evaluate(async (docId) => {
    const sync = await import('/src/services/annotationDocSync.js');
    const { supabase } = await import('/src/supabaseClient.js');
    const { data } = await supabase.auth.getUser();
    const handle = await sync.openAnnotationDoc({ documentId: docId, supabase, actorUserId: data.user.id, enableLocal: false, enableRealtime: false });
    // The whole set: any marker an earlier test made is removed.
    const next = {};
    ['D-1', 'D-2', 'D-3'].forEach((name, i) => {
      const id = `surveyMarker-fix-${i}`;
      next[id] = { id, userId: data.user.id, pageNumber: 1, bounds: { x: 100 + i * 120, y: 500, width: 80, height: 40 }, moduleId: 'mod-0', regionId: null, categoryId: 'cat-0-door', name, checklistResponses: {}, color: null };
    });
    handle.applySurveyMarkers(next);
    await handle.drain();
    handle.destroy();
  }, seeded.documentId);
}

async function readMarkers(page) {
  return page.evaluate(async (docId) => {
    const sync = await import('/src/services/annotationDocSync.js');
    const { supabase } = await import('/src/supabaseClient.js');
    const { data } = await supabase.auth.getUser();
    const handle = await sync.openAnnotationDoc({ documentId: docId, supabase, actorUserId: data.user.id, enableLocal: false, enableRealtime: false });
    const markers = handle.getSurveyMarkers();
    handle.destroy();
    return markers;
  }, seeded.documentId);
}

async function openTemplates(page) {
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  // A document tab left open behind Home keeps its Survey rail mounted (hidden,
  // #1215), and that rail names the template too: click the visible one.
  await page.getByText(seeded.templateName, { exact: true }).filter({ visible: true }).first().click();
}

async function openSurvey(page) {
  await page.getByRole('button', { name: /Documents/ }).filter({ visible: true }).first().click().catch(() => {});
  await page.getByText(seeded.documentName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByRole('button', { name: `Close ${seeded.documentName}` })).toBeVisible({ timeout: 60_000 });
  const tabs = moduleTabs(page);
  if (!(await tabs.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    const chooser = page.getByText('Choose a survey template', { exact: true });
    await expect(chooser.or(tabs).first()).toBeVisible({ timeout: 30_000 });
    if (await chooser.isVisible()) await page.getByText(seeded.templateName, { exact: true }).last().click();
  }
  await expect(tabs).toBeVisible({ timeout: 30_000 });
}

const moduleTabs = (page) => page.getByRole('tablist', { name: 'Modules' }).filter({ visible: true }).first();

async function dragBetween(page, from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  const steps = 14;
  for (let k = 1; k <= steps; k += 1) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x + 4) - (a.x + a.width / 2)) * (k / steps), a.y + a.height / 2);
  }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, E2E_ACCOUNTS.owner);
});

test('Select sits in the category row; Move picks template, module, category; Undo takes it back', async ({ page }) => {
  await seedMarkers(page);
  await openSurvey(page);
  await page.getByRole('button', { name: 'Show Survey Markers in Door' }).click();
  await page.getByRole('button', { name: 'Select Survey Markers in Door' }).click();
  const row = page.locator('[data-survey-category-id="cat-0-door"] .survey-marker-category-row');
  const toolbar = row.getByRole('toolbar', { name: 'Item selection actions' });
  await expect(toolbar).toBeVisible();
  // No extra line under the category any more.
  await expect(page.locator('.survey-marker-inline-select-row')).toHaveCount(0);
  await toolbar.getByRole('button', { name: 'Select all' }).click();
  await toolbar.getByRole('button', { name: 'Move' }).click();

  const dialog = page.getByRole('dialog', { name: 'Move 3 Survey Markers' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Template', exact: true })).toHaveAttribute('data-value', seeded.templateId);
  await expect(dialog.getByRole('button', { name: 'Module', exact: true })).toHaveAttribute('data-value', 'mod-0');
  await expect(dialog.getByRole('button', { name: 'Category', exact: true })).toHaveAttribute('data-value', 'cat-0-cam');
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const counts = async () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-survey-category-id]')]
    .map((el) => [el.getAttribute('data-survey-category-id'), el.querySelector('.survey-marker-category-main-count')?.textContent?.trim()])));
  await expect.poll(counts).toEqual({ 'cat-0-door': '0', 'cat-0-cam': '3' });
  await expect.poll(async () => Object.values(await readMarkers(page)).map((m) => m.categoryId).sort().join(','), { timeout: 20_000 })
    .toBe('cat-0-cam,cat-0-cam,cat-0-cam');
  const before = await readMarkers(page);
  expect(before['surveyMarker-fix-0'].name).toBe('D-1');

  await page.keyboard.press('Control+z');
  await expect.poll(counts).toEqual({ 'cat-0-door': '3', 'cat-0-cam': '0' });
});

test('Copy to… puts a copy in another module and category, with the same name', async ({ page }) => {
  await seedMarkers(page);
  await openSurvey(page);
  await page.getByRole('button', { name: 'Show Survey Markers in Door' }).click();
  await page.locator('#highlight-item-surveyMarker-fix-0').click({ button: 'right', position: { x: 12, y: 10 } });
  await page.getByRole('menuitem', { name: 'Copy to…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy 1 Survey Marker' });
  await pickValue(page, dialog, 'Module', 'Trim out');
  await pickValue(page, dialog, 'Category', 'Door');
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  // The panel shows where the copy went.
  await expect(moduleTabs(page).getByRole('tab', { name: 'Trim out' })).toHaveAttribute('aria-selected', 'true');
  // ...with its category open.
  await expect(page.locator('[data-survey-category-id="cat-2-door"] [id^="highlight-item-"]')).toHaveCount(1);
  await expect.poll(async () => {
    const markers = Object.values(await readMarkers(page));
    return markers.filter((m) => m.moduleId === 'mod-2' && m.categoryId === 'cat-2-door' && m.name === 'D-1').length;
  }, { timeout: 20_000 }).toBe(1);
  const markers = await readMarkers(page);
  expect(markers['surveyMarker-fix-0'].moduleId).toBe('mod-0');
});

test('module tabs: what fits, then +N; drag reorders the template on both screens', async ({ page }) => {
  await openSurvey(page);
  const tabs = moduleTabs(page);
  const more = page.getByRole('button', { name: /^\d+ more modules?$/ });
  await expect(more).toBeVisible();
  await more.click();
  await page.getByRole('menuitem', { name: 'Warranty' }).click();
  await expect(tabs.getByRole('tab', { name: 'Warranty' })).toHaveAttribute('aria-selected', 'true');

  // A name wider than the panel shrinks (ellipsis): "+N" stays in the row.
  await more.click();
  await page.getByRole('menuitem', { name: /^Extra long module name/ }).click();
  await expect(tabs.getByRole('tab', { name: /^Extra long module name/ })).toHaveAttribute('aria-selected', 'true');
  const rowBox = await tabs.boundingBox();
  const moreBox = await more.boundingBox();
  expect(moreBox.x + moreBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
  if (await tabs.getByRole('tab', { name: 'Installation' }).count() === 0) {
    await more.click();
    await page.getByRole('menuitem', { name: 'Installation' }).click();
  }

  await tabs.getByRole('tab', { name: 'Installation' }).click();
  await dragBetween(page, tabs.getByRole('tab', { name: 'Rough-in' }), tabs.getByRole('tab', { name: 'Installation' }));
  await page.mouse.up();
  await expect.poll(async () => (await tabs.getByRole('tab').allInnerTexts()).slice(0, 2)).toEqual(['Rough-in', 'Installation']);
  const admin = adminClient();
  await expect.poll(async () => {
    const { data } = await admin.from('templates').select('config').eq('id', seeded.templateId).single();
    return data.config.modules.map((m) => m.name).slice(0, 2);
  }, { timeout: 20_000 }).toEqual(['Rough-in', 'Installation']);

  // The home Templates page shows the same order without a reload.
  await page.getByText('Home', { exact: true }).first().click();
  await openTemplates(page);
  const editorTabs = page.locator('[data-module-tab-list]').filter({ visible: true }).first();
  await expect.poll(async () => editorTabs.locator('[data-module-tab-id]').evaluateAll((els) => els.slice(0, 2).map((el) => el.textContent.replace(/\d+$/, '').trim())))
    .toEqual(['Rough-in', 'Installation']);
  await expect(page.getByRole('button', { name: /^\d+ more modules?$/ }).filter({ visible: true })).toBeVisible();

  // A dragged editor tab only moves: no scale in its transform.
  await dragBetween(page, editorTabs.locator('[data-module-tab-id="mod-2"]'), editorTabs.locator('[data-module-tab-id="mod-1"]'));
  const transforms = await editorTabs.locator('[data-module-tab-id]').evaluateAll((els) => els.map((el) => el.style.transform).filter(Boolean));
  expect(transforms.length).toBeGreaterThan(0);
  for (const transform of transforms) expect(transform).not.toMatch(/scale/);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first().click();
  await expect.poll(async () => {
    const { data } = await admin.from('templates').select('config').eq('id', seeded.templateId).single();
    return data.config.modules.map((m) => m.name).slice(0, 3);
  }, { timeout: 20_000 }).toEqual(['Trim out', 'Rough-in', 'Installation']);

  // Back in the open document the Survey panel follows, with no "template
  // changed" question.
  await page.getByText(seeded.documentName.slice(0, 24)).first().click();
  await expect.poll(async () => (await moduleTabs(page).getByRole('tab').allInnerTexts()).slice(0, 2)).toEqual(['Trim out', 'Rough-in']);
  await expect(page.getByRole('button', { name: 'Keep previous version' })).toHaveCount(0);
});

test('Move to another template lists the version this document kept, and opens it', async ({ page }) => {
  // This document already used "Other Kit" before its "Newer category" was
  // added, and chose to keep that version.
  await page.evaluate(({ uid, documentId, templateId, name }) => {
    const snapshot = { id: templateId, name, modules: [{ id: 'other-mod', name: 'Other module', categories: [
      { id: 'other-kept', name: 'Kept category', checklist: [{ id: 'other-cl-a', text: 'Checked' }] },
    ] }], entities: [] };
    localStorage.setItem(`survey:templateBinding:${uid}:${documentId}:${templateId}`, JSON.stringify({ used: true, snapshot, fingerprint: 'kept', reviewedFingerprint: null }));
  }, { uid: seeded.uid, documentId: seeded.documentId, templateId: seeded.otherTemplateId, name: seeded.otherTemplateName });
  await seedMarkers(page);
  await openSurvey(page);
  // The test before reordered the modules: the markers are in Installation.
  await moduleTabs(page).getByRole('tab', { name: 'Installation' }).click();
  await page.getByRole('button', { name: 'Show Survey Markers in Door' }).click();
  await page.locator('#highlight-item-surveyMarker-fix-0').click({ button: 'right', position: { x: 12, y: 10 } });
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move 1 Survey Marker' });
  await pickValue(page, dialog, 'Template', seeded.otherTemplateName);
  await dialog.getByRole('button', { name: 'Category', exact: true }).click();
  const categories = await page.getByRole('listbox', { name: 'Category' }).getByRole('option').allInnerTexts();
  expect(categories).toEqual(['Kept category']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Category' })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // The kept version opens straight away (no "keep or use latest" question),
  // with the marker in its category.
  await expect(page.getByRole('button', { name: 'Keep previous version' })).toHaveCount(0);
  await expect(page.locator('[data-survey-category-id="other-kept"] [id^="highlight-item-"]')).toHaveCount(1);
  await expect(page.locator('[data-survey-category-id="other-new"]')).toHaveCount(0);
  await expect.poll(async () => {
    const marker = (await readMarkers(page))['surveyMarker-fix-0'];
    return `${marker.moduleId}/${marker.categoryId}`;
  }, { timeout: 20_000 }).toBe('other-mod/other-kept');
});
