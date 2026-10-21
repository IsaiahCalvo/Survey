// On-device speech-to-text for the Survey agent's hands-free mode in the
// iOS/Android app. Phones have one mic, so this replaces the web mic there
// instead of running beside it. The plugin only streams partial results, so
// a pause of SILENCE_MS after the last partial ends one utterance: we send its
// text as one final, then start again to keep listening.
// Outside the native app every call reports "unavailable".

const SILENCE_MS = 1200;
const FATAL = new Set(['not-allowed', 'unavailable', 'language-not-supported']);

const isNative = () => Boolean(globalThis.window?.Capacitor?.isNativePlatform?.());

async function plugin() {
  const { SpeechRecognition } = await import('@capgo/capacitor-speech-recognition');
  return SpeechRecognition;
}

export async function isAvailable() {
  if (!isNative()) return false;
  try {
    const { available } = await (await plugin()).available();
    return Boolean(available);
  } catch {
    return false;
  }
}

export async function requestPermission() {
  if (!isNative()) return 'denied';
  try {
    const sr = await plugin();
    const now = await sr.checkPermissions();
    if (now.speechRecognition === 'granted') return 'granted';
    const asked = await sr.requestPermissions();
    return asked.speechRecognition === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

// Plugin errors are plain strings; map the ones callers act on.
export function errorCode(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (/permission|not allowed|denied|authori/.test(msg)) return 'not-allowed';
  if (/not available|unavailable|not supported on this device/.test(msg)) return 'unavailable';
  if (/language|locale/.test(msg)) return 'language-not-supported';
  if (/no match|no speech|didn't understand/.test(msg)) return 'no-speech';
  return 'error';
}

export async function start({ lang = 'en-US', onFinal, onPartial, onSpeechStart, onSpeechEnd, onError } = {}) {
  if (!isNative()) {
    onError?.('unavailable');
    throw Object.assign(new Error('Native speech is unavailable'), { code: 'unavailable' });
  }
  const sr = await plugin();
  let stopped = false;
  let text = '';
  let speaking = false;
  let timer = null;
  const handles = [];

  const finish = () => {
    clearTimeout(timer);
    timer = null;
    const said = text.trim();
    text = '';
    if (speaking) {
      speaking = false;
      onSpeechEnd?.();
    }
    if (said) onFinal?.({ text: said, confidence: 0 });
  };

  const listen = async () => {
    if (stopped) return;
    try {
      await sr.start({ language: lang, partialResults: true, popup: false, maxResults: 1, muteRecognizerBeep: true });
    } catch (err) {
      if (stopped) return;
      const code = errorCode(err);
      // A pause with nothing heard ends a session on Android; just listen again.
      if (code === 'no-speech') return void listen();
      stopped = true;
      onError?.(code);
    }
  };

  handles.push(await sr.addListener('partialResults', ({ matches }) => {
    const heard = matches?.[0] || '';
    if (!heard || stopped) return;
    if (!speaking) {
      speaking = true;
      onSpeechStart?.();
    }
    text = heard;
    onPartial?.(heard);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      finish();
      if (stopped) return;
      try { await sr.stop(); } catch { /* already stopped */ }
      listen();
    }, SILENCE_MS);
  }));

  // Android ends a session by itself after a pause; restart to keep listening.
  handles.push(await sr.addListener('listeningState', ({ status }) => {
    if (status !== 'stopped' || stopped) return;
    if (timer) return; // the silence timer restarts it
    finish();
    listen();
  }));

  // CI walks (vite --mode e2e only): emulators have no voice, so let the walk
  // hand in one heard sentence while listening.
  if (import.meta.env?.MODE === 'e2e') {
    globalThis.__surveyNativeSpeechTest = {
      say(said) {
        if (stopped) return false;
        onSpeechStart?.();
        onFinal?.({ text: String(said), confidence: 0 });
        onSpeechEnd?.();
        return true;
      },
    };
  }

  await listen();
  if (stopped && handles.length) {
    // start() failed with a fatal error before anything was heard.
    await Promise.all(handles.map((h) => h.remove()));
  }

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      finish();
      await Promise.all(handles.map((h) => h.remove().catch(() => {})));
      try { await sr.stop(); } catch { /* already stopped */ }
    },
  };
}

export const FATAL_SPEECH_ERRORS = FATAL;
