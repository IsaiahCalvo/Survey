import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withUpgradeHint } from '../src/utils/accountPlatform.js';

const web = { Capacitor: { isNativePlatform: () => false } };
const ios = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } };
const android = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } };

test('web keeps the upgrade nudge; the native apps drop it', () => {
  assert.equal(withUpgradeHint('A is part of Pro.', 'Upgrade.', web), 'A is part of Pro. Upgrade.');
  assert.equal(withUpgradeHint('A is part of Pro.', 'Upgrade.', ios), 'A is part of Pro.');
  assert.equal(withUpgradeHint('A is part of Pro.', 'Upgrade.', android), 'A is part of Pro.');
});

test('plan-limit messages shown in the apps carry no bare "upgrade" call to action', () => {
  const files = ['src/PDFViewer.jsx', 'src/hooks/useSubscriptionLimits.js', 'src/services/surveyMediaService.js',
    'src/home/ShareModal.jsx', 'src/home/ManageTeamModal.jsx', 'src/home/InviteAcceptPage.jsx'];
  for (const file of files) {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const line of src.split('\n')) {
      if (/['`][^'`]*\b[Uu]pgrade (to|your)\b/.test(line) || /Please upgrade/.test(line)) {
        assert.match(line, /withUpgradeHint|isPurchaseUiHidden|^\s*:\s*`/, `${file}: ${line.trim()}`);
      }
    }
  }
});
