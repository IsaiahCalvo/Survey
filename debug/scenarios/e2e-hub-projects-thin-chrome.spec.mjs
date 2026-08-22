import { test, expect } from '@playwright/test';

// Unique leftover after Hub Projects extras (Search / Pin / Duplicate /
// file More Copy-Paste). Reachable hubPreview Projects chrome those slices
// never dedicated: file Select Move/Copy (NOT Templates category stub,
// NOT file More clipboard), project card reorder, Team modal write.
// Catalog-completeness only opened Manage team + Esc. Team writes hit
// projectInviteService / Supabase — prove fail-closed, do not invent.
// Do not replay Documents extras / Lock persist / Templates / Spaces /
// survey-rail / PDF waves. Leftover-18 parked.

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

function fileRow(page, name) {
  return desktopLayout(page).locator('[data-document-id]').filter({ hasText: name }).first();
}

function filesHeader(page) {
  return desktopLayout(page).locator('span', { hasText: /^Files$/ }).locator('xpath=following-sibling::div[1]');
}

async function projectOrder(page) {
  return desktopLayout(page).locator('[data-project-id]').evaluateAll((rows) => (
    rows.map((row) => row.querySelector('div[style*="font-weight: 600"]')?.textContent?.trim() || row.textContent?.trim() || '')
  ));
}

const TEAM_WRITE_FAIL = /Must be signed in|Could not create invite|Could not update role|Sent 0|First failure|not signed in|JWT|row-level|permission|Failed|uuid|syntax|fetch|network/i;

async function pointerDragHandleTo(page, handle, dest, { cancel = false } = {}) {
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const fromBox = await handle.boundingBox();
  const toBox = await dest.boundingBox();
  expect(fromBox && toBox, 'drag geometry').toBeTruthy();
  const startX = fromBox.x + fromBox.width / 2;
  const startY = fromBox.y + fromBox.height / 2;
  const destX = toBox.x + Math.min(24, toBox.width / 2);
  const destY = toBox.y > startY ? toBox.y + toBox.height + 8 : toBox.y + 8;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 12, { steps: 8 });
  await expect(page.locator('body')).toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  await page.mouse.move(destX, destY, { steps: 28 });
  if (cancel) {
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  }
  await page.mouse.up();
  await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
}

async function keyboardMoveHandle(page, handle, { direction = 'down', cancel = false } = {}) {
  await expect(handle).toBeVisible({ timeout: 8_000 });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  await page.keyboard.press(direction === 'up' ? 'ArrowUp' : 'ArrowDown');
  if (cancel) {
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
    return 'keyboard';
  }
  await page.keyboard.press('Space');
  await expect(page.locator('body')).not.toHaveClass(/drag-rearrange-dragging/, { timeout: 4_000 });
  return 'keyboard';
}

async function dragByHandle(page, handle, dest, namesFn, { cancel = false, direction = 'down' } = {}) {
  const before = await namesFn(page);
  try {
    await keyboardMoveHandle(page, handle, { direction, cancel });
    const after = await namesFn(page);
    const changed = JSON.stringify(after) !== JSON.stringify(before);
    if (cancel || changed) return 'keyboard';
  } catch { /* pointer fallback */ }
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.up().catch(() => {});
  await pointerDragHandleTo(page, handle, dest, { cancel });
  return 'pointer';
}

test('Projects file Move/Copy + card reorder + Team write fail-closed', async ({ page }) => {
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

  // Empty: no Move/Copy, no card handles, no Manage team.
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No projects yet.').first()).toBeVisible({ timeout: 15_000 });
  const emptyMove = await desktopLayout(page).getByRole('button', { name: 'Move/Copy', exact: true }).count();
  const emptyHandles = await desktopLayout(page).locator('[title="Drag to rearrange"]').count();
  const emptyTeam = await desktopLayout(page).getByRole('button', { name: 'Manage team', exact: true }).count();
  expect(emptyMove, 'empty projects have no Move/Copy').toBe(0);
  expect(emptyHandles, 'empty projects have no card handles').toBe(0);
  expect(emptyTeam, 'empty projects have no Manage team').toBe(0);

  await openHub(page);
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });
  await projectRow(page, TOWER).click();
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(fileRow(page, RFI)).toBeVisible();

  // File Select Move/Copy — the Files-header Select, not project-list Select.
  const fileSelect = filesHeader(page).getByRole('button', { name: 'Select', exact: true });
  await fileSelect.click();
  const moveCopy = filesHeader(page).getByRole('button', { name: 'Move/Copy', exact: true });
  await expect(moveCopy).toBeDisabled();
  await fileRow(page, SE011).click();
  await expect(moveCopy).toBeEnabled();

  // Cancel vs persist: pick dest then Cancel leaves Tower files unchanged.
  await moveCopy.click();
  const dialog = page.getByRole('dialog', { name: 'Move or copy documents' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Move here' })).toBeDisabled();
  await dialog.getByRole('button', { name: LAB, exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Move here' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(fileRow(page, RFI)).toBeVisible();

  // Reopen must not keep the cancelled dest (fresh picker).
  await moveCopy.click();
  const again = page.getByRole('dialog', { name: 'Move or copy documents' });
  await expect(again).toBeVisible();
  await expect(again.getByRole('button', { name: 'Move here' })).toBeDisabled();

  // Copy SE-011 → Lab: original stays; Lab gains a same-name clone.
  await again.getByRole('button', { name: 'Copy', exact: true }).click();
  await again.getByRole('button', { name: LAB, exact: true }).click();
  await again.getByRole('button', { name: 'Copy here' }).click();
  await expect(again).toHaveCount(0);
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(fileRow(page, RFI)).toBeVisible();
  await filesHeader(page).getByRole('button', { name: 'Done', exact: true }).click();
  await projectRow(page, LAB).click();
  await expect(fileRow(page, DOOR)).toBeVisible();
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(desktopLayout(page).getByText(RFI)).toHaveCount(0);

  // Move RFI Tower → MEP: leaves Tower; does not appear on Lab.
  await projectRow(page, TOWER).click();
  await expect(fileRow(page, RFI)).toBeVisible();
  await filesHeader(page).getByRole('button', { name: 'Select', exact: true }).click();
  await fileRow(page, RFI).click();
  await filesHeader(page).getByRole('button', { name: 'Move/Copy', exact: true }).click();
  const moveDlg = page.getByRole('dialog', { name: 'Move or copy documents' });
  await expect(moveDlg).toBeVisible();
  await moveDlg.getByRole('button', { name: 'Move', exact: true }).click();
  await moveDlg.getByRole('button', { name: MEP, exact: true }).click();
  await moveDlg.getByRole('button', { name: 'Move here' }).click();
  await expect(moveDlg).toHaveCount(0);
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(desktopLayout(page).getByText(RFI)).toHaveCount(0);
  await projectRow(page, MEP).click();
  await expect(fileRow(page, MEP_FILE)).toBeVisible();
  await expect(fileRow(page, RFI)).toBeVisible();
  await projectRow(page, LAB).click();
  await expect(fileRow(page, DOOR)).toBeVisible();
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(desktopLayout(page).getByText(RFI)).toHaveCount(0);

  // Card reorder — project handles. Escape / self-drag no-op; drop persists.
  await projectRow(page, TOWER).click();
  const towerHandle = projectRow(page, TOWER).locator('[title="Drag to rearrange"]');
  const labHandle = projectRow(page, LAB).locator('[title="Drag to rearrange"]');
  const mepHandle = projectRow(page, MEP).locator('[title="Drag to rearrange"]');
  await expect(towerHandle).toBeVisible();
  await expect(labHandle).toBeVisible();
  await expect(mepHandle).toBeVisible();
  const orderBefore = await projectOrder(page);
  expect(orderBefore[0]).toContain('Tower 5');

  const escapeMode = await dragByHandle(
    page,
    towerHandle,
    projectRow(page, LAB),
    projectOrder,
    { cancel: true, direction: 'down' },
  );
  await expect.poll(async () => (await projectOrder(page))[0]).toContain('Tower 5');

  const selfMode = await dragByHandle(
    page,
    towerHandle,
    projectRow(page, TOWER),
    projectOrder,
    { direction: 'down' },
  );
  await expect.poll(async () => (await projectOrder(page))[0]).toContain('Tower 5');

  const moveMode = await dragByHandle(
    page,
    towerHandle,
    projectRow(page, LAB),
    projectOrder,
    { direction: 'down' },
  );
  await expect.poll(async () => (await projectOrder(page))[0]).toContain('Lab Reno');
  const orderAfter = await projectOrder(page);
  expect(orderAfter.join('|')).not.toBe(orderBefore.join('|'));
  expect(orderAfter.some((name) => name.includes('Tower 5'))).toBeTruthy();
  expect(orderAfter.some((name) => name.includes('MEP Phase 2'))).toBeTruthy();

  // Isolation: Tower files unchanged by card reorder; MEP still has RFI.
  await projectRow(page, TOWER).click();
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(desktopLayout(page).getByText(RFI)).toHaveCount(0);
  await projectRow(page, MEP).click();
  await expect(fileRow(page, RFI)).toBeVisible();

  // Team write — owner chrome on Tower only. Writes fail-closed (no mint).
  await projectRow(page, TOWER).click();
  const manageTeam = desktopLayout(page).getByRole('button', { name: 'Manage team', exact: true });
  await expect(manageTeam).toBeVisible();
  await projectRow(page, LAB).click();
  await expect(desktopLayout(page).getByRole('button', { name: 'Manage team', exact: true })).toHaveCount(0);
  await projectRow(page, TOWER).click();
  await manageTeam.click();
  const team = page.getByRole('dialog', { name: 'Manage Team' });
  await expect(team).toBeVisible({ timeout: 8_000 });
  await expect(team.getByText(/creator/i).first()).toBeVisible();
  await team.getByRole('button', { name: 'Invite', exact: true }).click();
  const invite = page.getByRole('dialog', { name: 'Invite User' });
  await expect(invite).toBeVisible();
  await expect(invite.getByText(/Press Copy link to create a secure/i)).toBeVisible();
  await invite.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(invite.getByText(TEAM_WRITE_FAIL).first()).toBeVisible({ timeout: 15_000 });
  const mintedUrl = await invite.locator('text=/\\/invite\\//').count();
  expect(mintedUrl, 'hubPreview must not mint a real invite URL').toBe(0);
  const sendInvite = invite.getByRole('button', { name: /Send .* invite/ });
  await expect(sendInvite).toBeDisabled();
  await invite.getByPlaceholder('name@example.com, name@example.com').fill('not-an-email');
  await expect(sendInvite).toBeEnabled();
  await sendInvite.click();
  await expect(invite.getByText('Enter at least one valid email.')).toBeVisible();
  await invite.getByPlaceholder('name@example.com, name@example.com').fill('teammate@example.invalid');
  await sendInvite.click();
  await expect(invite.getByText(TEAM_WRITE_FAIL).first()).toBeVisible({ timeout: 15_000 });
  await invite.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(invite).toHaveCount(0);

  await team.getByRole('button', { name: 'More' }).first().click();
  await expect(team.getByText('View activity', { exact: true })).toBeVisible();
  await team.getByText('View activity', { exact: true }).click();
  const activity = page.getByRole('dialog').filter({ hasText: /activity/i }).first();
  await expect(activity.getByText('No recent activity.')).toBeVisible();
  await activity.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(activity).toHaveCount(0);

  await team.getByRole('button', { name: 'Edit', exact: true }).click();
  const roleTrigger = team.locator('[data-kal31-role-trigger]');
  const roleCount = await roleTrigger.count();
  if (roleCount > 0) {
    await roleTrigger.first().click();
    await team.locator('[data-kal31-role-option="editor"]').click();
    await expect(team.getByText(TEAM_WRITE_FAIL).first()).toBeVisible({ timeout: 15_000 });
  }
  await page.keyboard.press('Escape');
  await expect(team).toHaveCount(0);
  await expect(page.getByText(TOWER).first()).toBeVisible();

  // 390: file Move/Copy + card reorder + Team write fail-closed.
  await openHub(page, { width: 390, height: 844 });
  const mobileRow = (id) => page.locator(`.projects-mobile-folder-row[data-project-id="${id}"]`);
  await expect(mobileRow('p1')).toBeVisible({ timeout: 15_000 });
  const mobileHandles = await page.locator('.projects-mobile-folder-row [title="Drag to rearrange"]').count();
  expect(mobileHandles).toBeGreaterThanOrEqual(2);
  const mobileOrderBefore = await page.locator('.projects-mobile-folder-row').evaluateAll((rows) => (
    rows.map((row) => row.querySelector('strong')?.textContent?.trim() || '')
  ));
  const p1Handle = mobileRow('p1').locator('[title="Drag to rearrange"]');
  await pointerDragHandleTo(page, p1Handle, mobileRow('p2'));
  await page.mouse.click(12, 12).catch(() => {});
  const mobileOrderAfter = await page.locator('.projects-mobile-folder-row').evaluateAll((rows) => (
    rows.map((row) => row.querySelector('strong')?.textContent?.trim() || '')
  ));
  const mobileReordered = mobileOrderAfter.join('|') !== mobileOrderBefore.join('|');

  await mobileRow('p1').locator('.projects-mobile-folder-copy').click();
  await expect(page.locator('.projects-mobile-back-button')).toBeVisible({ timeout: 8_000 });
  const mobileFile = page.locator('.projects-mobile-file-row').filter({ hasText: SE011 });
  await expect(mobileFile).toBeVisible({ timeout: 8_000 });
  await page.getByRole('button', { name: 'Select', exact: true }).locator('visible=true').click();
  const mobileMove = page.getByRole('button', { name: 'Move/Copy', exact: true }).locator('visible=true');
  await expect(mobileMove).toBeDisabled();
  await mobileFile.click();
  await expect(mobileMove).toBeEnabled();
  await mobileMove.click();
  const mobileDlg = page.getByRole('dialog', { name: 'Move or copy documents' });
  await expect(mobileDlg).toBeVisible();
  await mobileDlg.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(mobileDlg).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).locator('visible=true').click();

  const mobileTeam = page.getByRole('button', { name: 'Manage team' }).locator('visible=true');
  await expect(mobileTeam).toBeVisible();
  await mobileTeam.click();
  const mobileTeamDlg = page.getByRole('dialog', { name: 'Manage Team' });
  await expect(mobileTeamDlg).toBeVisible();
  await mobileTeamDlg.getByRole('button', { name: 'Invite', exact: true }).click();
  const mobileInvite = page.getByRole('dialog', { name: 'Invite User' });
  await expect(mobileInvite).toBeVisible();
  await mobileInvite.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(mobileInvite.getByText(TEAM_WRITE_FAIL).first()).toBeVisible({ timeout: 15_000 });
  expect(await mobileInvite.locator('text=/\\/invite\\//').count()).toBe(0);
  await mobileInvite.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.keyboard.press('Escape');

  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();

  console.log('HUB_PROJECTS_THIN_CHROME_PROOF', JSON.stringify({
    emptyMove,
    emptyHandles,
    emptyTeam,
    moveCopyDisabled: true,
    moveCopyCancel: true,
    destResetOnReopen: true,
    copySe011ToLab: true,
    moveRfiToMep: true,
    isolation: true,
    escapeMode,
    selfMode,
    moveMode,
    orderAfter,
    teamOwnerOnly: true,
    inviteNoMint: mintedUrl === 0,
    activityEmpty: true,
    roleWriteAttempts: roleCount,
    mobileHandles,
    mobileReordered,
    mobileMoveCancel: true,
    mobileInviteNoMint: true,
    noFileId: fileId === null,
  }));
});
