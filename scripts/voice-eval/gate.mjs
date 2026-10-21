// Step 3: runs the app's own speech gate (voiceLoop.js) over each noisy
// clip, frame by frame as the hands-free mic does, and records where it cut.
// node scripts/voice-eval/gate.mjs <workdir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIN_GATE, createBandLevel, createSpeechGate, frameLevel } from '../../src/agent/voiceLoop.js';

const RATE = 16_000;
const FRAME = 341; // about 21 ms, as the mic's 1024-sample buffer at 48 kHz
const PRE_ROLL_S = 0.35;

function readWav(path) {
  const buf = readFileSync(path);
  const pcm = new Int16Array(buf.buffer, buf.byteOffset + 44, (buf.length - 44) / 2);
  return Float32Array.from(pcm, (v) => v / 32768);
}

// `band`: the mic's speech-band loudness and settings (as shipped); false
// gives the older whole-signal loudness, to compare.
export function cutClips(samples, { band = true, ...gateOptions } = {}) {
  const gate = createSpeechGate({ frameMs: (FRAME / RATE) * 1000, ...(band ? MAIN_GATE : {}), ...gateOptions });
  const level = band ? createBandLevel(RATE) : frameLevel;
  const clips = [];
  let start = null;
  for (let at = 0; at + FRAME <= samples.length; at += FRAME) {
    const result = gate.push(level(samples.subarray(at, at + FRAME)));
    if (result === 'start') start = Math.max(0, at / RATE - PRE_ROLL_S);
    else if (result === 'end') { clips.push({ from: start, to: (at + FRAME) / RATE }); start = null; }
    else if (result === 'discard') start = null;
  }
  if (start != null) clips.push({ from: start, to: samples.length / RATE, open: true });
  return clips;
}

const work = process.argv[2];
if (work) {
  const manifest = JSON.parse(readFileSync(join(work, 'manifest.json'), 'utf8'));
  const judge = (item, clips) => {
    const hit = clips.filter((c) => c.to > item.speech_from_s && c.from < item.speech_to_s);
    return {
      clips: clips.length,
      // Right: exactly one clip, holding all of the speech, and it closed.
      ok: hit.length === 1 && clips.length === 1 && hit[0].from <= item.speech_from_s + 0.05 && hit[0].to >= item.speech_to_s && !hit[0].open,
      cut: hit[0] || null,
    };
  };
  for (const item of manifest.items) {
    const samples = readWav(join(work, 'clips', item.file));
    item.gate = judge(item, cutClips(samples));
    item.oldGate = judge(item, cutClips(samples, { band: false }));
  }
  writeFileSync(join(work, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const count = (key) => manifest.items.filter((i) => i[key].ok).length;
  console.log(`gate cut right: ${count('gate')}/${manifest.items.length} (whole-signal gate: ${count('oldGate')})`);
}
