import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentVoice, unlockPlayback } from '../src/agent/agentVoice.js';
import { SurveyAgentError } from '../src/agent/surveyAgentClient.js';

// A fake browser: Web Audio that "plays" instantly and a device voice that
// records what it was asked to say. Nothing makes a sound.
function fakeBrowser() {
  const played = [];
  const spoken = [];
  class Ctx {
    constructor() { this.state = 'running'; this.destination = {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    decodeAudioData(buf) { return Promise.resolve({ bytes: buf.byteLength }); }
    createBufferSource() {
      return {
        connect() {},
        start() { played.push(this.buffer.bytes); setTimeout(() => this.onended?.(), 0); },
        stop() {},
      };
    }
  }
  globalThis.window = {
    AudioContext: Ctx,
    speechSynthesis: { speak: (u) => { spoken.push(u.text); setTimeout(() => u.onend?.(), 0); }, cancel() {} },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  };
  return { played, spoken };
}

const wav = Buffer.from('RIFF....WAVEfmt ').toString('base64');

test('replies play in the server voice, short and plain', async () => {
  const { played, spoken } = fakeBrowser();
  unlockPlayback();
  const asked = [];
  const voice = createAgentVoice({ serverVoice: true, call: async (p) => { asked.push(p); return { audio: wav }; } });
  await voice.speak('Set D-117 card reader to Y (id m117).');
  assert.deepEqual(asked, [{ action: 'speak', text: 'Set D 117 card reader to Y.' }]);
  assert.equal(played.length, 1);
  assert.deepEqual(spoken, []);
});

test('when the server voice fails, the device voice says it, and stays in use', async () => {
  const { played, spoken } = fakeBrowser();
  unlockPlayback();
  let calls = 0;
  const voice = createAgentVoice({ serverVoice: true, call: async () => { calls += 1; throw new SurveyAgentError('speech_unavailable'); } });
  await voice.speak('First reply.');
  await voice.speak('Second reply.');
  assert.equal(calls, 1, 'the server voice is not tried again this session');
  assert.deepEqual(spoken, ['First reply.', 'Second reply.']);
  assert.equal(played.length, 0);
  assert.equal(voice.usesServer, false);
});

test('a dropped connection falls back once but keeps trying the server voice', async () => {
  const { spoken } = fakeBrowser();
  unlockPlayback();
  const voice = createAgentVoice({ serverVoice: true, call: async () => { throw new SurveyAgentError('network'); } });
  await voice.speak('Hello.');
  assert.deepEqual(spoken, ['Hello.']);
  assert.equal(voice.usesServer, true);
});

test('with no server voice, only the device voice is used', async () => {
  const { spoken } = fakeBrowser();
  let calls = 0;
  const voice = createAgentVoice({ serverVoice: false, call: async () => { calls += 1; return { audio: wav }; } });
  await voice.speak('Done.');
  assert.equal(calls, 0);
  assert.deepEqual(spoken, ['Done.']);
});
