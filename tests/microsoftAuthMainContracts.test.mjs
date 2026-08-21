// Source contracts for the system-browser Microsoft sign-in migration
// (PLAN.md Amendment 2026-06-08(b) #5). The Electron wiring can't run in unit
// tests, so these tripwires assert the load-bearing connections stay present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const preload = readFileSync(join(root, 'src', 'preload.js'), 'utf8');
const electronMain = readFileSync(join(root, 'src', 'electron-main.js'), 'utf8');
const context = readFileSync(join(root, 'src', 'contexts', 'MSGraphContext.jsx'), 'utf8');
const authMain = readFileSync(join(root, 'src', 'electron', 'msalAuthMain.js'), 'utf8');

test('preload exposes the four narrow msauth APIs (and nothing token-shaped)', () => {
  for (const api of ['microsoftSignIn', 'microsoftGetAccessToken', 'microsoftAuthStatus', 'microsoftSignOut']) {
    assert.match(preload, new RegExp(`${api}:`), `${api} must be exposed on electronAPI`);
  }
});

test('electron-main registers the msauth IPC surface with safeStorage custody', () => {
  assert.match(electronMain, /registerMicrosoftAuthIpc\(\{ ipcMain, app, shell, safeStorage \}\)/);
});

test('sign-in opens the SYSTEM browser, never an embedded window', () => {
  assert.match(authMain, /openBrowser: async \(url\) => \{ await shell\.openExternal\(url\); \}/);
});

test('renderer prefers main-process custody for login, restore, refresh, and logout', () => {
  assert.match(context, /window\.electronAPI\.microsoftSignIn\(\)/);
  assert.match(context, /window\.electronAPI\.microsoftAuthStatus\(\)/);
  assert.match(context, /window\.electronAPI\.microsoftGetAccessToken\(\)/);
  assert.match(context, /window\.electronAPI\.microsoftSignOut\(\)/);
});

test('main-custody path stores a marker row and merges any existing web tokens', () => {
  assert.match(context, /buildConnectionMarkerRow\(\{/);
  assert.match(context, /existingMetadata: existing\?\.metadata/);
  // Desktop still never introduces tokens from the renderer; it only preserves
  // PKCE material already stored by web/mobile (P2-14).
  assert.match(context, /refresh_token: null, \/\/ never present in the renderer on this path/);
});

test('legacy embedded flow is retained as the fallback (web build + unmigrated rows)', () => {
  assert.match(context, /openOAuthWindow/);
  assert.match(electronMain, /ipcMain\.handle\('oauth:openWindow'/);
});
