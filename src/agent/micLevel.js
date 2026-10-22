// How loud the mic hears right now, for the mic buttons' pulse (owner
// 2026-10-22: "it should pulse when it hears sound"). One level for the whole
// page, written as the CSS variable --survey-mic-level (0 to 1) on <html>, so
// the pulse follows the voice with no React render per audio frame.
import { createSpeechGate } from './voiceLoop.js';

/** Loudness (RMS, 0 to 1) to a 0 to 1 pulse: -60 dB is still, -18 dB and up is full. */
export function levelFromRms(rms) {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 60) / 42));
}

/** Quick to rise, slow to fall, so the pulse reads as a voice and not flicker. */
export function smoothLevel(previous, next) {
  const k = next > previous ? 0.6 : 0.15;
  return previous + (next - previous) * k;
}

let current = 0;
let frame = 0;
const listeners = new Set();

const write = () => {
  frame = 0;
  if (typeof document !== 'undefined') {
    document.documentElement?.style?.setProperty('--survey-mic-level', current.toFixed(3));
  }
  for (const fn of [...listeners]) fn(current);
};

/** A new reading (0 to 1); 0 with `reset` drops it at once (the mic stopped). */
export function setMicLevel(value, { reset = false } = {}) {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  current = reset ? v : smoothLevel(current, v);
  if (reset || typeof requestAnimationFrame !== 'function') { write(); return; }
  if (!frame) frame = requestAnimationFrame(write);
}

export const getMicLevel = () => current;

export function subscribeMicLevel(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Listens to a mic stream that is already open (the tap or hold recorder,
 * the browser's own speech): sets the pulse, and says when speech starts and
 * ends with the same speech gate hands-free uses. Returns { stop }.
 */
export function startStreamMeter(stream, { onSpeech = null, gateOptions = {} } = {}) {
  const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!stream || !AudioCtx) return { stop() {} };
  let ctx;
  try { ctx = new AudioCtx(); } catch { return { stop() {} }; }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  const frameMs = (analyser.fftSize / ctx.sampleRate) * 1000;
  const gate = createSpeechGate({ frameMs, ratio: 2, ...gateOptions });
  let stopped = false;
  // About one reading per buffer, whatever the screen's refresh rate.
  const timer = setInterval(() => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    setMicLevel(levelFromRms(rms));
    const said = gate.push(rms);
    if (said === 'start' || said === 'end') onSpeech?.(said);
  }, Math.max(10, Math.round(frameMs)));
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      try { source.disconnect(); } catch { /* already off */ }
      ctx.close().catch(() => {});
      setMicLevel(0, { reset: true });
    },
  };
}
