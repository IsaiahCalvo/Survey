// The Survey agent's spoken replies. A natural voice from the server
// (survey-agent's speak action, Groq Orpheus) when it is set up, else the
// device's own voice; any failure falls back to the device voice, so a
// reply is never silently lost. Playback goes through Web Audio, unlocked
// during a tap, because phones block audio that starts after a network
// wait without one.
import { spokenReply } from './voiceLoop.js';

let playback = null;

/** Call from a tap or key press: lets later replies play on phones. */
export function unlockPlayback() {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!playback || playback.state === 'closed') playback = new AudioCtx();
    if (playback.state === 'suspended') playback.resume().catch(() => {});
  } catch { /* no Web Audio: the device voice still works */ }
}

const canDeviceSpeak = () => typeof window !== 'undefined'
  && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

function deviceSpeak(words) {
  return new Promise((resolve) => {
    if (!canDeviceSpeak() || !words) { resolve(); return; }
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    // Some devices never fire onend; give up after a generous reading time.
    const timer = setTimeout(finish, 2500 + words.length * 90);
    try {
      window.speechSynthesis.cancel();
      const utterance = new window.SpeechSynthesisUtterance(words);
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    } catch { finish(); }
  });
}

const base64ToBytes = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// Errors that mean the server voice will not work this session.
const SERVER_VOICE_OFF = new Set(['speech_not_set_up', 'speech_unavailable', 'speech_limit_reached', 'not_enabled_for_you', 'monthly_cap_reached']);

/**
 * call: the survey-agent caller (no retries: a slow voice is worse than the
 * device voice). serverVoice: whether the server said it can speak.
 */
export function createAgentVoice({ call, serverVoice = false } = {}) {
  let useServer = Boolean(serverVoice);
  let source = null;
  let turn = 0;

  const stop = () => {
    turn += 1;
    try { source?.stop(); } catch { /* already over */ }
    source = null;
    try { if (canDeviceSpeak()) window.speechSynthesis.cancel(); } catch { /* nothing playing */ }
  };

  const playServer = async (words, mine) => {
    const out = await call({ action: 'speak', text: words });
    if (mine !== turn) return;
    const bytes = base64ToBytes(String(out?.audio || ''));
    const buffer = await playback.decodeAudioData(bytes.buffer);
    if (mine !== turn) return;
    await new Promise((resolve) => {
      const node = playback.createBufferSource();
      node.buffer = buffer;
      node.connect(playback.destination);
      node.onended = resolve;
      source = node;
      node.start();
    });
    source = null;
  };

  return {
    get usesServer() { return useServer; },
    setServerVoice(on) { useServer = Boolean(on); },
    stop,
    /** Resolves when the reply has been spoken (or could not be). */
    async speak(text) {
      const words = spokenReply(text);
      if (!words) return;
      stop();
      const mine = turn;
      if (useServer && playback && playback.state === 'running') {
        try {
          await playServer(words, mine);
          return;
        } catch (err) {
          if (SERVER_VOICE_OFF.has(err?.code) || !err?.code) useServer = false;
          if (mine !== turn) return;
        }
      }
      await deviceSpeak(words);
    },
  };
}

export const canSpeakReplies = () => canDeviceSpeak() || Boolean(typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
