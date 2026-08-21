import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const context = readFileSync(join(root, 'src', 'contexts', 'MSGraphContext.jsx'), 'utf8');

test('desktop restore merges existing web tokens into the main-custody marker (P2-14)', () => {
  assert.match(context, /existingMetadata: existing\?\.metadata/);
  assert.match(context, /buildConnectionMarkerRow\(\{[\s\S]*existingMetadata:/);
  assert.match(context, /hasLegacyRendererTokens\(storedData\)/);
  assert.match(context, /isMainCustodyRow\(storedData\)/);
});

test('hard token failure compare-before-wipe does not clobber a newer shared row (P2-24)', () => {
  assert.match(context, /shouldAdoptRemoteRefreshToken/);
  assert.match(context, /shouldWipeSharedConnectionRow/);
  assert.match(context, /failedRefreshToken: refreshToken/);
  assert.match(context, /refresh_reason: 'adopted_remote'/);
});

test('desktop launch classifies transient blips separately from reconnect (P2-26)', () => {
  assert.match(context, /interpretMainProcessRestore/);
  assert.match(context, /Microsoft temporarily unreachable/);
  assert.match(context, /addEventListener\('online'/);
  assert.match(context, /decision\.action === 'reconnect'/);
});
