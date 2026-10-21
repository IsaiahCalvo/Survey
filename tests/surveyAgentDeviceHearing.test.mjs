import test from 'node:test';
import assert from 'node:assert/strict';
import { isSureHearing, startDeviceHearing } from '../src/agent/deviceHearing.js';

function fakeRecognition() {
  const made = [];
  class Rec {
    constructor() { made.push(this); this.started = 0; }
    start() { this.started += 1; }
    abort() { this.aborted = true; }
    say(text, confidence) {
      const r = [{ transcript: text, confidence }];
      r.isFinal = true;
      this.onresult({ resultIndex: 0, results: [r] });
    }
  }
  return { Rec, made };
}

test('sure means words and no low confidence; 0 means no score given', () => {
  assert.equal(isSureHearing({ text: 'D 117 power no', confidence: 0.92 }), true);
  assert.equal(isSureHearing({ text: 'D 117 power no', confidence: 0 }), true);
  assert.equal(isSureHearing({ text: 'the one seven', confidence: 0.41 }), false);
  assert.equal(isSureHearing({ text: '  ', confidence: 0.99 }), false);
  assert.equal(isSureHearing(null), false);
});

test('words heard during a clip are used; earlier words (the agent talking) are dropped', async () => {
  let now = 10_000;
  const { Rec, made } = fakeRecognition();
  const hearing = startDeviceHearing({ Recognition: Rec, now: () => now, lang: 'en-US' });
  assert.equal(made[0].lang, 'en-US');
  assert.equal(made[0].continuous, true);
  made[0].say('stale words', 0.9); // at 10 000, long before the clip
  now = 20_000;
  made[0].say('D 117 card reader', 0.9);
  now = 20_300;
  made[0].say('installed', 0.8);
  const heard = await hearing.heardFor(20_500, 1500);
  assert.deepEqual(heard, { text: 'D 117 card reader installed', confidence: 0.8 });
  hearing.stop();
  assert.equal(made[0].aborted, true);
});

test('waits a moment for words that land after the clip, and gives up after', async () => {
  const { Rec, made } = fakeRecognition();
  const hearing = startDeviceHearing({ Recognition: Rec });
  const end = Date.now();
  const pending = hearing.heardFor(end, 1000);
  setTimeout(() => made[0].say('no D 118', 0.95), 50);
  assert.deepEqual(await pending, { text: 'no D 118', confidence: 0.95 });
  // Nothing heard: it gives up (the wait ends 1.2 s after the clip ended).
  assert.equal(await hearing.heardFor(Date.now() - 1100, 500), null);
  hearing.stop();
});

test('restarts when the engine stops on its own, and stays off after a fatal error', async () => {
  const { Rec, made } = fakeRecognition();
  const hearing = startDeviceHearing({ Recognition: Rec });
  made[0].onend();
  assert.equal(made.length, 2, 'started again');
  const pending = hearing.heardFor(Date.now(), 500);
  made[1].onerror({ error: 'network' });
  assert.equal(await pending, null);
  assert.equal(hearing.available, false);
  made[1].onend();
  assert.equal(made.length, 2, 'not started again once broken');
  assert.equal(await hearing.heardFor(Date.now(), 500), null);
});

test('no recognition on this device: no hearing at all', () => {
  assert.equal(startDeviceHearing({ Recognition: null }), null);
});

test('only desktop browsers share the mic with the device recognizer', async () => {
  const { sharesMicSafely } = await import('../src/agent/deviceHearing.js');
  assert.equal(sharesMicSafely({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0', maxTouchPoints: 0 }), true);
  assert.equal(sharesMicSafely({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 0 }), true);
  assert.equal(sharesMicSafely({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 5 }), false, 'iPad');
  assert.equal(sharesMicSafely({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 }), false);
  assert.equal(sharesMicSafely({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/141.0 Mobile', maxTouchPoints: 5 }), false);
});
