import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');

test('Android manifest declares survey media capture permissions', () => {
  for (const perm of ['CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS']) {
    assert.match(manifest, new RegExp(`<uses-permission android:name="android\\.permission\\.${perm}" />`));
  }
  // Optional hardware so devices without a camera/mic can still install.
  assert.match(manifest, /android\.hardware\.camera" android:required="false"/);
  assert.match(manifest, /android\.hardware\.microphone" android:required="false"/);
});
