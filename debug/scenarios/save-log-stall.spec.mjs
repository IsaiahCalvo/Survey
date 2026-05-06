import { test, expect, _electron as electron } from '@playwright/test';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSession, finalizeSession, getSessionBaseDir } from '../lib/session.mjs';

let electronApp = null;
let session = null;

async function waitForAppReady(page) {
  await page.locator('.e-pv-viewer-container').waitFor({
    state: 'visible',
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => window.__debugBridge != null && window.pdfOverlayRecorder != null,
    { timeout: 30_000 }
  );
  await page.evaluate(() =>
    window.__debugReady.waitFor('pdfLoaded', { timeout: 30_000 })
  );
}

async function goToPage(page, pageNumber) {
  const pageInput = page.getByRole('textbox', { name: 'Current page' });
  await expect(pageInput).toBeVisible({ timeout: 15_000 });
  await pageInput.click();
  await pageInput.fill(String(pageNumber));
  await pageInput.press('Enter');
  await page.evaluate(() =>
    window.__debugReady.waitFor('ready', { timeout: 30_000 })
  );
}

async function setToolbarZoom(page, zoomLevel) {
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage' });
  await expect(zoomInput).toBeVisible({ timeout: 15_000 });
  await zoomInput.click();
  await zoomInput.fill(String(zoomLevel));
  await zoomInput.press('Enter');
  await page.evaluate(() =>
    window.__debugReady.waitFor('ready', { timeout: 30_000 })
  );
}

test.afterEach(async () => {
  if (electronApp) {
    const appToClose = electronApp;
    electronApp = null;
    await appToClose.evaluate(({ app }) => {
      app.exit(0);
    }).catch(async () => {
      await appToClose.close().catch(() => {});
    });
  }
  if (session?.manifest && session.manifest.result === null) {
    finalizeSession(
      session.sessionDir,
      session.manifest,
      'fail',
      readdirSync(session.sessionDir).map((file) => ({
        type: path.extname(file).toLowerCase() === '.json' ? 'data' : 'unknown',
        path: file,
        description: file,
      }))
    );
  }
});

test('Cmd+Shift+L local snapshot does not stall renderer frames', async () => {
  test.setTimeout(180_000);
  session = createSession('save-log-stall', getSessionBaseDir());

  const consoleLines = [];
  electronApp = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DEV_PORT: '5173',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  const page = await electronApp.firstWindow();
  page.on('console', (msg) => {
    consoleLines.push({ type: msg.type(), text: msg.text() });
  });

  await page.goto('http://localhost:5173/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');
  await waitForAppReady(page);
  await goToPage(page, 6);
  await setToolbarZoom(page, 160);

  await page.evaluate(() => {
    if (Array.isArray(window.__consoleLogBuffer)) {
      window.__consoleLogBuffer.length = 0;
      for (let i = 0; i < 5000; i += 1) {
        window.__consoleLogBuffer.push(
          `[SaveLogStress ${i}] ` + 'diagnostic payload '.repeat(80)
        );
      }
    }

    window.__saveLogFrameProbe = {
      active: true,
      startedAt: performance.now(),
      lastAt: 0,
      maxFrameMs: 0,
      framesOver500: 0,
      framesOver100: 0,
      samples: [],
    };

    const loop = (now) => {
      const probe = window.__saveLogFrameProbe;
      if (!probe?.active) return;
      if (probe.lastAt > 0) {
        const frameMs = now - probe.lastAt;
        probe.maxFrameMs = Math.max(probe.maxFrameMs, frameMs);
        if (frameMs > 500) probe.framesOver500 += 1;
        if (frameMs > 100) probe.framesOver100 += 1;
        if (frameMs > 50) {
          probe.samples.push({
            tMs: Number((now - probe.startedAt).toFixed(1)),
            frameMs: Number(frameMs.toFixed(1)),
          });
        }
      }
      probe.lastAt = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  const savedPromise = page.waitForEvent('console', {
    predicate: (msg) => msg.text().includes('[SaveLog] bulletproof local snapshot saved at'),
    timeout: 45_000,
  });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+L' : 'Control+Shift+L');
  const savedMessage = await savedPromise;
  await page.waitForTimeout(1000);

  const probe = await page.evaluate(() => {
    const current = window.__saveLogFrameProbe || {};
    current.active = false;
    return {
      maxFrameMs: current.maxFrameMs || 0,
      framesOver500: current.framesOver500 || 0,
      framesOver100: current.framesOver100 || 0,
      samples: Array.isArray(current.samples) ? current.samples.slice(0, 40) : [],
    };
  });

  const snapshotDirMatch = savedMessage.text().match(/saved at (.+)$/);
  const snapshotDir = snapshotDirMatch ? snapshotDirMatch[1] : null;
  const artifact = {
    savedMessage: savedMessage.text(),
    snapshotDir,
    probe,
    recentConsole: consoleLines.slice(-40),
  };

  writeFileSync(
    path.join(session.sessionDir, 'save-log-stall.json'),
    JSON.stringify(artifact, null, 2),
    'utf8'
  );

  session.manifest.criteriaResults = {
    snapshotSaved: {
      pass: typeof snapshotDir === 'string' && snapshotDir.length > 0,
      snapshotDir,
    },
    noSaveLogFrameOver500: {
      pass: Number(probe.framesOver500) === 0 && Number(probe.maxFrameMs) < 500,
      maxFrameMs: probe.maxFrameMs,
      framesOver500: probe.framesOver500,
    },
  };

  finalizeSession(
    session.sessionDir,
    session.manifest,
    'pass',
    readdirSync(session.sessionDir).map((file) => ({
      type: path.extname(file).toLowerCase() === '.json' ? 'data' : 'unknown',
      path: file,
      description: file,
    }))
  );
  session.manifest = null;

  expect(snapshotDir, 'SaveLog should produce a local snapshot folder').toBeTruthy();
  expect(probe.framesOver500, `SaveLog frame probe: ${JSON.stringify(probe)}`).toBe(0);
  expect(probe.maxFrameMs, `SaveLog frame probe: ${JSON.stringify(probe)}`).toBeLessThan(500);
});
