#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const valueArg = (name, fallback) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const device = valueArg('--device', 'all');
const serial = args.includes('--serial');
const requestedSuites = new Set(valueArg('--suite', 'annotations,advanced,viewer,projects,surveys,hub').split(',').filter(Boolean));

if (!['mobile', 'desktop', 'all'].includes(device)) {
  throw new Error(`Unsupported --device=${device}; use mobile, desktop, or all`);
}

const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputDir = path.resolve('.playwright-mcp', 'full-app-e2e', timestamp);
fs.mkdirSync(outputDir, { recursive: true });

const suites = [
  {
    id: 'annotations',
    devices: ['mobile'],
    command: ['node', 'agent-cli/mobile-annotations-e2e.mjs'],
  },
  {
    id: 'advanced',
    devices: ['mobile'],
    command: ['node', 'agent-cli/mobile-annotations/advanced-selftest.mjs'],
  },
  {
    id: 'viewer',
    devices: ['mobile', 'desktop'],
    command: ['node', 'agent-cli/mobile-workflows/viewer-auxiliary-e2e.mjs', `--device=${device}`],
  },
  {
    id: 'projects',
    devices: ['mobile', 'desktop'],
    command: ['node', 'agent-cli/mobile-workflows/project-document-e2e.mjs', `--device=${device}`],
  },
  {
    id: 'surveys',
    devices: ['mobile', 'desktop'],
    command: ['node', 'agent-cli/mobile-workflows/survey-template-e2e.mjs', `--device=${device}`],
  },
  {
    id: 'hub',
    devices: ['mobile', 'desktop'],
    command: ['node', 'agent-cli/mobile-workflows/hub-resilience-e2e.mjs', `--device=${device}`],
  },
].filter((suite) => requestedSuites.has(suite.id))
  .filter((suite) => device === 'all' || suite.devices.includes(device));

if (suites.length === 0) throw new Error('No suites selected');

function runSuite(suite) {
  const [executable, ...commandArgs] = suite.command;
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const lines = [];
  console.log(`[${suite.id}] START ${suite.command.join(' ')}`);

  return new Promise((resolve) => {
    const child = spawn(executable, commandArgs, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const consume = (chunk, stream) => {
      const text = String(chunk);
      lines.push(text);
      for (const line of text.trimEnd().split('\n')) {
        if (line) console[stream](`[${suite.id}] ${line}`);
      }
    };
    child.stdout.on('data', (chunk) => consume(chunk, 'log'));
    child.stderr.on('data', (chunk) => consume(chunk, 'error'));
    child.on('error', (error) => lines.push(`\n${error.stack || error.message}\n`));
    child.on('close', (code, signal) => {
      const output = lines.join('');
      const artifact = [...output.matchAll(/artifacts:\s*(.+)/gi)].at(-1)?.[1]?.trim() || null;
      const result = {
        id: suite.id,
        command: suite.command,
        startedAt,
        durationMs: Date.now() - startedMs,
        exitCode: code,
        signal,
        status: code === 0 ? 'passed' : 'failed',
        artifact,
      };
      fs.writeFileSync(path.join(outputDir, `${suite.id}.log`), output);
      console.log(`[${suite.id}] ${result.status.toUpperCase()} ${result.durationMs}ms`);
      resolve(result);
    });
  });
}

const results = [];
if (serial) {
  for (const suite of suites) results.push(await runSuite(suite));
} else {
  results.push(...await Promise.all(suites.map(runSuite)));
}

const summary = {
  schemaVersion: 1,
  kind: 'survey-fast-full-app-e2e',
  proofLayer: 'FAST',
  durablePersistenceCertified: false,
  device,
  serial,
  startedAt: timestamp,
  finishedAt: new Date().toISOString(),
  status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
  results,
};
const summaryPath = path.join(outputDir, 'summary.json');
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(`RESULT: ${summary.status.toUpperCase()}`);
console.log(`artifacts: ${summaryPath}`);
if (summary.status !== 'passed') process.exitCode = 1;
