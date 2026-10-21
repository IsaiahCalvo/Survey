import test from 'node:test';
import assert from 'node:assert/strict';
import { isAvailable, requestPermission, start, errorCode } from '../src/mobile/nativeSpeech.js';

test('outside the native app native speech reports unavailable', async () => {
  assert.equal(await isAvailable(), false);
  assert.equal(await requestPermission(), 'denied');
  const codes = [];
  await assert.rejects(start({ onError: (c) => codes.push(c) }), { code: 'unavailable' });
  assert.deepEqual(codes, ['unavailable']);
});

test('plugin errors map to the codes hands-free acts on', () => {
  assert.equal(errorCode(new Error('Missing permission')), 'not-allowed');
  assert.equal(errorCode('Speech recognition not available'), 'unavailable');
  assert.equal(errorCode('Language not supported'), 'language-not-supported');
  assert.equal(errorCode("Didn't understand, please try again."), 'no-speech');
  assert.equal(errorCode('Something odd'), 'error');
});
