import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { copyTextToClipboard } from '../src/utils/clipboard.js';

test('clipboard reports success only after writeText resolves', async () => {
  let resolveWrite;
  const pending = copyTextToClipboard('safe-link', {
    clipboard: { writeText: () => new Promise((resolve) => { resolveWrite = resolve; }) },
    surface: 'test',
  });

  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  resolveWrite();
  assert.deepEqual(await pending, { ok: true, reason: null });
});

test('clipboard returns bounded failure reasons and never throws', async () => {
  assert.deepEqual(
    await copyTextToClipboard('', { clipboard: { writeText: async () => {} }, surface: 'test' }),
    { ok: false, reason: 'empty' },
  );
  assert.deepEqual(
    await copyTextToClipboard('safe-link', { clipboard: null, surface: 'test' }),
    { ok: false, reason: 'unavailable' },
  );
  assert.deepEqual(
    await copyTextToClipboard('safe-link', {
      clipboard: { writeText: async () => { throw new Error('permission denied: secret'); } },
      surface: 'test',
    }),
    { ok: false, reason: 'denied' },
  );
});

test('share, team, and access surfaces do not report copy success before the shared writer resolves', () => {
  for (const relativePath of [
    '../src/home/ShareModal.jsx',
    '../src/home/ManageTeamModal.jsx',
    '../src/home/AccessManagementModal.jsx',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /copyTextToClipboard/);
    assert.match(source, /result\.ok|copyResult\.ok/);
    assert.match(source, /could not copy/i);
    assert.doesNotMatch(source, /navigator\.clipboard/);
  }
});
