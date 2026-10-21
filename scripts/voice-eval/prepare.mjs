// Step 1: writes manifest-base.json (phrases, voices, hints) for make_clips.py.
// node scripts/voice-eval/prepare.mjs <workdir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PHRASES, hintsFor } from './survey.mjs';

const dir = process.argv[2] || 'voice-eval-work';
mkdirSync(dir, { recursive: true });
const hints = hintsFor().map((h) => String(h).slice(0, 40)).slice(0, 60).join(', ');
writeFileSync(join(dir, 'manifest-base.json'), JSON.stringify({
  prompt: `Construction site survey. Words and item names: ${hints}.`,
  voices: ['en-us', 'en-us+f2', 'en-gb'],
  phrases: PHRASES,
}, null, 2));
console.log('wrote', join(dir, 'manifest-base.json'));
