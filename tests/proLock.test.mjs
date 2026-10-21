// Pro lock (src/utils/proLock.js): behind the 'pro-lock' flag, Free plan users
// are stopped at the Pro features on the pricing page. Flag off: nothing locks.
// Native apps: the prompt never offers an upgrade.
import assert from 'node:assert/strict';
import test from 'node:test';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import {
  PRO_LOCK_FEATURES, PRO_LOCK_FLAG, blockIfProLocked, isNativeApp, isProLocked, proLockPrompt,
} from '../src/utils/proLock.js';

const FEATURES = Object.keys(PRO_LOCK_FEATURES);

test('pro lock: the flag is registered', () => {
  assert.equal(PRO_LOCK_FLAG, 'pro-lock');
  assert.equal(FEATURE_FLAGS['pro-lock'].label, 'Lock Pro features for Free plan');
  assert.deepEqual(FEATURES.sort(), ['excel', 'onedrive', 'regions', 'survey']);
});

test('pro lock: flag off never locks, for any plan', () => {
  for (const feature of FEATURES) {
    for (const tier of ['free', undefined, null, 'pro', 'enterprise', 'developer']) {
      assert.equal(isProLocked(feature, tier, { flagOn: false }), false, `${feature}/${tier}`);
    }
  }
});

test('pro lock: flag off by default in a plain environment', () => {
  // No localStorage and no build env in node: the flag reads as off.
  assert.equal(isProLocked('survey', 'free'), false);
});

test('pro lock: flag on locks every Pro feature for Free', () => {
  for (const feature of FEATURES) {
    assert.equal(isProLocked(feature, 'free', { flagOn: true }), true, feature);
    // A missing plan is treated as Free.
    assert.equal(isProLocked(feature, undefined, { flagOn: true }), true, feature);
  }
});

test('pro lock: flag on leaves paid plans alone', () => {
  for (const feature of FEATURES) {
    for (const tier of ['pro', 'enterprise', 'developer']) {
      assert.equal(isProLocked(feature, tier, { flagOn: true }), false, `${feature}/${tier}`);
    }
  }
});

test('pro lock: unknown features never lock', () => {
  assert.equal(isProLocked('pdf_viewer', 'free', { flagOn: true }), false);
});

test('pro lock: web prompt offers Upgrade in plain words', () => {
  const prompt = proLockPrompt('excel', { native: false });
  assert.equal(prompt.message, 'Excel export is part of Pro. Upgrade to use it.');
  assert.equal(prompt.showUpgrade, true);
  assert.equal(prompt.upgradeLabel, 'Upgrade');
});

test('pro lock: native prompt has no upgrade, no price, no checkout', () => {
  for (const feature of FEATURES) {
    const prompt = proLockPrompt(feature, { native: true });
    assert.equal(prompt.showUpgrade, false, feature);
    assert.equal(prompt.upgradeLabel, undefined, feature);
    assert.match(prompt.message, /(is|are) not available on your plan\.$/);
    assert.doesNotMatch(prompt.message, /upgrade|\$|price|checkout|pro\b/i, feature);
  }
});

test('pro lock: native app detection', () => {
  assert.equal(isNativeApp(null), false);
  assert.equal(isNativeApp({ location: { search: '' } }), false);
  assert.equal(isNativeApp({ Capacitor: { isNativePlatform: () => true }, location: { search: '' } }), true);
  assert.equal(isNativeApp({ Capacitor: { isNativePlatform: () => false }, location: { search: '' } }), false);
  assert.equal(isNativeApp({ location: { search: '?nativeShell=capacitor' } }), true);
  assert.equal(isNativeApp({ location: { search: '?nativeShell=expo' } }), true);
});

test('pro lock: blockIfProLocked shows the prompt only when locked', () => {
  const seen = [];
  const prevWindow = globalThis.window;
  globalThis.window = { dispatchEvent: (event) => { seen.push(event.detail); return true; } };
  try {
    const onUpgrade = () => {};
    assert.equal(blockIfProLocked('survey', 'free', { flagOn: false, native: false, onUpgrade }), false);
    assert.equal(blockIfProLocked('survey', 'pro', { flagOn: true, native: false, onUpgrade }), false);
    assert.equal(seen.length, 0);

    assert.equal(blockIfProLocked('survey', 'free', { flagOn: true, native: false, onUpgrade }), true);
    assert.equal(seen[0].message, 'Survey tools are part of Pro. Upgrade to use them.');
    assert.equal(seen[0].action.label, 'Upgrade');
    assert.equal(seen[0].action.onClick, onUpgrade);

    assert.equal(blockIfProLocked('onedrive', 'free', { flagOn: true, native: true, onUpgrade }), true);
    assert.equal(seen[1].message, 'OneDrive is not available on your plan.');
    assert.equal(seen[1].action, undefined);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});
