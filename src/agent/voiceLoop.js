// Hands-free talk for the Survey agent: the parts with no browser in them, so
// node tests can drive them with recorded clips. handsFreeMic.js feeds these
// from the microphone; SurveyAgentPanel runs the talk, answer, listen loop.

/**
 * Tells when someone starts and stops talking, from one loudness value per
 * short frame (root mean square of the samples, 0 to 1). It learns the
 * background noise while nobody talks (a site with a generator is never
 * quiet), and calls it speech when a frame is clearly louder than that.
 *
 * push(level) returns:
 *   'start'   speech began (include the frames kept from just before it),
 *   'end'     speech ended after a pause; send the clip,
 *   'discard' it was only a short noise (a door bang, a cough),
 *   null      nothing changed.
 */
export function createSpeechGate({
  frameMs = 20,
  startMs = 140,
  endSilenceMs = 1100,
  minSpeechMs = 350,
  maxMs = 30_000,
  burstMs = 100,
  ratio = 2.6,
  minLevel = 0.012,
} = {}) {
  const frames = (ms) => Math.max(1, Math.round(ms / frameMs));
  const startFrames = frames(startMs);
  const endFrames = frames(endSilenceMs);
  const minSpeechFrames = frames(minSpeechMs);
  const maxFrames = frames(maxMs);
  const burstFrames = frames(burstMs);
  let floor = null;
  let talking = false;
  let loudRun = 0;
  let quietRun = 0;
  let length = 0;
  let speechFrames = 0;
  // Loud frames after a pause that may only be a bang (a hammer, a door):
  // they count as speech once they last longer than a bang does.
  let pendingLoud = 0;

  const learn = (level) => {
    // Quick at first, then slow, so one loud frame does not raise the floor.
    floor = floor == null ? level : floor + (level - floor) * (level > floor ? 0.02 : 0.1);
  };

  return {
    get talking() { return talking; },
    get floor() { return floor; },
    reset() {
      talking = false; loudRun = 0; quietRun = 0; length = 0; speechFrames = 0; pendingLoud = 0;
    },
    push(level) {
      const value = Number.isFinite(level) ? Math.max(0, level) : 0;
      const loud = value > Math.max(minLevel, (floor ?? value) * ratio);
      if (!talking) {
        if (loud) {
          loudRun += 1;
          if (loudRun >= startFrames) {
            talking = true;
            length = loudRun;
            speechFrames = loudRun;
            quietRun = 0;
            return 'start';
          }
        } else {
          loudRun = 0;
          learn(value);
        }
        return null;
      }
      length += 1;
      if (loud) {
        pendingLoud += 1;
        if (pendingLoud > burstFrames || quietRun === 0) {
          speechFrames += pendingLoud;
          pendingLoud = 0;
          quietRun = 0;
        }
      } else {
        quietRun += 1 + pendingLoud;
        pendingLoud = 0;
      }
      if (quietRun >= endFrames || length >= maxFrames) {
        const enough = speechFrames >= minSpeechFrames;
        this.reset();
        return enough ? 'end' : 'discard';
      }
      return null;
    },
  };
}

/** Loudness of one frame of samples (root mean square, 0 to 1). */
export function frameLevel(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Lower the sample rate by averaging (speech to text wants 16 kHz). */
export function downsample(samples, fromRate, toRate = 16_000) {
  if (!samples?.length || fromRate <= toRate) return Float32Array.from(samples || []);
  const step = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / step));
  for (let i = 0; i < out.length; i += 1) {
    const from = Math.floor(i * step);
    const to = Math.min(samples.length, Math.floor((i + 1) * step));
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += samples[j];
    out[i] = sum / Math.max(1, to - from);
  }
  return out;
}

/** A mono 16-bit WAV file from samples between -1 and 1. */
export function encodeWav(samples, sampleRate = 16_000) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i += 1) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

const MAX_SPOKEN_CHARS = 220;

/**
 * A reply as it should sound: no ids, links or list marks, tags read the way
 * people say them ("D-117" as "D 117"), at most two sentences.
 */
export function spokenReply(text) {
  let s = String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\(\s*id[^)]*\)/gi, '')
    .replace(/\bid\s+[\w-]+\.?/gi, '')
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\b([A-Za-z]{1,4})-(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?:;])/g, '$1')
    .replace(/\.\s*\./g, '.')
    .trim();
  const sentences = s.match(/[^.!?]+[.!?]*/g) || [];
  s = sentences.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
  if (s.length > MAX_SPOKEN_CHARS) s = `${s.slice(0, MAX_SPOKEN_CHARS).replace(/\s+\S*$/, '')}.`;
  return s;
}

/**
 * Words for speech to text to expect: the template's checklist and entity
 * words, then the item names (most likely to be misheard: "D1-18" for
 * "D-118"). Whisper keeps only the end of a long hint, so names go last and
 * the list stays short.
 */
export function transcriptionHints(bridge, { maxNames = 40, maxWords = 16 } = {}) {
  const seen = new Set();
  const take = (list, max) => {
    const out = [];
    for (const raw of list) {
      const value = String(raw || '').trim().slice(0, 40);
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      out.push(value);
      if (out.length >= max) break;
    }
    return out;
  };
  const template = bridge?.template || {};
  const categories = (template.modules || []).flatMap((m) => m?.categories || []);
  const words = take([
    ...categories.map((c) => c?.name),
    ...categories.flatMap((c) => (c?.checklist || []).map((item) => item?.text)),
    ...(template.entities || []).map((e) => e?.name),
  ], maxWords);
  const names = take(Object.values(bridge?.markers || {}).map((m) => m?.name), maxNames);
  return [...words, ...names];
}

/**
 * Speech to text sometimes loops on a short stretch ("D-118, D-118, D-118,
 * ..."). Keep one copy of any phrase repeated three or more times in a row.
 */
export function cleanTranscript(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const next = s.replace(/(\b.{2,40}?)(?:[\s,.;]+\1\b){2,}[\s,.;]*/gi, '$1 ').trim();
    if (next === s) break;
    s = next;
  }
  return s.replace(/[\s,;]+$/, '');
}
