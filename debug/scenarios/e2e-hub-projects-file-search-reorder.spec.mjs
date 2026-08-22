import { test, expect } from '@playwright/test';

// Unique leftover after Hub Projects thin chrome (file Move/Copy / card
// reorder / Team write). Reachable hubPreview Projects chrome those slices
// never dedicated: file Search (`Search files...` — mobile drill only,
// NOT `Search projects...`) and file-row reorder (`reorderFiles` — NOT
// project card `reorderProjects`).
// Do not replay extras (Search/Pin/Duplicate/file Copy-Paste),
// catalog-completeness, Move/Copy, card reorder, Team write, Documents
// extras / Lock persist, Archive empty chrome, Templates, Spaces,
// Survey-rail, PDF waves. Leftover-18 parked.

const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';

const TOWER = 'Tower 5 — Security';
const LAB = 'Lab Reno — MEP';
const MEP = 'MEP Phase 2';
const SE011 = 'SE-011 Security Shop Drawings.pdf';
const RFI = 'RFI-014 Lobby Camera Coverage.pdf';
const DOOR = 'Door Hardware Schedule — A.601.pdf';
const MEP_FILE = 'MEP Coordination — Level 3.pdf';

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

async function openHub(page, { width = 1440, height = 900, url = HUB_PROJECTS } = {}) {
  await openPage(page, { width, height, url });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function visibleNames(locator) {
  return locator.evaluateAll((nodes) => (
    nodes
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 80)
  ));
}

function desktopLayout(page) {
  return page.locator('.projects-desktop-layout');
}

function projectRow(page, name) {
  const seedId = { [TOWER]: 'p1', [LAB]: 'p2', [MEP]: 'p3' }[name];
  if (seedId) return desktopLayout(page).locator(`[data-project-id="${seedId}"]`).first();
  return desktopLayout(page).locator('[data-project-id]').filter({ hasText: name }).first();
}

async function openProject(page, name) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.up().catch(() => {});
  await eatDragClick(page);
  const row = projectRow(page, name);
  await expect(row).toBeVisible({ timeout: 8_000 });
  // Click the name column, not the 28px handle — leftover file-row
  // pointer-up was starting a card drag instead of setOpenId.
  await row.click({ position: { x: 80, y: 24 } });
  await expect(desktopLayout(page).getByRole('textbox', { name: 'Click to rename' })).toHaveValue(name, { timeout: 8_000 });
}

function fileRow(page, name) {
  return desktopLayout(page).locator('[data-document-id]').filter({ hasText: name }).first();
}

async function desktopFileOrder(page) {
  return desktopLayout(page).locator('[data-document-id]').evaluateAll((rows) => (
    rows.map((row) => row.querySelector('div[style*="ellipsis"]')?.textContent?.trim() || row.textContent?.trim() || '')
  ));
}

function desktopFileHandles(page) {
  return desktopLayout(page).locator('[data-document-id] [title="Drag to rearrange"]');
}

async function pointerDragHandleTo(page, handle, dest, { cancel = false, self = false } = {}) {
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const fromBox = await handle.boundingBox();
  const toBox = await dest.boundingBox();
  expect(fromBox && toBox, 'drag geometry').toBeTruthy();
  const startX = fromBox.x + fromBox.width / 2;
  const startY = fromBox.y + fromBox.height / 2;
  const destX = toBox.x + Math.min(24, toBox.width / 2);
  const destY = toBox.y + toBox.height + 24;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Activate with a horizontal nudge so a self-drag never crosses the
  // next 42px file row. Vertical travel is only for a real drop / Escape.
  await page.mouse.move(startX + 8, startY, { steps: 8 });
  await expect(page.locator('body')).toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  if (!self) {
    await page.mouse.move(destX, destY, { steps: 30 });
  }
  if (cancel) {
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  }
  await page.mouse.up();
  await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
}

async function eatDragClick(page) {
  await page.mouse.click(12, 12).catch(() => {});
}

async function dragByHandle(page, handle, dest, _namesFn, { cancel = false, self = false } = {}) {
  await pointerDragHandleTo(page, handle, dest, { cancel, self });
  await eatDragClick(page);
  return 'pointer';
}

test('Projects file Search + file-row reorder intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  // Independent hunt: open hub tabs + testPdf chrome before proving the leftover.
  await openHub(page, { url: HUB_DOCS });
  const docsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });
  const projectsChrome = await visibleNames(page.locator('button, [role="menuitem"], input, [title="Drag to rearrange"]'));
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  const templatesChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  await page.locator('aside.side nav').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  const archiveEmpty = await page.getByText('Nothing in Archive').count();
  const archiveChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));

  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  const editorChrome = await visibleNames(page.locator('button, [role="tab"], input'));
  console.log('HUNT_INVENTORY', JSON.stringify({
    docsChrome: docsChrome.slice(0, 40),
    projectsChrome: projectsChrome.slice(0, 50),
    templatesChrome: templatesChrome.slice(0, 30),
    archiveChrome: archiveChrome.slice(0, 16),
    archiveEmpty,
    editorChrome: editorChrome.slice(0, 40),
  }));

  // Empty: no Search files, no file-row handles.
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No projects yet.').first()).toBeVisible({ timeout: 15_000 });
  const emptyFileSearch = await page.locator('input[placeholder="Search files..."]').count();
  const emptyFileHandles = await page.locator('[data-document-id] [title="Drag to rearrange"]').count();
  expect(emptyFileSearch, 'empty projects have no Search files').toBe(0);
  expect(emptyFileHandles, 'empty projects have no file-row handles').toBe(0);

  await openHub(page);
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });
  await openProject(page, TOWER);
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(fileRow(page, RFI)).toBeVisible();

  // Desktop chrome is project Search, not file Search. Do not invent a
  // desktop Search files field.
  const desktopFileSearch = await page.locator('.projects-desktop-search input[placeholder="Search files..."]').count();
  const desktopProjectSearch = await page.locator('.projects-desktop-search input[placeholder="Search projects..."]').count();
  expect(desktopFileSearch, 'desktop does not invent Search files').toBe(0);
  expect(desktopProjectSearch, 'desktop keeps Search projects').toBe(1);

  // File-row reorder — file handles, not project-card handles.
  const seHandle = fileRow(page, SE011).locator('[title="Drag to rearrange"]');
  const rfiHandle = fileRow(page, RFI).locator('[title="Drag to rearrange"]');
  await expect(seHandle).toBeVisible();
  await expect(rfiHandle).toBeVisible();
  const fileHandleCount = await desktopFileHandles(page).count();
  expect(fileHandleCount).toBe(2);
  const orderBefore = await desktopFileOrder(page);
  expect(orderBefore[0]).toContain('SE-011');
  expect(orderBefore[1]).toContain('RFI-014');

  const escapeMode = await dragByHandle(
    page,
    seHandle,
    fileRow(page, RFI),
    desktopFileOrder,
    { cancel: true },
  );
  await expect.poll(async () => (await desktopFileOrder(page))[0]).toContain('SE-011');
  await expect.poll(async () => page.evaluate(() => {
    const first = document.querySelector('.projects-desktop-layout [data-sortable-rearrange-item="d1"]');
    const second = document.querySelector('.projects-desktop-layout [data-sortable-rearrange-item="d3"]');
    if (!first || !second) return false;
    return first.getBoundingClientRect().top < second.getBoundingClientRect().top;
  })).toBe(true);

  const selfMode = await dragByHandle(
    page,
    seHandle,
    seHandle,
    desktopFileOrder,
    { self: true },
  );
  await expect.poll(async () => (await desktopFileOrder(page))[0]).toContain('SE-011');

  const moveMode = await dragByHandle(
    page,
    seHandle,
    fileRow(page, RFI),
    desktopFileOrder,
  );
  await expect.poll(async () => (await desktopFileOrder(page))[0]).toContain('RFI-014');
  const orderAfter = await desktopFileOrder(page);
  expect(orderAfter.join('|')).not.toBe(orderBefore.join('|'));
  expect(orderAfter.some((name) => name.includes('SE-011'))).toBeTruthy();
  expect(orderAfter.some((name) => name.includes('RFI-014'))).toBeTruthy();

  // Isolation: Lab / MEP file lists unchanged by Tower file reorder.
  await openProject(page, LAB);
  await expect(fileRow(page, DOOR)).toBeVisible();
  await expect(desktopLayout(page).getByText(SE011)).toHaveCount(0);
  await expect(desktopLayout(page).getByText(RFI)).toHaveCount(0);
  expect(await desktopFileHandles(page).count()).toBe(1);
  await openProject(page, MEP);
  await expect(fileRow(page, MEP_FILE)).toBeVisible();
  await expect(desktopLayout(page).getByText(RFI)).toHaveCount(0);

  // Session persist: switch back keeps Tower file order. Reload (no
  // workflowE2E) is session-only and restores the seed.
  await openProject(page, TOWER);
  await expect.poll(async () => (await desktopFileOrder(page))[0]).toContain('RFI-014');
  const sessionKept = (await desktopFileOrder(page))[0].includes('RFI-014');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await openProject(page, TOWER);
  const afterReload = await desktopFileOrder(page);
  expect(afterReload[0]).toContain('SE-011');
  const reloadResets = afterReload[0].includes('SE-011');

  // 390: Search files... is the drill placeholder (not Search projects).
  await openHub(page, { width: 390, height: 844 });
  const mobileRow = (id) => page.locator(`.projects-mobile-folder-row[data-project-id="${id}"]`);
  await expect(mobileRow('p1')).toBeVisible({ timeout: 15_000 });
  const listSearch = page.locator('.projects-mobile-search-actions input[placeholder="Search projects..."]');
  await expect(listSearch).toBeVisible();
  expect(await page.locator('input[placeholder="Search files..."]').count()).toBe(0);

  await mobileRow('p1').click();
  await expect(page.locator('.projects-mobile-back-button')).toBeVisible({ timeout: 8_000 });
  const fileSearch = page.locator('.projects-mobile-search-actions input[placeholder="Search files..."]');
  await expect(fileSearch).toBeVisible({ timeout: 8_000 });
  const mobileFile = (name) => page.locator('.projects-mobile-file-row').filter({ hasText: name });
  await expect(mobileFile(SE011)).toBeVisible();
  await expect(mobileFile(RFI)).toBeVisible();

  // Empty / whitespace query keeps both files.
  await fileSearch.fill('   ');
  await expect(mobileFile(SE011)).toBeVisible();
  await expect(mobileFile(RFI)).toBeVisible();

  // Match + case.
  await fileSearch.fill('rfi');
  await expect(mobileFile(RFI)).toBeVisible();
  await expect(mobileFile(SE011)).toHaveCount(0);
  await fileSearch.fill('SE-011');
  await expect(mobileFile(SE011)).toBeVisible();
  await expect(mobileFile(RFI)).toHaveCount(0);
  await fileSearch.fill('RFI');
  await expect(mobileFile(RFI)).toBeVisible();
  await expect(mobileFile(SE011)).toHaveCount(0);

  // No-match.
  await fileSearch.fill('xyzzy');
  await expect(page.getByText('No files match your search.')).toBeVisible();
  await expect(page.locator('.projects-mobile-file-row')).toHaveCount(0);

  // Escape blurs and keeps the query (same Search control as project Search).
  await fileSearch.focus();
  await page.keyboard.press('Escape');
  await expect(fileSearch).toHaveValue('xyzzy');
  await expect(page.getByText('No files match your search.')).toBeVisible();

  // Clear restores both files.
  await fileSearch.fill('');
  await expect(mobileFile(SE011)).toBeVisible();
  await expect(mobileFile(RFI)).toBeVisible();

  // Back clears fileSearch (session-only query).
  await page.locator('.projects-mobile-back-button').click();
  await expect(mobileRow('p1')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.projects-mobile-search-actions input[placeholder="Search projects..."]')).toBeVisible();
  await mobileRow('p1').click();
  await expect(fileSearch).toBeVisible({ timeout: 8_000 });
  await expect(fileSearch).toHaveValue('');
  await expect(mobileFile(SE011)).toBeVisible();
  await expect(mobileFile(RFI)).toBeVisible();

  // Isolation: Lab drill does not show Tower files; one-file project has
  // a handle but no sibling to swap with.
  await page.locator('.projects-mobile-back-button').click();
  await expect(mobileRow('p2')).toBeVisible();
  await mobileRow('p2').click();
  await expect(mobileFile(DOOR)).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.projects-mobile-file-row').filter({ hasText: SE011 })).toHaveCount(0);
  await expect(page.locator('.projects-mobile-file-row').filter({ hasText: RFI })).toHaveCount(0);
  const labHandles = await page.locator('.projects-mobile-file-row [title="Drag to rearrange"]').count();
  expect(labHandles).toBe(1);
  await fileSearch.fill('door');
  await expect(mobileFile(DOOR)).toBeVisible();
  await fileSearch.fill('xyzzy');
  await expect(page.getByText('No files match your search.')).toBeVisible();
  await fileSearch.fill('');

  // 390 Tower file-row reorder (handles are file rows, not folder cards).
  await page.locator('.projects-mobile-back-button').click();
  await expect(mobileRow('p1')).toBeVisible();
  await mobileRow('p1').click();
  await expect(mobileFile(SE011)).toBeVisible({ timeout: 8_000 });
  const mobileFileOrder = async () => page.locator('.projects-mobile-file-row').evaluateAll((rows) => (
    rows.map((row) => row.querySelector('.projects-mobile-file-copy div')?.textContent?.trim() || row.textContent?.trim() || '')
  ));
  const mobileOrderBefore = await mobileFileOrder();
  expect(mobileOrderBefore[0]).toContain('SE-011');
  const p1FileHandle = page.locator('.projects-mobile-file-row').filter({ hasText: SE011 }).locator('[title="Drag to rearrange"]');
  await pointerDragHandleTo(page, p1FileHandle, page.locator('.projects-mobile-file-row').filter({ hasText: RFI }));
  await page.mouse.click(12, 12).catch(() => {});
  const mobileOrderAfter = await mobileFileOrder();
  const mobileReordered = mobileOrderAfter.join('|') !== mobileOrderBefore.join('|');

  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();

  console.log('HUB_PROJECTS_FILE_SEARCH_REORDER_PROOF', JSON.stringify({
    emptyFileSearch,
    emptyFileHandles,
    desktopFileSearch,
    desktopProjectSearch,
    fileHandleCount,
    escapeMode,
    selfMode,
    moveMode,
    orderAfter,
    isolation: true,
    sessionKept,
    reloadResets,
    mobileMatch: true,
    mobileCase: true,
    mobileNoMatch: true,
    mobileEscapeKeeps: true,
    mobileClearRestores: true,
    mobileBackClears: true,
    labHandles,
    mobileReordered,
    noFileId: fileId === null,
  }));
});
