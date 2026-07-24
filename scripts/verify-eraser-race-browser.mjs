import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.ERASER_RACE_PORT || 5209);
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];

assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'ERASER_RACE_PORT must be a valid port');

const server = spawn(
  process.execPath,
  [
    resolve(repoRoot, 'node_modules/vite/bin/vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  {
    cwd: repoRoot,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let serverExit = null;
server.on('exit', (code, signal) => {
  serverExit = { code, signal };
});
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    serverOutput.push(chunk);
    if (serverOutput.length > 80) serverOutput.shift();
  });
}

const waitUntil = async (description, read, predicate, timeoutMs = 15_000) => {
  const startedAt = Date.now();
  let lastValue;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await read();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
  }
  assert.fail(`${description} timed out; last value: ${JSON.stringify(lastValue)}`);
};

const waitForServer = async () => {
  await waitUntil(
    `Vite on ${baseUrl}`,
    async () => {
      if (serverExit) {
        return {
          ready: false,
          exited: serverExit,
          output: serverOutput.join(''),
        };
      }
      try {
        const response = await fetch(baseUrl);
        return { ready: response.ok, status: response.status };
      } catch (error) {
        return { ready: false, error: error.message };
      }
    },
    (value) => value.ready,
    20_000,
  );
};

const attachErrorCapture = (page, label, errors) => {
  page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`${label} console: ${message.text()}`);
    }
  });
};

const openClient = async (context, session, role, errors, label = role) => {
  const page = await context.newPage();
  attachErrorCapture(page, label, errors);
  await page.goto(
    `${baseUrl}/?eraserRace=1&raceRole=${role}&raceSession=${encodeURIComponent(session)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.locator('[data-eraser-race-harness="true"]').waitFor();
  return page;
};

const readEvents = (page) => page.locator('[data-race-events] li').evaluateAll(
  (items) => items.map((item) => {
    const text = item.textContent || '';
    const separator = text.indexOf(' · ');
    return separator === -1 ? text : text.slice(separator + 3);
  }),
);

const waitForEvent = (page, type) => waitUntil(
  `event ${type}`,
  () => readEvents(page),
  (events) => events.includes(type),
);

const readState = async (page) => {
  const root = page.locator('[data-eraser-race-harness="true"]');
  const { dataset, pathD } = await root.evaluate((element) => ({
    dataset: { ...element.dataset },
    pathD: document.querySelector('[data-shared-target]')?.getAttribute('d') || null,
  }));
  return {
    present: dataset.raceObjectPresent === 'true',
    left: dataset.raceLeft || '',
    minX: dataset.raceMinX || '',
    maxX: dataset.raceMaxX || '',
    color: dataset.raceColor || '',
    remoteEdit: dataset.raceRemoteEdit === 'true',
    revision: dataset.raceRevision || '',
    acknowledgments: dataset.raceAcks || '',
    pathD,
  };
};

const waitForConvergence = (pageA, pageB) => waitUntil(
  'the two materialized clients to converge',
  async () => {
    const [a, b] = await Promise.all([readState(pageA), readState(pageB)]);
    return { a, b };
  },
  ({ a, b }) => JSON.stringify(a) === JSON.stringify(b),
);

const waitForExactAckSettlement = (page) => waitUntil(
  'preview settlement behind the exact mutation acknowledgment',
  async () => {
    const root = page.locator('[data-eraser-race-harness="true"]');
    return root.evaluate((element) => ({
      preview: element.dataset.racePreviewActive,
      committed: element.dataset.raceEraseCommitted,
      settledWithAck: element.dataset.raceSettledWithAck,
      revision: element.dataset.raceRevision || '',
      acknowledgments: element.dataset.raceAcks || '',
    }));
  },
  (value) => (
    value.preview === 'false'
    && value.committed === 'true'
    && value.settledWithAck === 'true'
    && value.revision.length > 0
    && value.acknowledgments === value.revision
  ),
);

const assertEventOrder = (events, action) => {
  const ordered = [
    'a-pointer-down',
    'a-preview-start',
    `remote-${action}-applied`,
    'a-pointer-up',
    'a-erase-committed',
    'a-preview-settled',
  ];
  let previousIndex = -1;
  for (const type of ordered) {
    const index = events.indexOf(type);
    assert.ok(index > previousIndex, `${type} must follow ${ordered[Math.max(0, ordered.indexOf(type) - 1)]}`);
    previousIndex = index;
  }
};

const assertActionState = (action, state) => {
  if (action === 'delete') {
    assert.equal(state.present, false, 'remote delete must remain deleted');
    assert.equal(state.pathD, null, 'remote delete must not leave SVG geometry');
    return;
  }

  assert.equal(state.present, true, `${action} race must retain the rebased survivor`);
  assert.equal(state.color, '#2563eb', `${action} race must retain the remote blue style`);
  assert.equal(state.remoteEdit, true, `${action} race must retain remote metadata`);
  assert.ok(state.revision, `${action} race must publish a mutation revision`);
  assert.equal(
    state.acknowledgments,
    state.revision,
    `${action} race must expose the exact current mutation acknowledgment`,
  );

  const minX = Number(state.minX);
  const maxX = Number(state.maxX);
  assert.ok(Number.isFinite(minX) && Number.isFinite(maxX), `${action} survivor must have finite bounds`);
  assert.ok(maxX > minX, `${action} survivor must retain non-empty geometry`);
  if (action === 'move') {
    assert.ok(minX >= 115, `remote move must shift survivor right; received minX=${minX}`);
  } else {
    assert.ok(minX < 60, `style-only edit must not shift survivor; received minX=${minX}`);
  }
};

const runScenario = async (browser, action) => {
  const context = await browser.newContext();
  const errors = [];
  const session = `browser-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let pageA;
  let pageB;

  try {
    pageB = await openClient(context, session, 'b', errors, `${action}:B`);
    pageA = await openClient(context, session, 'a', errors, `${action}:A`);

    await pageA.locator(`[data-arm-action="${action}"]`).click();
    const surface = pageA.locator('[data-annotation-real-surface="1"]');
    const box = await surface.boundingBox();
    assert.ok(box, 'real mounted eraser surface must have a bounding box');

    const start = {
      x: box.x + box.width * 0.40,
      y: box.y + box.height * 0.50,
    };
    await pageA.mouse.move(start.x, start.y);
    await pageA.mouse.down();
    await pageA.mouse.move(start.x + 28, start.y, { steps: 3 });

    await waitUntil(
      'mounted carved preview to become active',
      () => pageA.locator('[data-eraser-race-harness]').getAttribute('data-race-preview-active'),
      (value) => value === 'true',
    );
    await waitForEvent(pageB, `b-${action}-committed`);
    const heldEvents = await waitForEvent(pageA, `remote-${action}-applied`);
    assert.equal(
      heldEvents.includes('a-pointer-up'),
      false,
      'remote mutation must arrive while client A still holds the eraser pointer',
    );
    assert.equal(
      await pageA.locator('[data-eraser-race-harness]').getAttribute('data-race-preview-active'),
      'true',
      'preview must remain mounted until pointer release and durable acknowledgment',
    );

    await pageA.mouse.up();

    if (action === 'delete') {
      await waitUntil(
        'remote delete to settle without resurrection',
        async () => {
          const root = pageA.locator('[data-eraser-race-harness]');
          return root.evaluate((element) => ({
            present: element.dataset.raceObjectPresent,
            preview: element.dataset.racePreviewActive,
          }));
        },
        (value) => value.present === 'false' && value.preview === 'false',
      );
    } else {
      await waitForExactAckSettlement(pageA);
    }

    const { a, b } = await waitForConvergence(pageA, pageB);
    assert.deepEqual(a, b, `${action} race clients must materialize exactly the same SVG state`);
    assertActionState(action, a);

    const finalEvents = await readEvents(pageA);
    if (action === 'delete') {
      const remoteIndex = finalEvents.indexOf('remote-delete-applied');
      const pointerUpIndex = finalEvents.indexOf('a-pointer-up');
      assert.ok(remoteIndex !== -1 && pointerUpIndex > remoteIndex, 'delete must arrive before pointer-up');
    } else {
      assertEventOrder(finalEvents, action);
    }

    const durableState = structuredClone(a);
    await Promise.all([pageA.close(), pageB.close()]);
    pageA = null;
    pageB = null;

    const coldPage = await openClient(context, session, 'b', errors, `${action}:cold`);
    const coldState = await waitUntil(
      `${action} cold reload to reproduce the durable state`,
      () => readState(coldPage),
      (value) => JSON.stringify(value) === JSON.stringify(durableState),
    );
    assert.deepEqual(coldState, durableState, `${action} cold reload must be exact`);
    assertActionState(action, coldState);
    await coldPage.close();

    assert.deepEqual(errors, [], `browser errors during ${action} scenario`);
    console.log(`[eraser-race-browser] ${action}: converged + exact ack + cold reload`);
  } finally {
    await pageA?.close().catch(() => {});
    await pageB?.close().catch(() => {});
    await context.close();
  }
};

let browser;
let failed = false;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  for (const action of ['edit', 'move', 'delete']) {
    await runScenario(browser, action);
  }
  console.log('[eraser-race-browser] all mounted two-client races verified');
} catch (error) {
  failed = true;
  console.error(error);
  if (serverOutput.length) {
    console.error('\n[Vite output]\n' + serverOutput.join(''));
  }
} finally {
  await browser?.close().catch(() => {});
  if (server.exitCode == null && server.signalCode == null) {
    server.kill('SIGTERM');
  }
}

if (failed) process.exitCode = 1;
