// The survey the noisy-site test pretends is open: its item names, checklist
// words and the hint text the app would send with each clip.
import { transcriptionHints } from '../../src/agent/voiceLoop.js';

const range = (prefix, from, to, pad = 0) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(pad, '0')}`);
export const NAMES = [...range('D-', 101, 130), ...range('CAM-', 1, 12), ...range('AP-', 1, 8), ...range('FA-', 201, 210)];

export const TEMPLATE = {
  name: 'Security walk',
  modules: [{
    categories: [
      { name: 'Doors', checklist: [{ text: 'Card reader installed' }, { text: 'Lock' }, { text: 'Door closer' }, { text: 'Power at door' }] },
      { name: 'Cameras', checklist: [{ text: 'Mounted' }, { text: 'Cable pulled' }] },
      { name: 'Access points', checklist: [{ text: 'Mounted' }] },
      { name: 'Fire alarm', checklist: [{ text: 'Horn strobe' }] },
    ],
  }],
};

// What is said (as words, the way a person says the tag) and the item meant.
export const PHRASES = [
  { said: 'D one seventeen, card reader installed.', name: 'D-117' },
  { said: 'D one eighteen, no power.', name: 'D-118' },
  { said: 'Camera twelve is mounted.', name: 'CAM-12' },
  { said: 'A P three, cable pulled.', name: 'AP-3' },
  { said: 'F A two oh four, horn strobe missing.', name: 'FA-204' },
  { said: 'D one twenty nine, lock yes.', name: 'D-129' },
  { said: 'D one oh seven, door closer broken.', name: 'D-107' },
  { said: 'Cam five, no power.', name: 'CAM-5' },
];

export function hintsFor({ recent = [] } = {}) {
  const markers = Object.fromEntries(NAMES.map((name, i) => [`m${i}`, { name }]));
  const ids = Object.fromEntries(NAMES.map((name, i) => [name, `m${i}`]));
  return transcriptionHints({ template: TEMPLATE, markers }, { recent: recent.map((n) => ids[n]).filter(Boolean) });
}
