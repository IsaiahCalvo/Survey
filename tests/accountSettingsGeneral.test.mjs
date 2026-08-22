import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { passwordMeetsRequirements } from '../src/components/authFlow.js';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  describeProfileSaveOutcome,
  isAccountDeletionConfirmation,
  passwordChangeKind,
  validatePasswordForm,
} from '../src/utils/accountPlatform.js';

// Live proof: debug/scenarios/e2e-account-settings-general.spec.mjs
// Unique leftover after the A-04 account-menu hunt: General pane contents.
// Connected services + Subscription stay leftover-18 host-gated UI.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const mockHubPreviewUser = {
  id: 'dev-hubpreview-user',
  email: 'dev-hubpreview@example.invalid',
  user_metadata: {
    first_name: 'Isaiah',
    last_name: 'Calvo',
    full_name: 'Isaiah Calvo',
  },
};

test('General pane is local chrome: display / edit / Cancel / Save / no theme', () => {
  const settings = read('src/components/AccountSettings.jsx');
  const preview = read('src/home/HubPreview.jsx');
  const css = read('src/components/AccountSettings.css');

  assert.match(settings, /setActiveTab\('general'\)/);
  assert.match(settings, /Account Settings ALWAYS opens on General/);
  assert.match(settings, /activeTab === 'general'/);
  assert.match(settings, /Profile information/);
  assert.match(settings, /Edit profile/);
  assert.match(settings, /Email cannot be changed/);
  assert.match(settings, /handleCancelEdit/);
  assert.match(settings, /setFirstName\(user\?\.user_metadata\?\.first_name \|\| ''\)/);
  assert.match(settings, /Save changes/);
  assert.match(settings, /describeProfileSaveOutcome\(\{/);
  assert.match(settings, /setError\(outcome\.message\)/);
  const platform = read('src/utils/accountPlatform.js');
  assert.match(platform, /No changes detected/);
  assert.doesNotMatch(settings, /Dark mode/);
  assert.doesNotMatch(settings, /Appearance/);
  assert.doesNotMatch(settings, /type="checkbox"/);
  assert.doesNotMatch(settings, /role="switch"/);

  assert.match(preview, /first_name: 'Isaiah'/);
  assert.match(preview, /last_name: 'Calvo'/);
  assert.match(preview, /email: 'dev-hubpreview@example.invalid'/);
  assert.match(preview, /updateProfile: previewBlocked\('save profile changes'\)/);
  assert.match(preview, /resetPassword: previewBlocked\('send password reset emails'\)/);
  assert.match(preview, /signOut: previewBlocked\('sign out'\)/);
  assert.match(preview, /deleteAccount: previewBlocked\('delete accounts'\)/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);

  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /\.account-settings-sidebar \{\s*width: 100%;\s*flex-direction: row;/);
});

test('General save / password / DELETE gates stay local; cloud persist is leftover-18', () => {
  assert.equal(passwordChangeKind(mockHubPreviewUser), 'set');
  assert.equal(
    validatePasswordForm({
      kind: 'set',
      newPassword: '',
      confirmPassword: '',
    }).changing,
    false,
  );
  assert.equal(
    validatePasswordForm({
      kind: 'set',
      newPassword: 'PreviewPass1!',
      confirmPassword: 'PreviewPass2!',
      passwordMeetsRequirements,
    }).error,
    'New passwords do not match',
  );
  assert.equal(
    validatePasswordForm({
      kind: 'set',
      newPassword: 'short',
      confirmPassword: 'short',
      passwordMeetsRequirements,
    }).error,
    'Password does not meet requirements',
  );

  assert.equal(describeProfileSaveOutcome({}).kind, 'noop');
  assert.equal(describeProfileSaveOutcome({}).message, 'No changes detected');
  assert.deepEqual(
    describeProfileSaveOutcome({
      attemptedName: true,
      nameError: 'Preview cannot save profile changes.',
    }),
    {
      kind: 'error',
      message: 'Preview cannot save profile changes.',
      changedFields: [],
    },
  );

  assert.equal(isAccountDeletionConfirmation('delete'), false);
  assert.equal(isAccountDeletionConfirmation(ACCOUNT_DELETION_CONFIRMATION), true);

  const settings = read('src/components/AccountSettings.jsx');
  assert.match(settings, /passwordChangeKind\(user\) === 'set' \? 'Set a password'/);
  assert.match(settings, /Email me a link to set a password/);
  assert.match(settings, /Preview cannot sign out|err\.message \|\| 'Failed to sign out'/);
  assert.match(settings, /isAccountDeletionConfirmation\(deleteConfirmText\)/);
});

test('Connected services + Subscription are leftover-18; General is not the A-04 menu hunt', () => {
  const settings = read('src/components/AccountSettings.jsx');
  const hunt = read('debug/scenarios/e2e-a04-account-menu-hunt.spec.mjs');
  const helper = read('debug/scenarios/e2e-helper-only-live.spec.mjs');
  const general = read('debug/scenarios/e2e-account-settings-general.spec.mjs');

  assert.match(settings, /Connected services/);
  assert.match(settings, /msLogin\(\)/);
  assert.match(settings, /linkGoogleIdentity\(\)/);
  assert.match(settings, /StripeCheckout/);
  assert.match(settings, /Start 7-day trial/);
  assert.match(settings, /<UsageIndicator \/>/);

  assert.match(hunt, /Do NOT replay the dedicated A-04/);
  assert.match(helper, /passwordMismatch: true/);
  assert.doesNotMatch(helper, /No changes detected/);
  assert.doesNotMatch(helper, /Preview cannot save profile changes/);

  assert.match(general, /ACCOUNT_SETTINGS_GENERAL_PROOF/);
  assert.match(general, /No changes detected/);
  assert.match(general, /Preview cannot save profile changes/);
  assert.match(general, /stripeNotClicked/);
  assert.match(general, /msalNotClicked/);
  assert.match(general, /guestNoSettings/);
  assert.doesNotMatch(general, /Sign out of Survey\?/);
  assert.doesNotMatch(general, /profile-signout-copy/);
});
