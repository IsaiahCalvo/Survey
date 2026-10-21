// The microphone for hands-free talk: listens all the time, cuts a clip each
// time the person says something and pauses, and hands it over as a 16 kHz
// WAV file. While the agent speaks it listens with a stricter gate (guard),
// so the person can cut in but the agent's own voice, mostly removed by echo
// cancellation, does not count. The speech gate itself is in voiceLoop.js.
import { BARGE_IN_GATE, MAIN_GATE, createBandLevel, createSpeechGate, downsample, encodeWav } from './voiceLoop.js';

const PRE_ROLL_MS = 350;
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
// ScriptProcessor still runs everywhere (Safari included) and needs no
// extra module file; each buffer is about 21 ms at 48 kHz.
const BUFFER_SIZE = 1024;
// What the warm mic keeps before hands-free takes it over, and how long it
// waits to be taken before letting the mic go.
const WARM_KEEP_MS = 20_000;
const WARM_GIVE_UP_MS = 15_000;

const newAudioContext = () => {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  // Made and started inside the tap where it can be, so phones let it run.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
};

function openMic(stream, ctx = newAudioContext()) {
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
  source.connect(node);
  // A processor only runs when connected onward; its output stays silent.
  node.connect(ctx.destination);
  const close = () => {
    try { node.disconnect(); source.disconnect(); } catch { /* already off */ }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };
  return { stream, ctx, node, close };
}

let warm = null;

/**
 * Starts recording the moment the mic is tapped, before the app has asked
 * the server anything, so the first words are never lost. Hands-free takes
 * the warm mic over and hears what it kept. Not in the phone apps, where
 * the phone's own speech to text uses the mic.
 */
export function warmUpHandsFreeMic() {
  if (warm || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
  if (globalThis.Capacitor?.isNativePlatform?.()) return;
  let ctx;
  try { ctx = newAudioContext(); } catch { return; }
  const mine = { frames: [], mic: null, cancelled: false };
  warm = mine;
  mine.ready = navigator.mediaDevices.getUserMedia({ audio: AUDIO }).then((stream) => {
    if (mine.cancelled) { stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); return null; }
    mine.mic = openMic(stream, ctx);
    const keep = Math.ceil(WARM_KEEP_MS / ((BUFFER_SIZE / mine.mic.ctx.sampleRate) * 1000));
    mine.mic.node.onaudioprocess = (event) => {
      mine.frames.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      if (mine.frames.length > keep) mine.frames.shift();
    };
    return mine;
  }).catch((err) => {
    if (warm === mine) warm = null;
    ctx.close().catch(() => {});
    mine.error = err;
    return null;
  });
  mine.timer = setTimeout(() => { if (warm === mine) letGoOfWarmMic(); }, WARM_GIVE_UP_MS);
}

/** Hands-free did not start after all: free the mic. */
export function letGoOfWarmMic() {
  const mine = warm;
  if (!mine) return;
  warm = null;
  mine.cancelled = true;
  clearTimeout(mine.timer);
  mine.mic?.close();
}

async function takeWarmMic() {
  const mine = warm;
  if (!mine) return null;
  warm = null;
  clearTimeout(mine.timer);
  await mine.ready;
  if (mine.error) throw mine.error;
  return mine.mic ? mine : null;
}

export async function startHandsFreeMic({ onClip, onHearing, onBargeIn, gateOptions } = {}) {
  const taken = await takeWarmMic();
  let mic = taken?.mic;
  if (!mic) {
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) throw new Error('This browser cannot use the microphone.');
    mic = openMic(await media.getUserMedia({ audio: AUDIO }));
  }
  const { ctx, node } = mic;
  const frameMs = (BUFFER_SIZE / ctx.sampleRate) * 1000;
  const mainGate = createSpeechGate({ frameMs, ...MAIN_GATE, ...gateOptions });
  const level = createBandLevel(ctx.sampleRate);
  const bargeGate = createSpeechGate({ frameMs, ...BARGE_IN_GATE });
  let gate = mainGate;
  let guarded = false;
  const preRoll = [];
  const preRollFrames = Math.ceil(PRE_ROLL_MS / frameMs);
  let clip = null;
  let cutIn = false;
  let paused = false;
  let stopped = false;

  const hear = (samples) => {
    if (paused || stopped) return;
    const result = gate.push(level(samples));
    if (clip) clip.push(samples);
    else {
      preRoll.push(samples);
      if (preRoll.length > preRollFrames) preRoll.shift();
    }
    if (result === 'start') {
      clip = preRoll.splice(0);
      onHearing?.(true);
      cutIn = guarded;
      if (guarded) { guarded = false; onBargeIn?.(); }
    } else if (result === 'end' || result === 'discard') {
      const parts = clip || [];
      clip = null;
      onHearing?.(false);
      // A cut-in clip is finished with the strict gate; then back to normal.
      if (!guarded && gate === bargeGate) { gate = mainGate; mainGate.reset(); }
      if (result === 'discard') return;
      const total = parts.reduce((n, p) => n + p.length, 0);
      const all = new Float32Array(total);
      let at = 0;
      for (const p of parts) { all.set(p, at); at += p.length; }
      const wav = encodeWav(downsample(all, ctx.sampleRate, 16_000), 16_000);
      onClip?.(new Blob([wav], { type: 'audio/wav' }), Math.round((total / ctx.sampleRate) * 1000), { cutIn });
    }
  };
  node.onaudioprocess = (event) => hear(new Float32Array(event.inputBuffer.getChannelData(0)));
  // What the warm mic kept since the tap, heard first, in order.
  for (const samples of taken?.frames || []) hear(samples);

  const clear = () => {
    clip = null;
    preRoll.length = 0;
    gate.reset();
  };

  return {
    pause() { paused = true; clear(); onHearing?.(false); },
    resume() { clear(); gate = mainGate; guarded = false; paused = false; },
    /**
     * The agent is about to speak: from now on only clear, close speech cuts
     * in (onBargeIn). False, changing nothing, while the person is still
     * talking: the agent should not talk over them.
     */
    guard() {
      if (clip) return false;
      clear();
      onHearing?.(false);
      bargeGate.reset();
      gate = bargeGate;
      guarded = true;
      paused = false;
      return true;
    },
    /** The agent stopped speaking. A cut-in still being said carries on. */
    unguard() {
      guarded = false;
      if (gate === bargeGate && !bargeGate.talking) { clear(); gate = mainGate; }
    },
    get paused() { return paused; },
    stop() {
      if (stopped) return;
      stopped = true;
      mic.close();
    },
  };
}
