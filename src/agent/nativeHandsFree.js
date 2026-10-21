// Hands-free in the iPhone and Android apps: the phone's own speech to text
// (the app's speech plugin, src/mobile/nativeSpeech.js) hears the person
// instead of the web mic, so nothing is sent to the server to be heard. It
// gives the same handle as startHandsFreeMic ({ stop, guard, unguard }), but
// hands over words, not clips.
//
// While the agent speaks the phone hears it too, so words heard then that
// match what the agent is saying are dropped; anything else cuts the agent
// off and is used.

import { heardOwnVoice } from './voiceLoop.js';

// Below this the phone was mostly guessing: ask again rather than act on it.
export const NATIVE_MIN_CONFIDENCE = 0.3;
const FATAL = new Set(['not-allowed', 'unavailable', 'language-not-supported']);
// Restarts after an error in a row before giving up (a broken recognizer
// would otherwise spin).
const MAX_RESTARTS = 5;

export async function startNativeHandsFree({
  speech,
  lang,
  onText,
  onHearing = () => {},
  onBargeIn = () => {},
  onFatal = () => {},
  spokenNow = () => '',
}) {
  const granted = await speech.requestPermission();
  if (granted === false || granted?.granted === false) {
    const err = new Error('Microphone or speech permission refused');
    err.name = 'NotAllowedError';
    throw err;
  }
  let stopped = false;
  let guarded = false;
  let restarts = 0;
  let session = null;
  let talking = false;

  const begin = () => {
    session = speech.start({
      lang,
      onSpeechStart: () => { talking = true; onHearing(true); },
      onSpeechEnd: () => { talking = false; onHearing(false); },
      onFinal: ({ text, confidence } = {}) => {
        restarts = 0;
        talking = false;
        onHearing(false);
        const words = String(text || '').trim();
        if (stopped || !words) return;
        if (guarded) {
          if (heardOwnVoice(words, spokenNow())) return;
          onBargeIn();
        }
        const c = Number(confidence);
        onText(words, { cutIn: guarded, unsure: c > 0 && c < NATIVE_MIN_CONFIDENCE, confidence: c });
      },
      onError: (code) => {
        if (stopped) return;
        if (FATAL.has(code) || restarts >= MAX_RESTARTS) {
          stopped = true;
          onFatal(code);
          return;
        }
        // "No speech", a timeout or a busy recognizer: listen again.
        restarts += 1;
        try { session?.stop(); } catch { /* already stopped */ }
        begin();
      },
    });
  };
  begin();

  return {
    native: true,
    stop() {
      stopped = true;
      try { session?.stop(); } catch { /* already stopped */ }
    },
    // Same as the web mic: false while the person is mid-sentence, so the
    // agent waits to speak.
    guard() {
      if (talking) return false;
      guarded = true;
      return true;
    },
    unguard() { guarded = false; },
  };
}
