// The microphone for hands-free talk: listens all the time, cuts a clip each
// time the person says something and pauses, and hands it over as a 16 kHz
// WAV file. Paused while the agent works or speaks, so it never hears its
// own voice. The speech gate itself is in voiceLoop.js.
import { createSpeechGate, downsample, encodeWav, frameLevel } from './voiceLoop.js';

const PRE_ROLL_MS = 350;

export async function startHandsFreeMic({ onClip, onHearing, gateOptions } = {}) {
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
  const gate = createSpeechGate({ frameMs, ...gateOptions });
  const preRoll = [];
  const preRollFrames = Math.ceil(PRE_ROLL_MS / frameMs);
  let clip = null;
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
    } else if (result === 'end' || result === 'discard') {
      const parts = clip || [];
      clip = null;
      onHearing?.(false);
      if (result === 'discard') return;
      const total = parts.reduce((n, p) => n + p.length, 0);
      const all = new Float32Array(total);
      let at = 0;
      for (const p of parts) { all.set(p, at); at += p.length; }
      const wav = encodeWav(downsample(all, ctx.sampleRate, 16_000), 16_000);
      onClip?.(new Blob([wav], { type: 'audio/wav' }), Math.round((total / ctx.sampleRate) * 1000));
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
    resume() { clear(); paused = false; },
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
