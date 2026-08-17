import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCli } from '../agent-cli/mobile-annotations/cli.mjs';

test('mobile annotation harness has a deterministic first-page readiness budget', () => {
  assert.equal(parseCli([]).viewerReadyBudgetMs, 15_000);
  assert.equal(
    parseCli(['--viewer-ready-budget-ms=9000', '--tool=pen']).viewerReadyBudgetMs,
    9_000,
  );
  assert.throws(
    () => parseCli(['--viewer-ready-budget-ms=0']),
    /positive number/,
  );
});
