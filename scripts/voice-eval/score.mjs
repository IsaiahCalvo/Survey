// Step 5: how often the item name was heard right. Each transcript is put
// through the app's own clean-up (cleanTranscript, snapItemNames), then:
// right = the meant name and no other, wrong = another item's name (alone
// or beside the meant one), missed = no item name at all. looped = Whisper
// repeated a name three times or more (it was looping on the hint).
// node scripts/voice-eval/score.mjs <workdir> <stt.jsonl> [<stt2.jsonl> ...]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanTranscript, snapItemNames } from '../../src/agent/voiceLoop.js';
import { NAMES } from './survey.mjs';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const finders = NAMES.map((name) => ({ name, re: new RegExp(`(^|[^\\w-])${escape(name)}(?![\\w-])`, 'i') }));

export function judge(text, meant) {
  const heard = snapItemNames(cleanTranscript(text), NAMES);
  const found = finders.filter((f) => f.re.test(heard)).map((f) => f.name);
  const verdict = found.length === 1 && found[0] === meant ? 'right' : found.length ? 'wrong' : 'missed';
  const counts = new Map();
  for (const m of snapItemNames(String(text || ''), NAMES).matchAll(/[A-Z]+-\d+/g)) counts.set(m[0], (counts.get(m[0]) || 0) + 1);
  const looped = [...counts.values()].some((n) => n >= 3);
  return { heard, found, verdict, looped };
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');

export function scoreRows(manifest, rows) {
  const byFile = new Map(manifest.items.map((i) => [i.file, i]));
  return rows.filter((r) => byFile.has(r.file)).map((r) => {
    const item = byFile.get(r.file);
    return { ...item, text: r.text, ...judge(r.text, item.name) };
  });
}

function table(scored, keyOf, title) {
  const groups = new Map();
  for (const s of scored) {
    const k = keyOf(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const lines = [`| ${title} | clips | right | wrong | missed | looped | gate cut right |`, '|---|---|---|---|---|---|---|'];
  for (const [k, list] of groups) {
    const n = (v) => list.filter((s) => s.verdict === v).length;
    lines.push(`| ${k} | ${list.length} | ${pct(n('right'), list.length)} | ${pct(n('wrong'), list.length)} | ${pct(n('missed'), list.length)} | ${pct(list.filter((s) => s.looped).length, list.length)} | ${pct(list.filter((s) => s.gate?.ok).length, list.length)} |`);
  }
  return lines.join('\n');
}

export function report(manifest, runs) {
  const out = [];
  for (const { label, rows } of runs) {
    const scored = scoreRows(manifest, rows);
    const right = scored.filter((s) => s.verdict === 'right').length;
    out.push(`### ${label}: ${right}/${scored.length} right (${pct(right, scored.length)})`, '');
    out.push(table(scored, (s) => (s.snr == null ? 'clean' : `${s.noise} at ${s.snr} dB`), 'noise'), '');
    out.push(table(scored, (s) => `"${s.said}"`, 'said'), '');
    const misses = scored.filter((s) => s.verdict !== 'right');
    if (misses.length) {
      out.push('Misheard (first 15):', '');
      for (const s of misses.slice(0, 15)) out.push(`- ${s.file}: meant ${s.name}, heard "${s.heard}" (${s.verdict})`);
      out.push('');
    }
  }
  return out.join('\n');
}

const [work, ...files] = process.argv.slice(2);
if (work && files.length) {
  const manifest = JSON.parse(readFileSync(join(work, 'manifest.json'), 'utf8'));
  const runs = files.map((f) => ({
    label: f.replace(/^.*\//, '').replace(/\.jsonl$/, ''),
    rows: readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  }));
  console.log(report(manifest, runs));
}
