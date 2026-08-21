import { test, expect, _electron as electron } from '@playwright/test';

// UL-03 / P-03 leftover: File → Open PDF IPC against unpackaged Electron + Vite 5173.
// Stubs the native file dialog so this does not hang on showOpenDialog.

let electronApp = null;

test.afterEach(async () => {
  if (!electronApp) return;
  const appToClose = electronApp;
  electronApp = null;
  await appToClose.evaluate(({ app }) => {
    app.exit(0);
  }).catch(async () => {
    await appToClose.close().catch(() => {});
  });
});

test('File → Open PDF sends menu:open-pdf and hits dialog:openFile', async () => {
  test.setTimeout(90_000);
  const mainLogs = [];

  electronApp = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DEV_PORT: '5173',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  electronApp.process().stdout?.on('data', (chunk) => {
    mainLogs.push(String(chunk));
  });
  electronApp.process().stderr?.on('data', (chunk) => {
    mainLogs.push(String(chunk));
  });

  const page = await electronApp.firstWindow();
  await page.goto('http://localhost:5173/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const result = await electronApp.evaluate(async ({ dialog, Menu }) => {
    let dialogCalls = 0;
    const original = dialog.showOpenDialog.bind(dialog);
    dialog.showOpenDialog = async () => {
      dialogCalls += 1;
      return { canceled: true, filePaths: [] };
    };
    try {
      const menu = Menu.getApplicationMenu();
      const file = menu?.items?.find((item) => item.label === 'File');
      const open = file?.submenu?.items?.find((item) => String(item.label || '').startsWith('Open'));
      if (!open?.click) return { ok: false, reason: 'menu-missing', dialogCalls };
      open.click();
      await new Promise((resolve) => setTimeout(resolve, 800));
      return {
        ok: true,
        label: open.label,
        enabled: open.enabled !== false,
        dialogCalls,
      };
    } finally {
      dialog.showOpenDialog = original;
    }
  });

  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.enabled).toBe(true);
  expect(result.dialogCalls).toBeGreaterThan(0);

  const joined = mainLogs.join('\n');
  expect(
    joined.includes('Open PDF menu clicked, targetWindow alive: true')
    || result.dialogCalls > 0,
  ).toBe(true);
});
