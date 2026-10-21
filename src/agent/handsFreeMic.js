// The microphone for hands-free talk: listens all the time, cuts a clip each
// time the person says something and pauses, and hands it over as a 16 kHz
// WAV file. While the agent speaks it listens with a stricter gate (guard),
// so the person can cut in but the agent's own voice, mostly removed by echo
// cancellation, does not count. A knock that starts and later discards does
// not stop the reply: onBargeIn waits until the clip is confirmed speech.
// The speech gate itself is in voiceLoop.js.
import { BARGE_IN_GATE, createSpeechGate, downsample, encodeWav, frameLevel } from './voiceLoop.js';

const PRE_ROLL_MS = 350;

export async function startHandsFreeMic({ onClip, onHearing, onBargeIn, gateOptions } = {}) {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) throw new Error('This browser cannot use the microphone.');
  const stream = await media.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor still runs everywhere (Safari included) and needs no
  // extra module file; each buffer is about 21 ms at 48 kHz.
  const bufferSize = 1024;
  const node = ctx.createScriptProcessor(bufferSize, 1, 1);
  const frameMs = (bufferSize / ctx.sampleRate) * 1000;
  const mainGate = createSpeechGate({ frameMs, ...gateOptions });
  const bargeGate = createSpeechGate({ frameMs, ...BARGE_IN_GATE });
  let gate = mainGate;
  let guarded = false;
  const preRoll = [];
  const preRollFrames = Math.ceil(PRE_ROLL_MS / frameMs);
  let clip = null;
  let cutIn = false;
  let paused = false;
  let stopped = false;

  node.onaudioprocess = (event) => {
    if (paused || stopped) return;
    const samples = new Float32Array(event.inputBuffer.getChannelData(0));
    const result = gate.push(frameLevel(samples));
    if (clip) clip.push(samples);
    else {
      preRoll.push(samples);
      if (preRoll.length > preRollFrames) preRoll.shift();
    }
    if (result === 'start') {
      clip = preRoll.splice(0);
      onHearing?.(true);
      cutIn = guarded;
    } else if (result === 'end' || result === 'discard') {
      const parts = clip || [];
      clip = null;
      onHearing?.(false);
      // Stop the reply only when the cut-in is real speech. A knock that
      // starts and then discards must not call onBargeIn, and must stay on
      // the guard so the agent's voice does not open the looser gate.
      if (result === 'end' && cutIn && guarded) { guarded = false; onBargeIn?.(); }
      if (!guarded && gate === bargeGate) { gate = mainGate; mainGate.reset(); }
      if (result === 'discard') return;
      const total = parts.reduce((n, p) => n + p.length, 0);
      const all = new Float32Array(total);
      let at = 0;
      for (const p of parts) { all.set(p, at); at += p.length; }
      const wav = encodeWav(downsample(all, ctx.sampleRate, 16_000), 16_000);
      onClip?.(new Blob([wav], { type: 'audio/wav' }), Math.round((total / ctx.sampleRate) * 1000), { cutIn });
    } else if (clip && cutIn && guarded && gate.confirmed) {
      guarded = false;
      onBargeIn?.();
    }
  };
  source.connect(node);
  // A processor only runs when connected onward; its output stays silent.
  node.connect(ctx.destination);

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
      try { node.disconnect(); source.disconnect(); } catch { /* already off */ }
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}
