#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'ios', 'App', 'App.xcodeproj');
const SCHEME = 'App';
const BUNDLE_ID = 'com.kalvoe.survey';
const DEFAULT_DEVICE_NAME = 'iPhone 17 Pro Max';
const runKey = createHash('sha1').update(ROOT).digest('hex').slice(0, 8);
const artifactRoot = path.resolve(
  process.env.MOBILE_IOS_ARTIFACT_DIR || path.join(tmpdir(), `survey-ios-simulator-${runKey}`),
);
const derivedData = path.join(artifactRoot, 'DerivedData');
const cliArgs = new Set(process.argv.slice(2));

if (cliArgs.has('--help')) {
  console.log(`Usage: npm run mobile:ios:sim -- [--skip-sync] [--no-open]

Builds and launches Survey in the newest available iPhone 17 Pro Max simulator.

Environment overrides:
  MOBILE_IOS_SIMULATOR_UDID   Use one exact available simulator
  MOBILE_IOS_DEVICE_NAME      Select another device name
  MOBILE_IOS_ARTIFACT_DIR     DerivedData, screenshot, and metadata directory`);
  process.exit(0);
}

function commandText(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

async function run(command, args, options = {}) {
  const { capture = false, env = process.env, allowFailure = false } = options;
  if (!capture) console.log(`\n$ ${commandText(command, args)}`);

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || allowFailure) {
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }
      const detail = capture ? `\n${stderr || stdout}` : '';
      reject(new Error(`${commandText(command, args)} failed with exit code ${code}${detail}`));
    });
  });
}

function runtimeVersion(runtime) {
  const match = runtime.match(/\.iOS-(\d+)(?:-(\d+))?(?:-(\d+))?$/);
  return match ? match.slice(1).map((value) => Number(value || 0)) : [0, 0, 0];
}

function compareVersions(left, right) {
  const a = runtimeVersion(left);
  const b = runtimeVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (b[index] || 0) - (a[index] || 0);
  }
  return 0;
}

async function selectSimulator() {
  const result = await run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { capture: true });
  const payload = JSON.parse(result.stdout);
  const requestedUdid = process.env.MOBILE_IOS_SIMULATOR_UDID?.trim();
  const requestedName = process.env.MOBILE_IOS_DEVICE_NAME?.trim() || DEFAULT_DEVICE_NAME;
  const candidates = Object.entries(payload.devices || {})
    .flatMap(([runtime, devices]) => devices.map((device) => ({ ...device, runtime })))
    .filter((device) => device.isAvailable !== false);

  if (requestedUdid) {
    const exact = candidates.find((device) => device.udid === requestedUdid);
    if (!exact) throw new Error(`Simulator ${requestedUdid} is not available.`);
    return exact;
  }

  const matching = candidates
    .filter((device) => device.name === requestedName)
    .sort((left, right) => compareVersions(left.runtime, right.runtime));
  if (!matching.length) {
    const names = [...new Set(candidates.map((device) => device.name))].sort().join(', ');
    throw new Error(`No available ${requestedName} simulator. Available device names: ${names}`);
  }
  return matching[0];
}

async function frameHasAppContent(screenshotPath) {
  const png = PNG.sync.read(await readFile(screenshotPath));
  const startY = Math.floor(png.height * 0.16);
  const endY = Math.floor(png.height * 0.95);
  let count = 0;
  let sum = 0;
  let squareSum = 0;
  let minimum = 255;
  let maximum = 0;

  for (let y = startY; y < endY; y += 8) {
    for (let x = 0; x < png.width; x += 8) {
      const offset = (y * png.width + x) * 4;
      const luminance = (png.data[offset] * 0.2126)
        + (png.data[offset + 1] * 0.7152)
        + (png.data[offset + 2] * 0.0722);
      count += 1;
      sum += luminance;
      squareSum += luminance * luminance;
      minimum = Math.min(minimum, luminance);
      maximum = Math.max(maximum, luminance);
    }
  }

  const mean = sum / count;
  const standardDeviation = Math.sqrt(Math.max(0, (squareSum / count) - (mean * mean)));
  return maximum - minimum > 30 && standardDeviation > 5;
}

async function capturePaintedFrame(simulatorUdid, screenshotPath) {
  const startedAt = Date.now();
  const timeoutMs = 45_000;
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await run(
      'xcrun',
      ['simctl', 'io', simulatorUdid, 'screenshot', '--type=png', screenshotPath],
      { capture: true },
    );
    if (await frameHasAppContent(screenshotPath)) return Date.now() - startedAt;
  }
  throw new Error(`App did not paint a visible UI within ${timeoutMs / 1000} seconds. Last frame: ${screenshotPath}`);
}

async function main() {
  await mkdir(artifactRoot, { recursive: true });
  const simulator = await selectSimulator();
  console.log(`Selected ${simulator.name} (${simulator.runtime.replace('com.apple.CoreSimulator.SimRuntime.', '')})`);
  console.log(`UDID: ${simulator.udid}`);

  if (simulator.state !== 'Booted') {
    await run('xcrun', ['simctl', 'boot', simulator.udid]);
  }
  if (!cliArgs.has('--no-open')) {
    await run('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', simulator.udid]);
  }

  if (!cliArgs.has('--skip-sync')) {
    await run('npm', ['run', 'mobile:sync'], {
      env: { ...process.env, CAPACITOR_SERVER_URL: '' },
    });
  } else {
    console.log('\nSkipping web build and Capacitor sync by explicit request.');
  }

  const sourceCommit = (await run('git', ['rev-parse', 'HEAD'], { capture: true })).stdout;
  const distReleasePath = path.join(ROOT, 'dist', 'release.json');
  const distRelease = JSON.parse(await readFile(distReleasePath, 'utf8'));
  if (distRelease.commit !== sourceCommit) {
    throw new Error(`Simulator bundle commit ${distRelease.commit || 'unknown'} does not match source ${sourceCommit}. Run without --skip-sync.`);
  }
  console.log(`Verified web bundle commit ${sourceCommit.slice(0, 8)}.`);

  await run('xcodebuild', [
    '-project', PROJECT,
    '-scheme', SCHEME,
    '-configuration', 'Debug',
    '-sdk', 'iphonesimulator',
    '-destination', `platform=iOS Simulator,id=${simulator.udid}`,
    '-derivedDataPath', derivedData,
    'CODE_SIGNING_ALLOWED=NO',
    'build',
  ]);

  const appPath = path.join(derivedData, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app');
  await access(appPath);
  const appReleasePath = path.join(appPath, 'public', 'release.json');
  const appRelease = JSON.parse(await readFile(appReleasePath, 'utf8'));
  if (appRelease.commit !== sourceCommit) {
    throw new Error(`Built iOS app commit ${appRelease.commit || 'unknown'} does not match source ${sourceCommit}.`);
  }
  await run('xcrun', ['simctl', 'bootstatus', simulator.udid, '-b']);
  await run('xcrun', ['simctl', 'install', simulator.udid, appPath]);
  const launch = await run(
    'xcrun',
    ['simctl', 'launch', '--terminate-running-process', simulator.udid, BUNDLE_ID],
    { capture: true },
  );
  console.log(`Launched ${launch.stdout || BUNDLE_ID}`);

  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const screenshotPath = path.join(artifactRoot, `survey-${timestamp}.png`);
  const metadataPath = path.join(artifactRoot, `survey-${timestamp}.json`);
  const paintWaitMs = await capturePaintedFrame(simulator.udid, screenshotPath);
  await writeFile(metadataPath, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    device: simulator.name,
    runtime: simulator.runtime,
    udid: simulator.udid,
    bundleId: BUNDLE_ID,
    sourceCommit,
    release: appRelease,
    appPath,
    screenshotPath,
    launch: launch.stdout,
    paintWaitMs,
  }, null, 2)}\n`);

  console.log('\nSurvey is running in Simulator.');
  console.log(`Visible UI painted in ${(paintWaitMs / 1000).toFixed(1)}s.`);
  console.log(`Screenshot: ${screenshotPath}`);
  console.log(`Metadata:   ${metadataPath}`);
}

main().catch((error) => {
  console.error(`\nSimulator run failed: ${error.message}`);
  process.exitCode = 1;
});
