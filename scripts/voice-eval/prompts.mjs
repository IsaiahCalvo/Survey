// Step 3b: other hint texts to compare, written into manifest.json as
// manifest.prompts (transcribe.py --prompt KEY). "ranges" is what the app
// sends now: names as ranges ("D-101 to D-130"), not one by one.
// node scripts/voice-eval/prompts.mjs <workdir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hintsFor } from './survey.mjs';

const work = process.argv[2];
const manifest = JSON.parse(readFileSync(join(work, 'manifest.json'), 'utf8'));
const prompt = (hints) => `Construction site survey. Words and item names: ${hints.join(', ')}.`;
manifest.prompts = { ...manifest.prompts, ranges: prompt(hintsFor()) };
writeFileSync(join(work, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(manifest.prompts);
