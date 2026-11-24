// The on-device voice (Nightly flag survey-agent-device-voice): replies use it
// first when it is ready, fall back to the cloud voice when it fails, and a
// slow device waits just long enough to play a reply through without gaps.
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; }
  resume() { return Promise.resolve(); }
  decodeAudioData() { return Promise.resolve({ duration: 1 }); }
  createBufferSource() {
    return { connect() {}, start() { setTimeout(() => this.onended?.(), 0); }, stop() {} };
  }
}

globalThis.window = { AudioContext: FakeAudioContext, localStorage: { getItem: () => null, setItem() {} } };
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

const { createAgentVoice, unlockPlayback } = await import('../src/agent/agentVoice.js');
const { readyToStart } = await import('../src/agent/pocketVoice/pocketVoice.js');
const { MODEL_FILES, VOICE_FILE, VOICE_CREDIT } = await import('../src/agent/pocketVoice/pocketModelFiles.js');

unlockPlayback();

const fakePocket = (state, fail = false) => {
  const said = [];
  return {
    state,
    said,
    stopped: 0,
    speak(words) { said.push(words); return fail ? Promise.reject(new Error('worker died')) : Promise.resolve(); },
    stop() { this.stopped += 1; },
  };
};

test('a ready on-device voice speaks the reply and the cloud is not called', async () => {
  const calls = [];
  const pocket = fakePocket('ready');
  const voice = createAgentVoice({ call: async (body) => { calls.push(body); return { audio: '' }; }, serverVoice: true, deviceVoice: pocket });
  await voice.speak('Marked reader 1409 on page 8.');
  assert.deepEqual(pocket.said, ['Marked reader 1409 on page 8.']);
  assert.equal(calls.length, 0);
});

test('the on-device voice also speaks words that must come out with no signal', async () => {
  const pocket = fakePocket('ready');
  const voice = createAgentVoice({ call: async () => ({}), deviceVoice: pocket });
  await voice.speak('Saved on this device.', { here: true });
  assert.equal(pocket.said.length, 1);
});

test('when the on-device voice fails, the cloud voice speaks instead', async () => {
  const calls = [];
  const pocket = fakePocket('ready', true);
  const voice = createAgentVoice({ call: async (body) => { calls.push(body.action); return { audio: '' }; }, serverVoice: true, deviceVoice: pocket });
  await voice.speak('It is now fully installed.');
  assert.equal(pocket.said.length, 1);
  assert.deepEqual(calls, ['speak']);
});

test('while the on-device voice is still downloading, the cloud voice speaks', async () => {
  const calls = [];
  const pocket = fakePocket('loading');
  const voice = createAgentVoice({ call: async (body) => { calls.push(body.action); return { audio: '' }; }, serverVoice: true, deviceVoice: pocket });
  await voice.speak('Which one should I mark?');
  assert.equal(pocket.said.length, 0);
  assert.deepEqual(calls, ['speak']);
});

test('other languages are not sent to the English on-device voice', async () => {
  const pocket = fakePocket('ready');
  const voice = createAgentVoice({ call: async () => ({}), deviceVoice: pocket });
  await voice.speak('Marqué el lector.', { locale: 'es-ES' });
  assert.equal(pocket.said.length, 0);
});

test('stopping the agent voice stops the on-device voice too', () => {
  const pocket = fakePocket('ready');
  const voice = createAgentVoice({ call: async () => ({}), deviceVoice: pocket });
  voice.stop();
  assert.equal(pocket.stopped, 1);
  voice.setDeviceVoice(null);
  voice.stop();
  assert.equal(pocket.stopped, 1);
});

test('a fast device starts playing on the second piece; a slow one waits until the rest will arrive in time', () => {
  const now = performance.now();
  const job = (made, secondsSinceFirst, expected) => ({
    pending: [{}, {}], firstAt: now - secondsSinceFirst * 1000, firstDuration: 0.24, produced: made, expected,
  });
  // 1.2 s of audio made in 0.7 s after the first piece: faster than real time.
  assert.equal(readyToStart(job(1.44, 0.7, 8)), true);
  // Half real time with 6 s still to make: playing now would run dry.
  assert.equal(readyToStart(job(1.24, 2, 8)), false);
  // Half real time, 4.2 s made, 3.8 s left takes 7.6 s: still too soon.
  assert.equal(readyToStart(job(4.2, 7.9, 8)), false);
  // Half real time, 5.4 s made, 2.6 s left takes about 5 s: safe to start.
  assert.equal(readyToStart(job(5.4, 10.3, 8)), true);
  // One piece only: wait for a second to measure the speed.
  assert.equal(readyToStart({ ...job(0.24, 0.1, 8), pending: [{}] }), false);
});

test('model files are pinned, permissively licensed, and the voice is credited', () => {
  assert.equal(MODEL_FILES.length, 8);
  for (const f of MODEL_FILES) assert.ok(f.bytes > 0, f.name);
  assert.match(VOICE_FILE.url, /kyutai\/tts-voices\/resolve\/[0-9a-f]{40}\/alba-mackenna\//);
  assert.ok(!MODEL_FILES.some((f) => f.name === 'voices.bin'), 'voices.bin carries non-commercial voices');
  assert.match(VOICE_CREDIT, /CC BY 4\.0/);
});
