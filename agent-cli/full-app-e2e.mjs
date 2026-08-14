#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  coverageForSuites,
  FAST_SUITE_IDS,
  FULL_APP_COVERAGE,
  NATIVE_SUITE_IDS,
} from './mobile-annotations/coverage.mjs';

const args = process.argv.slice(2);
const valueArg = (name, fallback) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const device = valueArg('--device', 'all');
const serial = args.includes('--serial');
const includeNative = args.includes('--native');
const listSuites = args.includes('--list-suites');
const requestedSuiteValue = valueArg(
  '--suite',
  [...FAST_SUITE_IDS, ...(includeNative ? NATIVE_SUITE_IDS : [])].join(','),
);
const requestedSuites = new Set(requestedSuiteValue.split(',').map((value) => value.trim()).filter(Boolean));
const concurrencyArg = Number(valueArg('--concurrency', '3'));

if (!['mobile', 'desktop', 'all'].includes(device)) {
  throw new Error(`Unsupported --device=${device}; use mobile, desktop, or all`);
}
if (!Number.isInteger(concurrencyArg) || concurrencyArg < 1) {
  throw new Error('--concurrency must be a positive integer');
}

if (listSuites) {
  for (const [id, coverage] of Object.entries(FULL_APP_COVERAGE)) {
    const lane = coverage.external ? 'external' : coverage.proof;
    console.log(`${id}\t${lane}\t${coverage.surfaces.join(',')}\t${coverage.covers.join('; ')}`);
  }
  process.exit(0);
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
    id: 'advanced-entities',
    devices: ['mobile'],
    command: ['node', 'agent-cli/mobile-annotations/advanced-selftest.mjs', 'survey-marker', 'region'],
  },
  {
    id: 'secondary',
    devices: ['mobile'],
    command: ['node', 'agent-cli/mobile-annotations/secondary-selftest.mjs'],
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
  {
    id: 'stability',
    devices: ['mobile'],
    command: ['node', 'agent-cli/mobile-workflows/document-idle-stability-e2e.mjs'],
  },
  {
    id: 'contracts',
    devices: ['mobile', 'desktop'],
    command: [
      'node', '--test',
      'tests/authAccountFlows.test.mjs',
      'tests/guestAccountChrome.test.mjs',
      'tests/mobileRuntimeCompatibility.test.mjs',
      'tests/pdfjsPresentationEngine.test.mjs',
      'tests/mobileProjectDocumentWorkflowContracts.test.mjs',
      'tests/mobileSurveyTemplateWorkflowContract.test.mjs',
      'tests/surveyTemplateWorkflowContract.test.mjs',
      'tests/hubResilienceWorkflowContract.test.mjs',
      'tests/syncStatusUi.test.mjs',
      'tests/testAccountLease.test.mjs',
    ],
  },
  {
    id: 'native-pinch',
    devices: ['mobile'],
    command: ['node', 'scripts/test-ios-native-pinch.mjs'],
  },
  {
    id: 'native-zoomout',
    devices: ['mobile'],
    command: ['node', 'scripts/test-ios-native-pinch.mjs'],
    env: {
      MOBILE_PINCH_FIXTURE: 'se011.pdf',
      MOBILE_PINCH_ONLY: 'AppNativePinchUITests/NativePinchUITests/testSlowZoomOutFromDeepScaleDoesNotTerminateWebContentProcess',
    },
  },
].filter((suite) => requestedSuites.has(suite.id))
  .filter((suite) => device === 'all' || suite.devices.includes(device));

const knownSuiteIds = new Set(Object.keys(FULL_APP_COVERAGE).filter((id) => id !== 'durable'));
if (requestedSuites.has('durable')) {
  throw new Error('The durable lane must run through scripts/test-account-lease.mjs; see docs/FULL-APP-E2E.md');
}
const unknownSuites = [...requestedSuites].filter((id) => !knownSuiteIds.has(id));
if (unknownSuites.length) throw new Error(`Unknown suite(s): ${unknownSuites.join(', ')}`);
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
      env: { ...process.env, FORCE_COLOR: '0', ...(suite.env || {}) },
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
  let cursor = 0;
  const slots = Array.from({ length: Math.min(concurrencyArg, suites.length) }, async () => {
    while (cursor < suites.length) {
      const suite = suites[cursor];
      cursor += 1;
      results.push(await runSuite(suite));
    }
  });
  await Promise.all(slots);
}

results.sort((left, right) => suites.findIndex((suite) => suite.id === left.id)
  - suites.findIndex((suite) => suite.id === right.id));

const summary = {
  schemaVersion: 1,
  kind: 'survey-full-app-e2e',
  proofLayers: [...new Set(suites.map((suite) => FULL_APP_COVERAGE[suite.id].proof))],
  device,
  serial,
  concurrency: serial ? 1 : Math.min(concurrencyArg, suites.length),
  requestedSuites: [...requestedSuites],
  coverage: coverageForSuites(suites.map((suite) => suite.id)),
  nativeGestureCertificationIncluded: suites.some((suite) => NATIVE_SUITE_IDS.includes(suite.id)),
  durablePersistenceCertified: false,
  durableLane: {
    included: false,
    reason: 'Requires an exact coordinator-assigned real-account lease and separate cleanup attestation.',
  },
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
