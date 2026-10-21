import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cleanTranscript,
  createSpeechGate,
  downsample,
  encodeWav,
  frameLevel,
  heardOwnVoice,
  BARGE_IN_GATE,
  spokenReply,
  transcriptionHints,
} from '../src/agent/voiceLoop.js';
import { SurveyAgentError, usageWarning, withRetries } from '../src/agent/surveyAgentClient.js';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';

// tests/fixtures/voice: synthetic speech mixed with site noise (generator
// hum, wind, hammer bursts), 16 kHz mono, about 1 s of noise before the words
// and 1.5 s after. two_turns.wav says two things with a 2 s pause between.
const readWav = (name) => {
  const buf = readFileSync(new URL(`./fixtures/voice/${name}`, import.meta.url));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let at = 12;
  while (at < buf.length - 8) {
    const id = buf.toString('ascii', at, at + 4);
    const size = view.getUint32(at + 4, true);
    if (id === 'data') {
      const samples = new Float32Array(size / 2);
      for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(at + 8 + i * 2, true) / 32768;
      return { samples, rate: view.getUint32(24, true) };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`no data in ${name}`);
};

// Feeds a clip through the gate the way the mic does: 20 ms frames.
function clipsIn(name, options = {}) {
  const { samples, rate } = readWav(name);
  const frame = Math.round(rate * 0.02);
  const gate = createSpeechGate({ frameMs: 20, ...options });
  const events = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    const e = gate.push(frameLevel(samples.subarray(i, i + frame)));
    if (e) events.push({ e, at: (i / rate).toFixed(2) });
  }
  return events;
}

for (const name of ['d117.wav', 'd119.wav', 'cam12.wav', 'no118.wav', 'undo.wav']) {
  test(`hands-free cuts one clip from ${name}, over the site noise`, () => {
    const events = clipsIn(name);
    assert.deepEqual(events.map((x) => x.e), ['start', 'end'], JSON.stringify(events));
    assert.ok(Number(events[0].at) >= 0.7, `started in the noise before the words: ${events[0].at}`);
  });
}

// Real people with varied accents (tests/fixtures/voice/edacc, CC BY-SA),
// over generator hum or hammer bursts.
for (const name of ['hammer_001', 'gen_034', 'hammer_040', 'gen_050', 'hammer_063', 'gen_067']) {
  test(`hands-free cuts one clip from a real voice: edacc/${name}`, () => {
    const events = clipsIn(`edacc/${name}.wav`);
    assert.deepEqual(events.map((x) => x.e), ['start', 'end'], JSON.stringify(events));
    assert.ok(Number(events[0].at) >= 0.7, `started in the noise before the words: ${events[0].at}`);
    assert.ok(Number(events[1].at) - Number(events[0].at) >= 2, `kept the whole tag: ${JSON.stringify(events)}`);
  });
}

// While the agent speaks, a stricter gate: real people still cut in over
// site noise, and the agent's own voice, faint after echo cancellation, does
// not.
for (const name of ['edacc/hammer_001', 'edacc/gen_034', 'edacc/hammer_040', 'edacc/gen_050', 'edacc/hammer_063', 'edacc/gen_067', 'd117', 'no118']) {
  test(`cutting in while the agent speaks is heard: ${name}`, () => {
    assert.equal(clipsIn(`${name}.wav`, BARGE_IN_GATE)[0]?.e, 'start');
  });
}

for (const noiseClip of [null, 'edacc/gen_050', 'edacc/hammer_063']) {
  test(`the agent's own voice, faint in the mic, does not cut it off (${noiseClip || 'quiet room'})`, () => {
    const voice = readWav('d117.wav').samples;
    // Site noise from before anyone talks in a real clip.
    const noise = noiseClip ? readWav(`${noiseClip}.wav`).samples.subarray(0, 14_400) : null;
    const gate = createSpeechGate({ frameMs: 20, ...BARGE_IN_GATE });
    const events = [];
    const frame = new Float32Array(320);
    for (let i = 0; i + 320 <= voice.length; i += 320) {
      // What echo cancellation leaves of the agent's voice: a tenth of it.
      for (let j = 0; j < 320; j += 1) frame[j] = voice[i + j] * 0.1 + (noise ? noise[(i + j) % noise.length] : 0);
      const e = gate.push(frameLevel(frame));
      if (e) events.push(e);
    }
    assert.deepEqual(events, []);
  });
}

test('a transcript of the agent\'s own reply is not taken as the person', () => {
  const spoken = 'D 117: card reader is Y.';
  assert.equal(heardOwnVoice('D117 card reader is Y', spoken), true);
  assert.equal(heardOwnVoice('No, D-118.', spoken), false);
  assert.equal(heardOwnVoice('card reader is missing on D 119', spoken), false);
  assert.equal(heardOwnVoice('card reader is N', spoken), false);
  assert.equal(heardOwnVoice('card reader is N', 'card reader is Y.'), false);
  assert.equal(heardOwnVoice('Y', spoken), false);
  assert.equal(heardOwnVoice('anything', ''), false);
});

test('two things said with a pause are two clips', () => {
  assert.deepEqual(clipsIn('two_turns.wav').map((x) => x.e), ['start', 'end', 'start', 'end']);
});

test('a short bang is not speech; steady noise raises the bar', () => {
  const gate = createSpeechGate({ frameMs: 20 });
  for (let i = 0; i < 50; i += 1) gate.push(0.02);
  // One loud 160 ms knock, then quiet.
  const events = [];
  for (let i = 0; i < 8; i += 1) events.push(gate.push(0.4));
  for (let i = 0; i < 80; i += 1) events.push(gate.push(0.02));
  assert.deepEqual(events.filter(Boolean), ['start', 'discard']);
  // A generator now runs at 0.05: that is the new quiet, not speech.
  for (let i = 0; i < 200; i += 1) assert.equal(gate.push(0.05), null);
  assert.ok(gate.floor > 0.04);
});

test('a short bang while the agent speaks is never a confirmed cut-in', () => {
  const gate = createSpeechGate({ frameMs: 20, ...BARGE_IN_GATE });
  for (let i = 0; i < 50; i += 1) gate.push(0.02);
  const events = [];
  for (let i = 0; i < 8; i += 1) {
    events.push(gate.push(0.4));
    assert.equal(gate.confirmed, false);
  }
  for (let i = 0; i < 80; i += 1) {
    events.push(gate.push(0.02));
    assert.equal(gate.confirmed, false);
  }
  assert.deepEqual(events.filter(Boolean), ['start', 'discard']);
});

test('a cut-in is confirmed only once it is long enough to keep', () => {
  const gate = createSpeechGate({ frameMs: 20, ...BARGE_IN_GATE });
  for (let i = 0; i < 50; i += 1) gate.push(0.02);
  for (let i = 0; i < 17; i += 1) {
    gate.push(0.4);
    assert.equal(gate.confirmed, false);
  }
  assert.equal(gate.push(0.4), null);
  assert.equal(gate.confirmed, true);
});

test('a clip never runs past the longest allowed', () => {
  const gate = createSpeechGate({ frameMs: 20, maxMs: 2000 });
  for (let i = 0; i < 20; i += 1) gate.push(0.01);
  const events = [];
  for (let i = 0; i < 200; i += 1) events.push(gate.push(0.5));
  // Cut at 2 s; talking on starts the next clip.
  assert.deepEqual(events.filter(Boolean).slice(0, 3), ['start', 'end', 'start']);
  assert.equal(events.indexOf('end') - events.indexOf('start'), 2000 / 20 - 7);
});

test('clips become 16 kHz WAV files', () => {
  const tone = Float32Array.from({ length: 48_000 }, (_, i) => Math.sin(i / 10) * 0.5);
  const low = downsample(tone, 48_000, 16_000);
  assert.equal(low.length, 16_000);
  const wav = encodeWav(low, 16_000);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint32(40, true), 32_000);
  assert.equal(wav.length, 44 + 32_000);
});

test('replies are spoken short and plain', () => {
  assert.equal(spokenReply('Set D-117: cable Y, reader N (id m117). Added a note.'), 'Set D 117: cable Y, reader N. Added a note.');
  assert.equal(spokenReply('Done.\n- one\n- two\nThree. Four.'), 'Done. one.');
  assert.equal(spokenReply('See https://x.y/z for more. Ok.'), 'See for more. Ok.');
  assert.ok(spokenReply('word '.repeat(100)).length <= 221);
  assert.equal(spokenReply(''), '');
});

test('speech to text hints: template words first, item names last', () => {
  const hints = transcriptionHints({
    template: {
      modules: [{ categories: [{ name: 'Door', checklist: [{ text: 'Card reader' }, { text: 'Door' }] }] }],
      entities: [{ name: 'Subcontractor' }],
    },
    markers: { a: { name: 'D-117' }, b: { name: 'D-118' }, c: { name: 'd-117' }, d: {} },
  });
  assert.deepEqual(hints, ['Door', 'Card reader', 'Subcontractor', 'D-117', 'D-118']);
  assert.deepEqual(transcriptionHints(null), []);
});

test('a dropped or busy call is tried again; no signal and refusals are not', async () => {
  const waits = [];
  const wait = async (ms) => { waits.push(ms); };
  let n = 0;
  const flaky = withRetries(async () => { n += 1; if (n < 3) throw new SurveyAgentError('network'); return 'ok'; }, { wait });
  assert.equal(await flaky({}), 'ok');
  assert.deepEqual(waits, [1000, 3000]);

  waits.length = 0;
  const busy = withRetries(async () => { throw new SurveyAgentError('busy_try_again', { retryAfter: 7 }); }, { wait });
  await assert.rejects(busy({}), (e) => e.code === 'busy_try_again');
  assert.deepEqual(waits, [7000, 7000]);

  for (const code of ['offline', 'monthly_cap_reached', 'not_enabled_for_you']) {
    let calls = 0;
    const once = withRetries(async () => { calls += 1; throw new SurveyAgentError(code); }, { wait });
    await assert.rejects(once({}), (e) => e.code === code);
    assert.equal(calls, 1, code);
  }
});

test('the monthly allowance warns near the end and says when it is used up', () => {
  assert.equal(usageWarning(null), null);
  assert.equal(usageWarning({ requests: 2000, cost_share: 0.9 }), null);
  assert.match(usageWarning({ requests: 40, cost_share: 0.9 }), /about 40 requests left/);
  assert.match(usageWarning({ requests: 2000, cost_share: 0.05 }), /Almost at this month/);
  assert.match(usageWarning({ requests: 0, cost_share: 0.5 }), /reached this month/);
});

test('undo_last_turn takes back the last reply when the person corrects the agent', async () => {
  const bridge = { template: { modules: [] }, markers: {} };
  let undone = 0;
  const box = createSurveyAgentToolbox({ getBridge: () => bridge, undoLastTurn: () => { undone += 1; return { reverted: 2, kept: 1 }; } });
  const out = await box.run('undo_last_turn', {});
  assert.equal(out.isError, false);
  assert.match(out.content, /2 reverted, 1 kept/);
  assert.equal(undone, 1);
  const none = createSurveyAgentToolbox({ getBridge: () => bridge, undoLastTurn: () => null });
  assert.equal((await none.run('undo_last_turn', {})).isError, true);
});

test('a looping transcript keeps one copy', () => {
  assert.equal(cleanTranscript('D-118, D-118, D-118, D-118,'), 'D-118');
  assert.equal(cleanTranscript('No, D-118.'), 'No, D-118.');
  assert.equal(cleanTranscript('Card reader is in. Card reader is in. Card reader is in.'), 'Card reader is in');
  assert.equal(cleanTranscript('D-117 and D-118 both have power'), 'D-117 and D-118 both have power');
  assert.equal(cleanTranscript(null), '');
});
