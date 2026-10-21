import test from 'node:test';
import assert from 'node:assert/strict';
import { startNativeHandsFree } from '../src/agent/nativeHandsFree.js';

// A stand-in for src/mobile/nativeSpeech.js: records each start and lets the
// test play the phone's callbacks.
function fakeSpeech({ permission = true } = {}) {
  const sessions = [];
  return {
    sessions,
    get last() { return sessions[sessions.length - 1]; },
    requestPermission: async () => permission,
    start(opts) {
      const s = { opts, stopped: false, stop() { s.stopped = true; } };
      sessions.push(s);
      return s;
    },
  };
}

test('the phone hears the words and hands them over, unsure ones marked', async () => {
  const speech = fakeSpeech();
  const heard = [];
  const hearing = [];
  const mic = await startNativeHandsFree({ speech, lang: 'es-US', onText: (t, info) => heard.push([t, info.unsure, info.cutIn]), onHearing: (on) => hearing.push(on) });
  assert.equal(speech.last.opts.lang, 'es-US');
  speech.last.opts.onSpeechStart();
  speech.last.opts.onFinal({ text: ' D-117 no power ', confidence: 0.92 });
  speech.last.opts.onFinal({ text: 'mumble', confidence: 0.1 });
  speech.last.opts.onFinal({ text: 'no score', confidence: 0 });
  speech.last.opts.onFinal({ text: '  ' });
  assert.deepEqual(heard, [['D-117 no power', false, false], ['mumble', true, false], ['no score', false, false]]);
  assert.deepEqual(hearing.slice(0, 2), [true, false]);
  mic.stop();
  assert.equal(speech.last.stopped, true);
  speech.last.opts.onFinal({ text: 'after stop', confidence: 1 });
  assert.equal(heard.length, 3);
});

test('while the agent speaks its own words are dropped, and other words cut it off', async () => {
  const speech = fakeSpeech();
  const heard = [];
  let cutOff = 0;
  const mic = await startNativeHandsFree({
    speech, lang: 'en-US', onText: (t, info) => heard.push([t, info.cutIn]), onBargeIn: () => { cutOff += 1; }, spokenNow: () => 'D-117 power is N.',
  });
  // Mid-sentence: the agent waits to speak.
  speech.last.opts.onSpeechStart();
  assert.equal(mic.guard(), false);
  speech.last.opts.onSpeechEnd();
  assert.equal(mic.guard(), true);
  speech.last.opts.onFinal({ text: 'D-117 power is N', confidence: 0.9 });
  assert.deepEqual(heard, []);
  speech.last.opts.onFinal({ text: 'stop, that was D-118', confidence: 0.9 });
  assert.equal(cutOff, 1);
  assert.deepEqual(heard, [['stop, that was D-118', true]]);
  mic.unguard();
  speech.last.opts.onFinal({ text: 'next', confidence: 0.9 });
  assert.deepEqual(heard.at(-1), ['next', false]);
});

test('it listens again after a passing error, and gives up on a refusal or a loop of errors', async () => {
  const speech = fakeSpeech();
  const fatal = [];
  await startNativeHandsFree({ speech, lang: 'en-US', onText: () => {}, onFatal: (code) => fatal.push(code) });
  speech.last.opts.onError('no-speech');
  assert.equal(speech.sessions.length, 2);
  assert.equal(speech.sessions[0].stopped, true);
  speech.last.opts.onError('not-allowed');
  assert.deepEqual(fatal, ['not-allowed']);
  assert.equal(speech.sessions.length, 2);

  const looping = fakeSpeech();
  const gaveUp = [];
  await startNativeHandsFree({ speech: looping, lang: 'en-US', onText: () => {}, onFatal: (code) => gaveUp.push(code) });
  for (let i = 0; i < 10; i += 1) looping.last.opts.onError('busy');
  assert.equal(looping.sessions.length, 6);
  assert.deepEqual(gaveUp, ['busy']);
});

test('a refused permission fails like a refused mic', async () => {
  await assert.rejects(startNativeHandsFree({ speech: fakeSpeech({ permission: false }), onText: () => {} }), { name: 'NotAllowedError' });
  await assert.rejects(startNativeHandsFree({ speech: fakeSpeech({ permission: { granted: false } }), onText: () => {} }), { name: 'NotAllowedError' });
});
