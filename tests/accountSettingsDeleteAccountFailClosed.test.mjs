import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCOUNT_DELETION_CONFIRMATION,
  isAccountDeletionConfirmation,
  accountDeletionUserMessage,
  resolveAccountDeletionResponse,
} from '../src/utils/accountPlatform.js';

// Live proof: debug/scenarios/e2e-account-settings-delete-account-failclosed.spec.mjs
// Leftover-18 UL-16 Account Settings Delete account permanently fail-closed.
// Distinct from leftover18-unblock wipe click + Settings General Cancel.
// Does not invent a wipe backend or .env.local.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('HubPreview / DevTestRoute fail-close wipe and do not invent delete-account', () => {
  const preview = read('src/home/HubPreview.jsx');
  const devTest = read('src/DevTestRoute.jsx');
  const settings = read('src/components/AccountSettings.jsx');
  const platform = read('src/utils/accountPlatform.js');
  const auth = read('src/contexts/AuthContext.jsx');

  assert.match(preview, /deleteAccount: previewBlocked\('delete accounts'\)/);
  assert.match(preview, /throw new Error\(`Preview cannot \$\{action\}\.`\)/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /functions\.invoke\('delete-account'/);
  assert.doesNotMatch(preview, /requestAccountDeletion/);

  assert.match(devTest, /deleteAccount: previewBlocked\('delete accounts'\)/);
  assert.match(devTest, /throw new Error\(`Test PDF cannot \$\{action\}\.`\)/);
  assert.doesNotMatch(devTest, /functions\.invoke\('delete-account'/);

  assert.match(settings, /await deleteAccount\(\)/);
  assert.match(settings, /Delete account permanently/);
  assert.match(settings, /isAccountDeletionConfirmation\(deleteConfirmText\)/);
  assert.match(settings, /disabled=\{loading \|\| !isAccountDeletionConfirmation\(deleteConfirmText\)\}/);
  assert.match(settings, /accountDeletionUserMessage\(\{/);
  const wipeCatch = settings.indexOf('accountDeletionUserMessage({');
  const wipeCall = settings.indexOf('await deleteAccount()');
  assert.ok(wipeCall > 0 && wipeCatch > wipeCall, 'wipe must surface the previewBlocked reason');

  assert.equal(ACCOUNT_DELETION_CONFIRMATION, 'DELETE');
  assert.match(platform, /invoke\('delete-account'/);
  assert.match(auth, /requestAccountDeletion\(supabase\.functions\)/);
  assert.match(auth, /window\.location\.reload\(\)/);
  assert.ok(
    auth.indexOf('requestAccountDeletion') < auth.indexOf('window.location.reload()'),
    'live wipe reload must not run before the deletion request',
  );
});

test('DELETE is exact after trim; wrong strings stay disabled; blocked wipe keeps the account', () => {
  assert.equal(isAccountDeletionConfirmation('delete'), false);
  assert.equal(isAccountDeletionConfirmation('Delete'), false);
  assert.equal(isAccountDeletionConfirmation('DELETES'), false);
  assert.equal(isAccountDeletionConfirmation(''), false);
  assert.equal(isAccountDeletionConfirmation(' DELETE '), true);
  assert.equal(isAccountDeletionConfirmation(ACCOUNT_DELETION_CONFIRMATION), true);

  assert.equal(
    accountDeletionUserMessage({ message: 'Preview cannot delete accounts.' }),
    'Preview cannot delete accounts.',
  );
  assert.match(
    accountDeletionUserMessage({
      code: 'ACCOUNT_HAS_COLLABORATORS',
      documents: [{ name: 'Package 2 — Rev 4 — IC.pdf' }],
    }),
    /still owns 1 shared document/,
  );

  const blocked = resolveAccountDeletionResponse(
    { error: 'Preview cannot delete accounts.' },
    null,
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.message, 'Preview cannot delete accounts.');
  assert.notEqual(blocked.ok, true);

  const done = resolveAccountDeletionResponse({ deleted: true }, null);
  assert.equal(done.ok, true);
});

test('Delete-account live spec clicks Confirm and does not invent a wipe', () => {
  const live = read('debug/scenarios/e2e-account-settings-delete-account-failclosed.spec.mjs');
  const leftover = read('debug/scenarios/e2e-leftover18-save-export.spec.mjs');
  const general = read('debug/scenarios/e2e-account-settings-general.spec.mjs');
  const connect = read('debug/scenarios/e2e-account-settings-connect-failclosed.spec.mjs');
  const trial = read('debug/scenarios/e2e-account-settings-start-trial-failclosed.spec.mjs');
  const leftoverNode = read('tests/leftover18FailClosed.test.mjs');

  assert.match(live, /ACCOUNT_SETTINGS_DELETE_ACCOUNT_FAILCLOSED_PROOF/);
  assert.match(live, /Delete account permanently/);
  assert.match(live, /Preview cannot delete accounts/);
  assert.match(live, /Test PDF cannot delete accounts/);
  assert.match(live, /empty=1/);
  assert.match(live, /guest=1/);
  assert.match(live, /testPdf=/);
  assert.match(live, /width: 390/);
  assert.match(live, /WIPE_FN/);
  assert.match(live, /Isaiah Calvo/);
  assert.match(live, /connectIsolated/);
  assert.match(live, /startTrialIsolated/);
  assert.doesNotMatch(live, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(live, /setInputFiles/);
  assert.doesNotMatch(live, /cs_test_invented/);
  assert.doesNotMatch(live, /getByRole\('button', \{ name: TRIAL \}\)\.click\(/);
  assert.doesNotMatch(live, /getByRole\('button', \{ name: 'Connect', exact: true \}\)[\s\S]{0,40}\.click\(/);

  assert.match(leftover, /Preview cannot delete accounts/);
  assert.match(general, /deleteConfirmLocal|Delete account permanently/);
  assert.doesNotMatch(general, /ACCOUNT_SETTINGS_DELETE_ACCOUNT_FAILCLOSED_PROOF/);
  assert.doesNotMatch(connect, /ACCOUNT_SETTINGS_DELETE_ACCOUNT_FAILCLOSED_PROOF/);
  assert.doesNotMatch(trial, /ACCOUNT_SETTINGS_DELETE_ACCOUNT_FAILCLOSED_PROOF/);
  assert.match(leftoverNode, /UL-13 \/ UL-16/);
});

test('96 unique inventory IDs still have proven receipts', () => {
  const inventory = read('.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md');
  const unique = inventory
    .split('## All unique IDs (96)')[1]
    .split('### P2-34 / P2-35 sub-defects')[0];
  const ids = [];
  for (const line of unique.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const head = cells[1];
    const singles = head.match(/^(KB-\d+|P1-\d+|P2-\d+)$/);
    if (singles) {
      ids.push(singles[1]);
      continue;
    }
    const pair = head.match(/^(P1-\d+) \/ (P1-\d+)$/);
    if (pair) {
      ids.push(pair[1], pair[2]);
    }
  }
  assert.equal(ids.length, 96, `expected 96 unique IDs, got ${ids.length}: ${ids.join(',')}`);
  assert.equal(new Set(ids).size, 96);
  const unproven = [];
  for (const line of unique.split('\n')) {
    if (!/^\| (KB-\d+|P1-\d+|P2-\d+)/.test(line)) continue;
    if (!line.includes('**proven**')) unproven.push(line.slice(0, 80));
  }
  assert.deepEqual(unproven, []);
});
