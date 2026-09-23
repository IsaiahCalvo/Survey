import {
  assertBrowserUsesLeasedAccount,
  installLeasedBrowserAccount,
} from './lib/leased-browser-session.mjs';
import {
  createCollaborationEvidence,
  finalizeCollaborationEvidence,
} from './full-app-collaboration-contract.mjs';

const invariant = (value, message) => {
  if (!value) throw new Error(message);
  return value;
};

async function firstVisible(locator) {
  for (let index = 0; index < await locator.count(); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function clickVisible(locator, label) {
  const target = invariant(await firstVisible(locator), `Expected visible ${label}`);
  await target.click();
  return target;
}

async function waitForHub(page, title) {
  await page.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => ![...document.querySelectorAll('.hub-skeleton-block')]
    .some((node) => node.getClientRects().length > 0), null, { timeout: 60_000 });
}

async function exitMobileTransientSurface(page, destination) {
  const manageTeam = page.locator('[data-kal31-manage-team="true"]');
  if (await firstVisible(manageTeam)) {
    await clickVisible(manageTeam.getByRole('button', { name: 'Done', exact: true }), 'Manage Team Done before navigation');
    await manageTeam.waitFor({ state: 'hidden', timeout: 10_000 });
  }

  const backToDocuments = await firstVisible(page.getByRole('button', { name: 'Back to documents', exact: true }));
  if (backToDocuments) {
    await backToDocuments.click();
    await waitForHub(page, 'Documents');
  }

  if (destination === 'Projects') {
    const projectDrillBack = await firstVisible(page.locator('.projects-mobile-back-button'));
    if (projectDrillBack) {
      await projectDrillBack.click();
      await page.locator('.projects-mobile-layout [data-project-id]').first()
        .waitFor({ state: 'visible', timeout: 20_000 });
    }
  }
}

async function navigateHub(page, title) {
  await exitMobileTransientSurface(page, title);
  if (await page.getByRole('heading', { name: title, exact: true }).isVisible().catch(() => false)) {
    await waitForHub(page, title);
    return;
  }

  const bottomNavigation = page.getByRole('navigation', { name: 'Home sections', exact: true });
  const bottomTarget = await firstVisible(bottomNavigation.getByRole('button', { name: title, exact: true }));
  if (bottomTarget) {
    await bottomTarget.click();
  } else {
    // Phone rail mode: the page title is the section switcher (2026-09-23).
    const titleSwitch = await firstVisible(page.locator('.hub-title-switch'));
    if (titleSwitch) {
      await titleSwitch.click();
      const sectionMenu = page.getByRole('menu', { name: 'Go to', exact: true });
      await sectionMenu.waitFor({ state: 'visible', timeout: 10_000 });
      await clickVisible(sectionMenu.getByRole('menuitem', { name: title, exact: true }), `${title} title section menu`);
    } else {
      const desktopNavigation = page.locator('.side .nav');
      await clickVisible(
        desktopNavigation.getByRole('button', { name: title, exact: true }),
        `${title} desktop navigation`,
      );
    }
  }
  await waitForHub(page, title);
}

const PROJECT_CONTROL_SELECTOR = [
  '.projects-desktop-layout [data-project-id]',
  '.projects-mobile-layout [data-project-id]',
].join(', ');

async function findProjectControl(page, projectName) {
  const candidates = page.locator(PROJECT_CONTROL_SELECTOR);
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;
    const containsExactName = await candidate.evaluate((element, name) => (
      element.textContent?.trim() === name
      || [...element.querySelectorAll('*')].some((child) => (
        child.children.length === 0 && child.textContent?.trim() === name
      ))
    ), projectName);
    if (containsExactName) return candidate;
  }
  return null;
}

async function waitForProjectControl(page, projectName, timeoutMs = 60_000) {
  await page.waitForFunction(({ selector, name }) => [...document.querySelectorAll(selector)].some((element) => {
    if (!element.getClientRects().length) return false;
    return element.textContent?.trim() === name
      || [...element.querySelectorAll('*')].some((child) => (
        child.children.length === 0 && child.textContent?.trim() === name
      ));
  }), { selector: PROJECT_CONTROL_SELECTOR, name: projectName }, { timeout: timeoutMs });
  return invariant(await findProjectControl(page, projectName), `Project control was not visible: ${projectName}`);
}

async function clickProjectControl(page, projectName) {
  const control = await waitForProjectControl(page, projectName);
  await control.click();
  return control;
}

export function createRuntimeEntitlementProbe(page, { userId }) {
  let result = null;
  let resolveResult;
  const promise = new Promise((resolve) => { resolveResult = resolve; });
  const listener = async (response) => {
    const url = new URL(response.url());
    if (!url.pathname.endsWith('/rest/v1/user_subscriptions') || !response.ok()) return;
    if (url.searchParams.get('user_id') !== `eq.${userId}`) return;
    const body = await response.json().catch(() => null);
    const row = Array.isArray(body) ? body[0] : body;
    if (!row?.tier || !row?.status) return;
    result = { userId, tier: row.tier, status: row.status };
    resolveResult(result);
  };
  page.on('response', listener);
  return {
    async wait(timeoutMs = 30_000) {
      if (result) return result;
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Signed-in backend entitlement response was not observed')), timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    stop() { page.off('response', listener); },
  };
}

async function captureCreatedProjectInvite(page, action) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/rest/v1/project_invites')
      && response.request().method() === 'POST';
  }, { timeout: 30_000 });
  await action();
  const response = await responsePromise;
  invariant(response.ok(), `Project invite create failed with HTTP ${response.status()}`);
  const body = await response.json();
  const row = Array.isArray(body) ? body[0] : body;
  invariant(row?.id && row?.token, 'Project invite create did not return exact id/token');
  const headers = await response.request().allHeaders();
  return {
    row,
    signedApi: {
      origin: new URL(response.url()).origin,
      headers: {
        apikey: invariant(headers.apikey, 'Invite request omitted Supabase apikey'),
        authorization: invariant(headers.authorization, 'Invite request omitted signed-in Authorization'),
      },
    },
  };
}

async function openManageTeam(page, projectName) {
  await navigateHub(page, 'Projects');
  await clickProjectControl(page, projectName);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => (
    button.getClientRects().length > 0
    && (button.getAttribute('aria-label') || button.textContent?.trim()) === 'Manage team'
  )), null, { timeout: 20_000 });
  await clickVisible(page.getByRole('button', { name: 'Manage team', exact: true }), 'Manage team');
  await page.locator('[data-kal31-manage-team="true"]').waitFor({ state: 'visible', timeout: 20_000 });
}

async function createLinkInvite(page) {
  const manageTeam = page.locator('[data-kal31-manage-team="true"]');
  await clickVisible(manageTeam.getByRole('button', { name: 'Invite', exact: true }), 'Invite');
  const inviteModal = page.locator('[data-kal31-project-invite-modal="true"]');
  await inviteModal.waitFor({ state: 'visible', timeout: 10_000 });
  const created = await captureCreatedProjectInvite(page, () => (
    clickVisible(inviteModal.getByRole('button', { name: 'Copy link', exact: true }), 'Copy link')
  ));
  await inviteModal.getByText(/Link copied\. Anyone with it can join as Viewer\./).waitFor({ state: 'visible', timeout: 20_000 });
  return created;
}

async function closeInviteModal(page) {
  const inviteModal = page.locator('[data-kal31-project-invite-modal="true"]');
  await clickVisible(inviteModal.locator('button[title="Close"]'), 'Invite User close');
  await inviteModal.waitFor({ state: 'hidden', timeout: 10_000 });
}

async function exactPendingInviteRow(page, inviteId) {
  const row = page.locator(`[data-kal31-project-invite="${inviteId}"]`);
  await row.waitFor({ state: 'visible', timeout: 10_000 });
  invariant(await row.count() === 1, `Expected one exact pending invite row for ${inviteId}`);
  return row;
}

async function revokePendingInvite(page, inviteId) {
  const row = await exactPendingInviteRow(page, inviteId);
  await clickVisible(row.locator('button[title="More"]'), 'pending invite More');
  await clickVisible(row.getByRole('button', { name: 'Revoke invite', exact: true }), 'Revoke invite');
  await page.locator('[data-kal31-manage-team="true"]')
    .getByText('Invite revoked.', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
}

async function attemptProjectRename(page, fromName, toName) {
  await navigateHub(page, 'Projects');
  await clickProjectControl(page, fromName);
  let input = null;
  const inputs = page.locator('input[title="Click to rename"], input[title="Tap to rename"]');
  await page.waitForFunction(() => [...document.querySelectorAll(
    'input[title="Click to rename"], input[title="Tap to rename"]',
  )].some((candidate) => candidate.getClientRects().length > 0), null, { timeout: 20_000 });
  for (let index = 0; index < await inputs.count(); index += 1) {
    const candidate = inputs.nth(index);
    if (await candidate.isVisible().catch(() => false)
      && await candidate.inputValue().catch(() => null) === fromName) {
      input = candidate;
      break;
    }
  }
  invariant(input, 'Open project rename input was not visible');
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/rest/v1/projects') && response.request().method() === 'PATCH';
  }, { timeout: 20_000 });
  await input.fill(toName);
  await input.press('Enter');
  return responsePromise;
}

async function exactCollaboratorRow(page, userId) {
  const row = page.locator(`[data-kal31-project-member="${userId}"]`);
  await row.waitFor({ state: 'visible', timeout: 10_000 });
  invariant(await row.count() === 1, `Expected one exact collaborator row for ${userId}`);
  return row;
}

async function setInviteeRole(page, inviteeEmail, inviteeUserId, role) {
  const row = await exactCollaboratorRow(page, inviteeUserId);
  await clickVisible(row.locator('button[title="More"]'), 'collaborator More');
  await clickVisible(row.getByRole('button', { name: 'Change role', exact: true }), 'Change role');
  const editRow = await exactCollaboratorRow(page, inviteeUserId);
  const roleMenu = editRow.locator('[data-kal31-role-menu="true"]');
  await roleMenu.waitFor({ state: 'visible', timeout: 10_000 });
  await clickVisible(
    roleMenu.locator(`[data-kal31-role-option="${role.toLowerCase()}"]`),
    `${role} role`,
  );
  await page.locator('[data-kal31-manage-team="true"]')
    .getByText(`Updated ${inviteeEmail} to ${role}.`, { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
}

async function removeInvitee(page, inviteeEmail, inviteeUserId) {
  const row = await exactCollaboratorRow(page, inviteeUserId);
  await clickVisible(row.locator('button[title="More"]'), 'collaborator More');
  await clickVisible(row.getByRole('button', { name: 'Remove from team', exact: true }), 'Remove from team');
  await page.locator('[data-kal31-manage-team="true"]')
    .getByText(`Removed ${inviteeEmail}.`, { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
}

export async function runProjectCollaboration({
  browser,
  ownerPage,
  serverBaseUrl,
  surfaceConfig,
  projectName,
  ownerAccount,
  inviteeAccount,
  inviteeAccountIndex,
  runtimeOwnerEntitlement,
  artifactDirectory,
}) {
  const evidence = createCollaborationEvidence({ owner: ownerAccount, invitee: inviteeAccount, runtimeOwnerEntitlement });
  let signedApi = null;
  let inviteeContext = null;
  try {
    await openManageTeam(ownerPage, projectName);
    const acceptedInvite = await createLinkInvite(ownerPage);
    signedApi = acceptedInvite.signedApi;
    evidence.createdInvites.push({ id: acceptedInvite.row.id, intendedRole: 'viewer', accepted: true });
    evidence.coverage.invite = 'covered';

    await closeInviteModal(ownerPage);
    const revokedInvite = await createLinkInvite(ownerPage);
    evidence.createdInvites.push({ id: revokedInvite.row.id, intendedRole: 'viewer', accepted: false });
    await closeInviteModal(ownerPage);
    await revokePendingInvite(ownerPage, revokedInvite.row.id);
    evidence.revokedInviteIds.push(revokedInvite.row.id);
    evidence.coverage.revoke = 'covered';

    inviteeContext = await browser.newContext({
      viewport: surfaceConfig.viewport,
      screen: surfaceConfig.viewport,
      isMobile: surfaceConfig.isMobile,
      hasTouch: surfaceConfig.hasTouch,
      deviceScaleFactor: surfaceConfig.deviceScaleFactor,
      locale: 'en-US',
    });
    await installLeasedBrowserAccount(inviteeContext, { accountIndex: inviteeAccountIndex });
    const pageInvitee = await inviteeContext.newPage();
    await pageInvitee.goto(`${serverBaseUrl}/invite/${encodeURIComponent(acceptedInvite.row.token)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await assertBrowserUsesLeasedAccount(pageInvitee, { account: inviteeAccount, timeoutMs: 60_000 });
    await pageInvitee.locator('[data-kal31-status="accepted"]').waitFor({ state: 'visible', timeout: 60_000 });
    evidence.acceptedInviteIds.push(acceptedInvite.row.id);
    evidence.coverage.accept = 'covered';
    await clickVisible(
      pageInvitee.locator('[data-kal31-invite-page="true"]')
        .getByRole('button', { name: 'Go to Survey', exact: true }),
      'Go to Survey',
    );
    await waitForHub(pageInvitee, 'Documents');

    await navigateHub(pageInvitee, 'Projects');
    await waitForProjectControl(pageInvitee, projectName);
    const deniedName = `${projectName} viewer-denied`;
    const deniedResponse = await attemptProjectRename(pageInvitee, projectName, deniedName);
    invariant(deniedResponse.status() >= 400, `Viewer project rename unexpectedly returned HTTP ${deniedResponse.status()}`);
    await pageInvitee.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForHub(pageInvitee, 'Projects');
    await waitForProjectControl(pageInvitee, projectName);
    invariant(!(await findProjectControl(pageInvitee, deniedName)), 'Viewer project rename persisted');
    evidence.coverage.viewerPermission = 'covered';

    await ownerPage.keyboard.press('Escape').catch(() => {});
    await ownerPage.locator('[data-kal31-manage-team="true"]').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    await openManageTeam(ownerPage, projectName);
    await setInviteeRole(ownerPage, inviteeAccount.email, inviteeAccount.userId, 'Editor');
    evidence.coverage.roleChange = 'covered';

    await pageInvitee.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForHub(pageInvitee, 'Projects');
    const editorName = `${projectName} editor-proof`;
    const editorResponse = await attemptProjectRename(pageInvitee, projectName, editorName);
    invariant(editorResponse.ok(), `Editor project rename failed with HTTP ${editorResponse.status()}`);
    await pageInvitee.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForHub(pageInvitee, 'Projects');
    await waitForProjectControl(pageInvitee, editorName);
    evidence.coverage.editorPermission = 'covered';
    evidence.coverage.reload = 'covered';

    const restoreResponse = await attemptProjectRename(pageInvitee, editorName, projectName);
    invariant(restoreResponse.ok(), `Editor project-name restore failed with HTTP ${restoreResponse.status()}`);
    await pageInvitee.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForHub(pageInvitee, 'Projects');
    await waitForProjectControl(pageInvitee, projectName);

    await ownerPage.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForHub(ownerPage, 'Projects');
    await openManageTeam(ownerPage, projectName);
    await removeInvitee(ownerPage, inviteeAccount.email, inviteeAccount.userId);
    evidence.removedCollaboratorUserIds.push(inviteeAccount.userId);
    evidence.coverage.remove = 'covered';

    await pageInvitee.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForHub(pageInvitee, 'Projects');
    invariant(!(await findProjectControl(pageInvitee, projectName)), 'Removed invitee retained project access after reload');
    await ownerPage.screenshot({ path: `${artifactDirectory}/collaboration-complete.png` });
    const manageTeam = ownerPage.locator('[data-kal31-manage-team="true"]');
    await clickVisible(manageTeam.getByRole('button', { name: 'Done', exact: true }), 'Manage Team Done');
    await manageTeam.waitFor({ state: 'hidden', timeout: 10_000 });
    await waitForHub(ownerPage, 'Projects');
  } catch (error) {
    evidence.errors.push(error?.message || String(error));
    throw error;
  } finally {
    await inviteeContext?.close().catch(() => {});
  }
  return { evidence, signedApi };
}

async function signedRows(page, signedApi, table, query) {
  const response = await page.context().request.get(
    `${signedApi.origin}/rest/v1/${table}?${query}`,
    { headers: { ...signedApi.headers, accept: 'application/json' } },
  );
  invariant(response.ok(), `Exact cleanup query for ${table} failed with HTTP ${response.status()}`);
  return response.json();
}

export async function proveProjectCollaborationCleanup({ page, projectId, evidence, signedApi }) {
  invariant(signedApi, 'Signed collaboration API context was not captured');
  const projectRows = await signedRows(page, signedApi, 'projects', `id=eq.${encodeURIComponent(projectId)}&select=id`);
  invariant(projectRows.length === 0, `Deleted collaboration project ${projectId} still exists`);
  evidence.parentProjectDeleteObserved = true;
  for (const invite of evidence.createdInvites) {
    const rows = await signedRows(page, signedApi, 'project_invites', `id=eq.${encodeURIComponent(invite.id)}&select=id`);
    invariant(rows.length === 0, `Collaboration invite ${invite.id} still exists`);
    evidence.exactBackendAbsence.invites.push(invite.id);
  }
  const collaboratorRows = await signedRows(
    page,
    signedApi,
    'project_collaborators',
    `project_id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(evidence.invitee.userId)}&select=user_id`,
  );
  invariant(collaboratorRows.length === 0, `Collaboration row for ${evidence.invitee.userId} still exists`);
  evidence.exactBackendAbsence.collaborators.push(evidence.invitee.userId);
  finalizeCollaborationEvidence(evidence);
  invariant(evidence.complete, `Collaboration proof incomplete: ${evidence.problems.join('; ')}`);
  return evidence;
}
