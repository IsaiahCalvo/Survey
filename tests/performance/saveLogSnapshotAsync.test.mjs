import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MAIN_SOURCE = readFileSync(new URL('../../src/electron-main.js', import.meta.url), 'utf8');

function extractSaveSnapshotHandler(source) {
  const start = source.indexOf("ipcMain.handle('logs:saveSnapshot'");
  assert.notEqual(start, -1, 'logs:saveSnapshot handler should exist');
  const nextHandler = source.indexOf('ipcMain.handle(', start + 1);
  return source.slice(start, nextHandler === -1 ? undefined : nextHandler);
}

const HANDLER_SOURCE = extractSaveSnapshotHandler(MAIN_SOURCE);

test('logs:saveSnapshot uses async filesystem operations', () => {
  assert.match(HANDLER_SOURCE, /await fs\.promises\.mkdir\(logsRoot/);
  assert.match(HANDLER_SOURCE, /await Promise\.all\(\[/);
  assert.match(HANDLER_SOURCE, /fs\.promises\.writeFile/);
  assert.match(HANDLER_SOURCE, /await fs\.promises\.readdir/);
  assert.match(HANDLER_SOURCE, /await fs\.promises\.rm/);
});

test('logs:saveSnapshot does not use synchronous filesystem calls', () => {
  assert.doesNotMatch(HANDLER_SOURCE, /\bwriteFileSync\b/);
  assert.doesNotMatch(HANDLER_SOURCE, /\bmkdirSync\b/);
  assert.doesNotMatch(HANDLER_SOURCE, /\breaddirSync\b/);
  assert.doesNotMatch(HANDLER_SOURCE, /\brmSync\b/);
  assert.doesNotMatch(HANDLER_SOURCE, /\bexistsSync\b/);
});
