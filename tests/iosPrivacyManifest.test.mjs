import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('iOS privacy manifest declares no tracking and the required-reason APIs', () => {
  const manifest = read('ios/App/App/PrivacyInfo.xcprivacy');
  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  for (const type of ['EmailAddress', 'Name', 'UserID', 'PhotosorVideos', 'AudioData', 'OtherUserContent', 'ProductInteraction']) {
    assert.ok(manifest.includes(`NSPrivacyCollectedDataType${type}<`), type);
  }
  assert.doesNotMatch(manifest, /<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<true\/>/);
  assert.match(manifest, /NSPrivacyAccessedAPICategoryUserDefaults<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>\s*<string>CA92\.1/);
  assert.match(manifest, /NSPrivacyAccessedAPICategoryFileTimestamp<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>\s*<string>C617\.1/);
});

test('PrivacyInfo.xcprivacy is bundled by the App target', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.match(pbx, /A11000000000000000000010 \/\* PrivacyInfo\.xcprivacy \*\/ = \{isa = PBXFileReference;/);
  const resources = pbx.match(/504EC3021FED79650016851F \/\* Resources \*\/ = \{[\s\S]*?\};/)[0];
  assert.match(resources, /A11000000000000000000011 \/\* PrivacyInfo\.xcprivacy in Resources \*\//);
});
