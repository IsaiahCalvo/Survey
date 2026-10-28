#!/usr/bin/env node
// Splits the signed-in E2E specs (tests/e2e-signed-in/*.spec.mjs) across CI
// machines. Each machine runs its own local Supabase stack, so shards never
// share a database; the split only decides which spec files run where.
//
//   node scripts/e2e-signed-in-shard.mjs 2 5         # spec paths for shard 2 of 5, one line
//   node scripts/e2e-signed-in-shard.mjs --plan 5    # every shard with its expected seconds
//   node scripts/e2e-signed-in-shard.mjs --record <job log>...
//       # rewrite tests/e2e-signed-in/spec-seconds.json from Playwright `list`
//       # reporter output (CI job logs work as is: pass every shard's log, or
//       # several full runs to average them)
//
// The seconds only BALANCE the shards: a stale or missing entry costs a little
// balance, never a test. A spec with no entry counts as the median spec.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = 'tests/e2e-signed-in';
const SECONDS_FILE = path.join(ROOT, SPEC_DIR, 'spec-seconds.json');

// Shard 1 also runs the production-build speed budget (e2e-signed-in.yml), about
// this long including its build, so it starts with that much load.
const SHARD_ONE_HEAD_START_SECONDS = 40;

export function listSpecFiles(root = ROOT) {
  return fs.readdirSync(path.join(root, SPEC_DIR))
    .filter((name) => name.endsWith('.spec.mjs'))
    .sort()
    .map((name) => `${SPEC_DIR}/${name}`);
}

export function readSpecSeconds(file = SECONDS_FILE) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

// Deterministic longest-processing-time split (same rule as the unit-test
// shards in scripts/run-node-tests.mjs): heaviest spec first, each into the
// currently lightest shard, ties broken by shard index and then by path.
export function shardSpecFiles(files, shardCount, seconds = readSpecSeconds()) {
  if (!Number.isInteger(shardCount) || shardCount < 1) throw new Error(`bad shard count ${shardCount}`);
  if (files.length < shardCount) throw new Error(`${files.length} specs cannot fill ${shardCount} shards`);
  const known = Object.values(seconds).sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weightOf = (file) => seconds[path.basename(file)] ?? fallback;

  const bins = Array.from({ length: shardCount }, (_, index) => ({
    files: [],
    load: index === 0 && shardCount > 1 ? SHARD_ONE_HEAD_START_SECONDS : 0,
  }));
  const ordered = [...files].sort((a, b) => weightOf(b) - weightOf(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const file of ordered) {
    let lightest = 0;
    for (let index = 1; index < bins.length; index += 1) {
      if (bins[index].load < bins[lightest].load) lightest = index;
    }
    bins[lightest].files.push(file);
    bins[lightest].load += weightOf(file);
  }
  return bins.map((bin) => ({ load: bin.load, files: bin.files.sort() }));
}

const LIST_LINE = /[✓✘-]\s+\d+ (?:\[.*?\] › )?tests\/e2e-signed-in\/([\w.-]+\.spec\.mjs):\d+:\d+ › .* \(([\d.]+)(ms|s|m)\)\s*$/;

export function secondsFromLogs(texts) {
  // A spec's seconds are averaged over the logs it appears in, so shard logs
  // (each spec in one) and repeat full runs (each spec in all) both work.
  const totals = {};
  const seenIn = {};
  for (const text of texts) {
    const seen = new Set();
    for (const line of text.split('\n')) {
      const match = line.match(LIST_LINE);
      if (!match) continue;
      const value = Number(match[2]);
      const unit = match[3];
      totals[match[1]] = (totals[match[1]] || 0) + (unit === 'ms' ? value / 1000 : unit === 'm' ? value * 60 : value);
      seen.add(match[1]);
    }
    for (const name of seen) seenIn[name] = (seenIn[name] || 0) + 1;
  }
  return Object.fromEntries(Object.keys(totals).sort()
    .map((name) => [name, Math.round((totals[name] / seenIn[name]) * 10) / 10]));
}

function main(argv) {
  if (argv[0] === '--record') {
    const logs = argv.slice(1);
    if (!logs.length) throw new Error('--record needs at least one log file');
    const seconds = secondsFromLogs(logs.map((file) => fs.readFileSync(file, 'utf8')));
    if (!Object.keys(seconds).length) throw new Error('no Playwright list-reporter lines found');
    fs.writeFileSync(SECONDS_FILE, `${JSON.stringify(seconds, null, 2)}\n`);
    console.log(`wrote ${Object.keys(seconds).length} specs to ${path.relative(ROOT, SECONDS_FILE)}`);
    return;
  }
  if (argv[0] === '--plan') {
    const shards = shardSpecFiles(listSpecFiles(), Number(argv[1]));
    shards.forEach((shard, index) => {
      console.log(`shard ${index + 1}: ~${Math.round(shard.load)}s, ${shard.files.length} specs`);
      for (const file of shard.files) console.log(`  ${file}`);
    });
    return;
  }
  const index = Number(argv[0]);
  const count = Number(argv[1]);
  if (!Number.isInteger(index) || index < 1 || index > count) {
    throw new Error('usage: e2e-signed-in-shard.mjs <index> <count> | --plan <count> | --record <log>...');
  }
  // One line: the workflow passes it straight to `playwright test` as filters.
  console.log(shardSpecFiles(listSpecFiles(), count)[index - 1].files.join(' '));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[e2e-signed-in-shard] ${error.message}`);
    process.exit(1);
  }
}
