import { test, expect } from '@playwright/test';

import {
  FAMILY_ORDER,
  assertBlockedPreviewUntouched,
  beginEraserStroke,
  buildFixtureRows,
  dragEraserAcross,
  finishEraserStroke,
  invokeForgedEraserCommits,
  makeSignedInClient,
  openAnonymous,
  openDocumentAs,
  probeRejectedDelete,
  probeRejectedCurrentInsert,
  probeRejectedInsert,
  provisionHarness,
  readCurrentStore,
  readVisibleGeometry,
  replaceFixtureRows,
  runtimeState,
  selectEraser,
  setCollaboratorRole,
  setDocumentLocked,
  snapshotCurrentGeometry,
  waitForFixturesRendered,
  waitForRowState,
} from './eraser-permission-harness.mjs';

test.describe.configure({ mode: 'serial' });

let harness;
let sequence = 0;

function nextPrefix(label) {
  sequence += 1;
  return `eraser-e2e-${label}-${sequence}-${Date.now()}`;
}

async function seedPair(label, options = {}) {
  let empty = await readCurrentStore(harness);
  if (empty.updateCount !== 0) {
    await harness.cleanup();
    harness = await provisionHarness();
    empty = await readCurrentStore(harness);
  }
  expect(empty.annotations).toEqual({});
  expect(empty.surveyMarkers).toEqual({});
  expect(empty.updateCount).toBe(0);
  const foreign = buildFixtureRows({
    documentId: harness.document.id,
    author: harness.users.owner,
    prefix: nextPrefix(`${label}-owner`),
    x: options.foreignX ?? 70,
    lockedFamily: options.foreignLockedFamily ?? null,
    missingAuthorFamily: options.foreignMissingAuthorFamily ?? null,
  });
  const own = buildFixtureRows({
    documentId: harness.document.id,
    author: harness.users.collaborator,
    prefix: nextPrefix(`${label}-editor`),
    x: options.ownX ?? 355,
    lockedFamily: options.ownLockedFamily ?? null,
    missingAuthorFamily: options.ownMissingAuthorFamily ?? null,
  });
  await replaceFixtureRows(harness, foreign, own);
  return { foreign, own, ids: [...foreign.rows, ...own.rows].map((row) => row.annotation_id) };
}

function currentValue(state, id) {
  return state.annotations[id] ?? state.surveyMarkers[id] ?? null;
}

async function expectCurrentUnchanged(ids, before) {
  const after = snapshotCurrentGeometry(await readCurrentStore(harness), ids);
  expect(after).toEqual(before);
}

async function waitForExpectedErase({ own, foreign, mode, before }) {
  const ownIds = Object.values(own.fixtures).map((fixture) => fixture.id);
  const foreignIds = Object.values(foreign.fixtures).map((fixture) => fixture.id);
  return waitForRowState(
    harness,
    async () => {
      const state = await readCurrentStore(harness);
      const foreignPresent = foreignIds.every((id) => currentValue(state, id));
      const ownAtomicGone = FAMILY_ORDER
        .filter((family) => mode === 'entire' || !['pen', 'highlighter'].includes(family))
        .every((family) => !currentValue(state, own.fixtures[family].id));
      const partialInkPresent = mode === 'entire'
        || ['pen', 'highlighter'].every((family) => {
          const id = own.fixtures[family].id;
          const value = currentValue(state, id);
          return value && JSON.stringify(value) !== before[id];
        });
      return {
        ok: foreignPresent && ownAtomicGone && partialInkPresent,
        value: state,
      };
    },
    `[ERASER_PRODUCT_FAILURE] ${mode} erase did not reach the expected durable geometry state`,
  );
}

test.beforeEach(async () => {
  harness = await provisionHarness();
});

test.afterEach(async () => {
  if (!harness) return;
  try {
    await setDocumentLocked(harness, false);
    await setCollaboratorRole(harness, 'editor');
  } finally {
    await harness.cleanup();
    harness = null;
  }
});

test('missing viewer, document owner, and annotation author fail closed in default and legacy partial/full modes', async ({ browser }) => {
  const hygieneContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const hygienePage = await hygieneContext.newPage();
  const ordinaryUrl = new URL(harness.config.baseUrl);
  ordinaryUrl.searchParams.set('testPdf', 'clickable-link-test.pdf');
  await hygienePage.goto(ordinaryUrl.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await hygienePage.waitForFunction(() => document.body != null);
  expect(await hygienePage.evaluate(() => ({
    cachePrime: typeof window.__eraserE2EPrimeDocumentMetadataCache,
    permissionHarness: typeof window.__eraserPermissionE2EHarness,
    forgedCalloutCommit: typeof window.__eraserPermissionE2EHarness?.tryEraseCalloutCommit,
    forgedMarkerCommit: typeof window.__eraserPermissionE2EHarness?.tryEraseSurveyMarkerCommit,
    forgedMarkerMove: typeof window.__eraserPermissionE2EHarness?.tryMoveSurveyMarkerCommit,
    hiddenOutputs: document.querySelectorAll('#fix20-collab-harness-state').length,
  }))).toEqual({
    cachePrime: 'undefined',
    permissionHarness: 'undefined',
    forgedCalloutCommit: 'undefined',
    forgedMarkerCommit: 'undefined',
    forgedMarkerMove: 'undefined',
    hiddenOutputs: 0,
  });
  await hygieneContext.close();

  const anonymousSeed = await seedPair('anonymous');
  const anonymousBefore = snapshotCurrentGeometry(
    await readCurrentStore(harness),
    anonymousSeed.ids,
  );

  const anonymousRead = await harness.anon
    .from('document_annotations')
    .select('annotation_id')
    .eq('document_id', harness.document.id);
  expect(anonymousRead.error).toBeNull();
  expect(anonymousRead.data).toEqual([]);

  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await openAnonymous(context, harness);
  await expect(
    page.evaluate((documentId) => window.__fix20OpenDocumentById(documentId), harness.document.id),
  ).rejects.toThrow();
  expect(await page.locator('[data-diag-eraser-wrapper]').count()).toBe(0);
  await context.close();
  await expectCurrentUnchanged(anonymousSeed.ids, anonymousBefore);

  for (const renderer of ['pdfjs', 'canvas']) {
    for (const mode of ['partial', 'entire']) {
      for (const gap of ['viewer', 'owner', 'author']) {
        const seeded = await seedPair(`missing-${renderer}-${mode}-${gap}`, {
          foreignMissingAuthorFamily: gap === 'author' ? 'shape' : null,
        });
        const target = gap === 'author' ? seeded.foreign.fixtures.shape : seeded.own.fixtures.shape;
        const before = snapshotCurrentGeometry(
          await readCurrentStore(harness),
          seeded.ids,
        );
        const roleContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        const { page: rolePage } = await openDocumentAs(
          roleContext,
          harness,
          harness.users.collaborator,
          {
            renderer,
            missingIdentity: gap === 'author' ? null : gap,
          },
        );
        await waitForFixturesRendered(
          rolePage,
          { shape: target },
          { renderer },
        );
        await selectEraser(rolePage, mode);
        await assertBlockedPreviewUntouched(rolePage, target);
        if (gap === 'viewer' || gap === 'owner') {
          const forged = await invokeForgedEraserCommits(rolePage, {
            calloutId: seeded.own.fixtures.callout.id,
            surveyMarkerId: seeded.own.fixtures['survey-marker'].id,
          });
          expect(forged.callout.committed).toBe(false);
          expect(forged.surveyMarker.permitted).toBe(false);
          expect(forged.surveyMarkerBounds.attempted).toBe(true);
        }
        await expectCurrentUnchanged(seeded.ids, before);
        await roleContext.close();
      }
    }
  }
});

for (const mode of ['partial', 'entire']) {
  test(`collaborator ${mode} mode: blocked preview + commit preserve every foreign family`, async ({ browser }) => {
    const { foreign, own, ids } = await seedPair(`foreign-${mode}`);
    const before = snapshotCurrentGeometry(await readCurrentStore(harness), ids);
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page, errors } = await openDocumentAs(context, harness, harness.users.collaborator);
    await waitForFixturesRendered(page, foreign.fixtures);
    await selectEraser(page, mode);

    for (const family of FAMILY_ORDER) {
      await assertBlockedPreviewUntouched(page, foreign.fixtures[family]);
    }
    const forged = await invokeForgedEraserCommits(page, {
      calloutId: foreign.fixtures.callout.id,
      surveyMarkerId: foreign.fixtures['survey-marker'].id,
    });
    expect(forged.callout.committed).toBe(false);
    expect(forged.surveyMarker.permitted).toBe(false);
    expect(forged.surveyMarkerBounds.attempted).toBe(true);

    await expectCurrentUnchanged(ids, before);
    expect(errors.filter((line) => !line.includes('AbortError'))).toEqual([]);
    await context.close();
  });

  test(`collaborator ${mode} mode: own pen/highlighter, shapes, text, callouts, markers, and text markup persist correctly`, async ({ browser }) => {
    const { foreign, own } = await seedPair(`own-${mode}`);
    const foreignIds = Object.values(foreign.fixtures).map((fixture) => fixture.id);
    const allIds = [
      ...foreignIds,
      ...Object.values(own.fixtures).map((fixture) => fixture.id),
    ];
    const before = snapshotCurrentGeometry(await readCurrentStore(harness), allIds);
    const foreignBefore = Object.fromEntries(
      foreignIds.map((id) => [id, before[id]]),
    );
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page } = await openDocumentAs(context, harness, harness.users.collaborator);
    await waitForFixturesRendered(page, own.fixtures);
    await selectEraser(page, mode);
    const visibleInkBefore = mode === 'partial'
      ? Object.fromEntries(await Promise.all(['pen', 'highlighter'].map(async (family) => [
        family,
        JSON.stringify(await readVisibleGeometry(page, own.fixtures[family])),
      ])))
      : null;

    for (const family of FAMILY_ORDER) {
      await dragEraserAcross(page, own.fixtures[family].center, family === 'callout' ? 38 : 28);
    }

    await waitForExpectedErase({ own, foreign, mode, before });
    await expectCurrentUnchanged(foreignIds, foreignBefore);
    if (mode === 'partial') {
      for (const family of ['pen', 'highlighter']) {
        const visibleAfter = await readVisibleGeometry(page, own.fixtures[family]);
        expect(visibleAfter.length).toBeGreaterThan(0);
        expect(JSON.stringify(visibleAfter)).not.toBe(visibleInkBefore[family]);
      }
    }
    await context.close();
  });
}

test('owner partial and full modes may erase every collaborator-authored family', async ({ browser }) => {
  for (const mode of ['partial', 'entire']) {
    const { foreign, own } = await seedPair(`owner-${mode}`);
    const allIds = [
      ...Object.values(foreign.fixtures).map((fixture) => fixture.id),
      ...Object.values(own.fixtures).map((fixture) => fixture.id),
    ];
    const before = snapshotCurrentGeometry(await readCurrentStore(harness), allIds);
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page } = await openDocumentAs(context, harness, harness.users.owner);
    await waitForFixturesRendered(page, own.fixtures);
    await selectEraser(page, mode);
    for (const family of FAMILY_ORDER) {
      await dragEraserAcross(page, own.fixtures[family].center, family === 'callout' ? 38 : 28);
    }
    await waitForExpectedErase({ own, foreign, mode, before });
    await context.close();
  }
});

test('viewer and locked annotation/document paths fail closed, including RLS writes', async ({ browser }) => {
  let viewerProbeTarget = null;
  for (const family of FAMILY_ORDER) {
    const { own, ids } = await seedPair(`locked-${family}`, { ownLockedFamily: family });
    const lockedTarget = own.fixtures[family];
    viewerProbeTarget = lockedTarget;
    const lockedBefore = snapshotCurrentGeometry(await readCurrentStore(harness), ids);
    const editorContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page: editorPage } = await openDocumentAs(
      editorContext,
      harness,
      harness.users.collaborator,
    );
    await waitForFixturesRendered(editorPage, { [family]: lockedTarget });
    await selectEraser(editorPage, 'entire');
    await assertBlockedPreviewUntouched(editorPage, lockedTarget);
    await expectCurrentUnchanged(ids, lockedBefore);
    await editorContext.close();
  }

  const transitionSeed = await seedPair('backend-lock-transition');
  const transitionTarget = transitionSeed.own.fixtures.pen;
  const transitionBefore = snapshotCurrentGeometry(
    await readCurrentStore(harness),
    [transitionTarget.id],
  );
  const ownerContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const { page: ownerPage } = await openDocumentAs(
    ownerContext,
    harness,
    harness.users.owner,
  );
  await waitForFixturesRendered(ownerPage, { pen: transitionTarget });
  await selectEraser(ownerPage, 'partial');
  const ownerClientPoint = await beginEraserStroke(ownerPage, transitionTarget.center, 30);
  await ownerPage.waitForFunction(() => (
    document.querySelectorAll('[data-eraser-mask-clone]').length > 0
  ));
  await setDocumentLocked(harness, true);
  await ownerPage.waitForFunction(() => (
    document.body.getAttribute('data-kal49-locked') === 'true'
    && document.querySelectorAll('[data-eraser-mask-clone]').length === 0
  ), null, { timeout: 30_000 });
  await finishEraserStroke(ownerPage, ownerClientPoint, 30);
  await expectCurrentUnchanged([transitionTarget.id], transitionBefore);

  // A stale pointer path and a brand-new gesture are both inert while locked.
  await dragEraserAcross(ownerPage, transitionTarget.center, 30);
  await expectCurrentUnchanged([transitionTarget.id], transitionBefore);
  await ownerContext.setOffline(true);
  await ownerContext.setOffline(false);
  await ownerPage.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await ownerPage.waitForFunction(() => (
    document.body.getAttribute('data-kal49-locked') === 'true'
  ), null, { timeout: 60_000 });
  await expectCurrentUnchanged([transitionTarget.id], transitionBefore);

  await setDocumentLocked(harness, false);
  await ownerPage.waitForFunction(() => (
    document.body.getAttribute('data-kal49-locked') !== 'true'
  ), null, { timeout: 30_000 });
  await selectEraser(ownerPage, 'partial');
  await dragEraserAcross(ownerPage, transitionTarget.center, 30);
  await waitForRowState(
    harness,
    async () => {
      const state = await readCurrentStore(harness);
      const value = currentValue(state, transitionTarget.id);
      return {
        ok: Boolean(value) && JSON.stringify(value) !== transitionBefore[transitionTarget.id],
        value,
      };
    },
    '[ERASER_PRODUCT_FAILURE] unlock did not restore a fresh authorized erase',
  );
  await ownerContext.close();

  // Missed-event window: cache an unlocked documents row, lock before the
  // banner subscribes/mounts, then open. The initial lock read must bypass the
  // metadata cache and enter read-only immediately.
  await setDocumentLocked(harness, false);
  await seedPair('backend-lock-stale-cache');
  const staleCacheContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const { page: staleCachePage } = await openDocumentAs(
    staleCacheContext,
    harness,
    harness.users.owner,
    { deferOpen: true },
  );
  await staleCachePage.evaluate(async (documentId) => {
    if (typeof window.__eraserE2EPrimeDocumentMetadataCache !== 'function') {
      throw new Error('[ERASER_E2E_INFRA] metadata cache priming seam unavailable');
    }
    await window.__eraserE2EPrimeDocumentMetadataCache(documentId);
  }, harness.document.id);
  await setDocumentLocked(harness, true);
  await staleCachePage.evaluate(
    (documentId) => window.__eraserE2EOpenDocumentById(documentId),
    harness.document.id,
  );
  await staleCachePage.waitForFunction(() => (
    document.body.getAttribute('data-kal49-locked') === 'true'
    && document.body.getAttribute('data-readonly') === 'true'
  ), null, { timeout: 60_000 });
  await staleCacheContext.close();

  const viewerContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const { page: viewerPage } = await openDocumentAs(
    viewerContext,
    harness,
    harness.users.viewer,
  );
  await viewerPage.waitForFunction(() => document.body.getAttribute('data-readonly') === 'true');
  const viewerState = await runtimeState(viewerPage);
  expect(viewerState.bodyReadonly).toBe('true');
  expect(viewerState.eraserWrappers).toBe(0);

  const viewerClient = await makeSignedInClient(harness, harness.users.viewer);
  const deniedViewerDelete = await probeRejectedDelete(
    viewerClient,
    harness.document.id,
    viewerProbeTarget.id,
  );
  expect(deniedViewerDelete.rows).toEqual([]);
  expect([null, 0]).toContain(deniedViewerDelete.count);
  await viewerContext.close();

  await setDocumentLocked(harness, true);
  const ownerClient = await makeSignedInClient(harness, harness.users.owner);
  const deniedLockedInsert = await probeRejectedInsert(
    ownerClient,
    harness,
    `${nextPrefix('locked-insert')}-probe`,
  );
  expect(deniedLockedInsert.rows).toEqual([]);
  expect(deniedLockedInsert.error).not.toBeNull();
  expect(deniedLockedInsert.error.code).toBe('42501');
});

test('role revocation during active erase cannot survive reconnect/reload or replay after restoration', async ({ browser }) => {
  const { own } = await seedPair('revoke');
  const target = own.fixtures.pen;
  const before = snapshotCurrentGeometry(await readCurrentStore(harness), [target.id]);
  const collaboratorClient = await makeSignedInClient(harness, harness.users.collaborator);

  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const { page } = await openDocumentAs(context, harness, harness.users.collaborator);
  await waitForFixturesRendered(page, { pen: target });
  await selectEraser(page, 'partial');
  const visibleBefore = JSON.stringify(await readVisibleGeometry(page, target));

  const clientPoint = await beginEraserStroke(page, target.center, 30);
  await page.waitForFunction(() => document.querySelectorAll('[data-eraser-mask-clone]').length > 0);
  await setCollaboratorRole(harness, 'viewer');
  await page.waitForFunction(() => (
    document.body.getAttribute('data-readonly') === 'true'
    && document.querySelectorAll('[data-eraser-mask-clone]').length === 0
  ), null, { timeout: 30_000 });
  await finishEraserStroke(page, clientPoint, 30);
  const staleForged = await invokeForgedEraserCommits(page, {
    calloutId: own.fixtures.callout.id,
    surveyMarkerId: own.fixtures['survey-marker'].id,
  });
  expect(staleForged.callout.committed).toBe(false);
  expect(staleForged.surveyMarker.permitted).toBe(false);
  expect(staleForged.surveyMarkerBounds.attempted).toBe(true);
  expect(JSON.stringify(await readVisibleGeometry(page, target))).toBe(visibleBefore);

  const deniedDelete = await probeRejectedDelete(
    collaboratorClient,
    harness.document.id,
    target.id,
  );
  expect(deniedDelete.rows).toEqual([]);
  expect([null, 0]).toContain(deniedDelete.count);
  const deniedCurrentInsert = await probeRejectedCurrentInsert(
    collaboratorClient,
    harness,
  );
  expect(deniedCurrentInsert.rows).toEqual([]);
  expect(deniedCurrentInsert.error?.code).toBe('42501');
  await expectCurrentUnchanged([target.id], before);

  await context.setOffline(true);
  await context.setOffline(false);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__eraserE2EOpenDocumentById === 'function');
  await page.evaluate(
    (documentId) => window.__eraserE2EOpenDocumentById(documentId),
    harness.document.id,
  );
  await page.waitForFunction((id) => {
    try {
      const state = JSON.parse(
        document.querySelector('[data-eraser-permission-e2e="true"]')?.textContent || '',
      );
      return state.annotations?.some((entry) => entry.id === id);
    } catch {
      return false;
    }
  }, target.id, { timeout: 60_000 });
  await expectCurrentUnchanged([target.id], before);

  await setCollaboratorRole(harness, 'editor');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__eraserE2EOpenDocumentById === 'function');
  await page.evaluate(
    (documentId) => window.__eraserE2EOpenDocumentById(documentId),
    harness.document.id,
  );
  await page.waitForFunction((id) => {
    try {
      const state = JSON.parse(
        document.querySelector('[data-eraser-permission-e2e="true"]')?.textContent || '',
      );
      return state.annotations?.some((entry) => entry.id === id);
    } catch {
      return false;
    }
  }, target.id, { timeout: 60_000 });

  // Give any stale local queue a chance to retry after editor access returns.
  await page.waitForTimeout(3_000);
  await expectCurrentUnchanged([target.id], before);
  await selectEraser(page, 'partial');
  await dragEraserAcross(page, target.center, 30);
  await waitForRowState(
    harness,
    async () => {
      const state = await readCurrentStore(harness);
      const value = currentValue(state, target.id);
      return {
        ok: Boolean(value) && JSON.stringify(value) !== before[target.id],
        value,
      };
    },
    '[ERASER_PRODUCT_FAILURE] restored editor access could not persist a fresh authorized erase',
  );
  await context.close();

  // Miss the editor→viewer Realtime event deliberately: take this client
  // offline only while the backend role changes, then reconnect before the
  // erase. The stale editor UI reaches the real annotation_updates INSERT,
  // receives 42501, and must restore/quarantine the local geometry rather than
  // merely showing a red health state over an unauthorized local erase.
  const missed = await seedPair('revoke-missed-realtime-42501');
  const missedTarget = missed.own.fixtures.pen;
  const missedBefore = snapshotCurrentGeometry(
    await readCurrentStore(harness),
    [missedTarget.id],
  );
  const missedContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const { page: missedPage } = await openDocumentAs(
    missedContext,
    harness,
    harness.users.collaborator,
  );
  await waitForFixturesRendered(missedPage, { pen: missedTarget });
  const missedVisibleBefore = JSON.stringify(
    await readVisibleGeometry(missedPage, missedTarget),
  );
  await missedContext.setOffline(true);
  await setCollaboratorRole(harness, 'viewer');
  await missedPage.waitForTimeout(750);
  await missedContext.setOffline(false);
  await missedPage.waitForTimeout(1_000);
  expect(await missedPage.evaluate(() => (
    document.body.getAttribute('data-readonly')
  ))).not.toBe('true');

  await selectEraser(missedPage, 'partial');
  await dragEraserAcross(missedPage, missedTarget.center, 30);
  await missedPage.waitForFunction(() => (
    document.body.getAttribute('data-readonly') === 'true'
  ), null, { timeout: 30_000 });
  await missedPage.waitForFunction(
    ({ id, expected }) => {
      const escaped = CSS.escape(id);
      const elements = [
        ...document.querySelectorAll(
          `[data-annotation-id="${escaped}"],`
          + `[data-callout-id="${escaped}"],`
          + `[data-survey-marker-id="${escaped}"]`,
        ),
      ];
      const geometry = elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          d: element.getAttribute('d'),
          points: element.getAttribute('points'),
          x: element.getAttribute('x'),
          y: element.getAttribute('y'),
          width: element.getAttribute('width'),
          height: element.getAttribute('height'),
          transform: element.getAttribute('transform'),
          rect: [rect.x, rect.y, rect.width, rect.height],
        };
      });
      return geometry.length > 0 && JSON.stringify(geometry) === expected;
    },
    { id: missedTarget.id, expected: missedVisibleBefore },
    { timeout: 30_000 },
  );
  expect(JSON.stringify(await readVisibleGeometry(missedPage, missedTarget)))
    .toBe(missedVisibleBefore);
  await expectCurrentUnchanged([missedTarget.id], missedBefore);

  await missedContext.setOffline(true);
  await missedContext.setOffline(false);
  await missedPage.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await missedPage.waitForFunction(() => typeof window.__eraserE2EOpenDocumentById === 'function');
  await missedPage.evaluate(
    (documentId) => window.__eraserE2EOpenDocumentById(documentId),
    harness.document.id,
  );
  await waitForFixturesRendered(missedPage, { pen: missedTarget });
  expect(JSON.stringify(await readVisibleGeometry(missedPage, missedTarget)))
    .toBe(missedVisibleBefore);
  await expectCurrentUnchanged([missedTarget.id], missedBefore);

  await setCollaboratorRole(harness, 'editor');
  await missedPage.waitForFunction(() => (
    document.body.getAttribute('data-readonly') !== 'true'
  ), null, { timeout: 30_000 });
  await missedPage.waitForTimeout(3_000);
  expect(JSON.stringify(await readVisibleGeometry(missedPage, missedTarget)))
    .toBe(missedVisibleBefore);
  await expectCurrentUnchanged([missedTarget.id], missedBefore);

  await selectEraser(missedPage, 'partial');
  await dragEraserAcross(missedPage, missedTarget.center, 30);
  await waitForRowState(
    harness,
    async () => {
      const state = await readCurrentStore(harness);
      const value = currentValue(state, missedTarget.id);
      return {
        ok: Boolean(value) && JSON.stringify(value) !== missedBefore[missedTarget.id],
        value,
      };
    },
    '[ERASER_PRODUCT_FAILURE] 42501 quarantine blocked a new authorized erase after recovery',
  );
  await missedContext.close();
});

test('legacy canvas renderer keeps foreign pixels/rows and erases own families only', async ({ browser }) => {
  for (const mode of ['partial', 'entire']) {
    const { foreign, own } = await seedPair(`legacy-${mode}`);
    const foreignIds = Object.values(foreign.fixtures).map((fixture) => fixture.id);
    const allIds = [
      ...foreignIds,
      ...Object.values(own.fixtures).map((fixture) => fixture.id),
    ];
    const before = snapshotCurrentGeometry(await readCurrentStore(harness), allIds);
    const foreignBefore = Object.fromEntries(foreignIds.map((id) => [id, before[id]]));
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page } = await openDocumentAs(
      context,
      harness,
      harness.users.collaborator,
      { renderer: 'canvas' },
    );
    await waitForFixturesRendered(
      page,
      { ...foreign.fixtures, ...own.fixtures },
      { renderer: 'canvas' },
    );
    await selectEraser(page, mode);
    expect(await page.locator('canvas[data-pal-canvas="1"]').count()).toBe(1);
    for (const family of FAMILY_ORDER) {
      await assertBlockedPreviewUntouched(page, foreign.fixtures[family]);
    }
    await expectCurrentUnchanged(foreignIds, foreignBefore);
    for (const family of FAMILY_ORDER) {
      await dragEraserAcross(page, own.fixtures[family].center, family === 'callout' ? 38 : 28);
    }
    await waitForExpectedErase({ own, foreign, mode, before });
    await expectCurrentUnchanged(foreignIds, foreignBefore);
    await context.close();
  }
});
