import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  FAST_SUITE_IDS,
  FULL_APP_COVERAGE,
  NATIVE_SUITE_IDS,
} from '../agent-cli/mobile-annotations/coverage.mjs';

const runner = readFileSync(new URL('../agent-cli/full-app-e2e.mjs', import.meta.url), 'utf8');

test('default fast full-app gate covers every requested mobile product area', () => {
  assert.deepEqual(FAST_SUITE_IDS, [
    'annotations',
    'advanced',
    'advanced-entities',
    'viewer',
    'projects',
    'surveys',
    'hub',
    'stability',
    'contracts',
  ]);

  const defaultCopy = FAST_SUITE_IDS.flatMap((id) => FULL_APP_COVERAGE[id].covers).join(' ');
  for (const phrase of [
    'page crash',
    'pinch',
    'reload persistence',
    'Documents/Projects/Templates',
    'PDF upload',
    'template/module/category/checklist CRUD',
    'signed-out account chrome',
    'sync-status details',
    'first-page readiness timing budget',
  ]) {
    assert.match(defaultCopy, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});

test('real pinch and deep zoom-out are native Simulator lanes, never synthetic browser claims', () => {
  assert.deepEqual(NATIVE_SUITE_IDS, ['native-pinch', 'native-zoomout']);
  assert.equal(FULL_APP_COVERAGE['native-pinch'].proof, 'ios-simulator-xcui');
  assert.equal(FULL_APP_COVERAGE['native-zoomout'].proof, 'ios-simulator-xcui');
  assert.match(runner, /scripts\/test-ios-native-pinch\.mjs/);
  assert.match(runner, /MOBILE_PINCH_ONLY/);
  assert.match(runner, /nativeGestureCertificationIncluded/);
});

test('real-account durability remains fail-closed behind the coordinator lease lane', () => {
  assert.equal(FULL_APP_COVERAGE.durable.proof, 'leased-real-auth');
  assert.equal(FULL_APP_COVERAGE.durable.external, true);
  assert.match(runner, /durable lane must run through scripts\/test-account-lease\.mjs/i);
  assert.match(runner, /durablePersistenceCertified: false/);
});

test('full-app runner uses bounded parallelism and rejects unknown suites', () => {
  assert.match(runner, /--concurrency/);
  assert.match(runner, /Math\.min\(concurrencyArg, suites\.length\)/);
  assert.match(runner, /Unknown suite\(s\)/);
});
