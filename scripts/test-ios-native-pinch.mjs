#!/usr/bin/env node

import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureViteServer } from '../agent-cli/mobile-annotations/vite-server.mjs';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.join(root, 'ios', 'App', 'App.xcodeproj');
const nativeConfigPath = path.join(root, 'ios', 'App', 'App', 'capacitor.config.json');
const runKey = createHash('sha1').update(root).digest('hex').slice(0, 8);
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const artifactDir = path.resolve(
  process.env.MOBILE_IOS_PINCH_ARTIFACT_DIR
    || path.join(tmpdir(), `survey-ios-native-pinch-${runKey}`, stamp),
);

function run(command, args, { capture = false, outputPath = null } = {}) {
  return new Promise((resolve, reject) => {
    console.log(`$ ${[command, ...args].join(' ')}`);
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: capture || outputPath ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '';
    if (capture || outputPath) {
      child.stdout.on('data', (chunk) => { output += chunk; if (outputPath) process.stdout.write(chunk); });
      child.stderr.on('data', (chunk) => { output += chunk; if (outputPath) process.stderr.write(chunk); });
    }
    child.once('error', reject);
    child.once('close', async (code) => {
      if (outputPath) await writeFile(outputPath, output);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function runtimeVersion(runtime) {
  return (runtime.match(/\.iOS-(\d+)(?:-(\d+))?(?:-(\d+))?$/)?.slice(1) || ['0'])
    .map((value) => Number(value || 0));
}

function compareRuntime(left, right) {
  const a = runtimeVersion(left.runtime);
  const b = runtimeVersion(right.runtime);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (b[index] || 0) - (a[index] || 0);
  }
  return 0;
}

async function selectSimulator() {
  const raw = await run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { capture: true });
  const requested = process.env.MOBILE_IOS_SIMULATOR_UDID?.trim();
  const devices = Object.entries(JSON.parse(raw).devices || {})
    .flatMap(([runtime, entries]) => entries.map((device) => ({ ...device, runtime })))
    .filter((device) => device.isAvailable !== false);
  if (requested) {
    const exact = devices.find((device) => device.udid === requested);
    if (!exact) throw new Error(`Simulator ${requested} is not available`);
    return exact;
  }
  const booted = devices.filter((device) => device.state === 'Booted').sort(compareRuntime);
  if (booted.length) return booted[0];
  const preferred = devices.filter((device) => device.name === 'iPhone 17 Pro Max').sort(compareRuntime);
  if (!preferred.length) throw new Error('No iPhone Simulator is available');
  return preferred[0];
}

async function largestWhiteSurface(imagePath) {
  const { data, info } = await sharp(imagePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const white = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * info.channels;
    white[index] = data[offset] >= 238 && data[offset + 1] >= 238 && data[offset + 2] >= 238 ? 1 : 0;
  }
  const queue = new Int32Array(pixels);
  let best = null;
  for (let start = 0; start < pixels; start += 1) {
    if (!white[start]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    white[start] = 0;
    let minX = start % info.width;
    let maxX = minX;
    let minY = Math.floor(start / info.width);
    let maxY = minY;
    while (head < tail) {
      const current = queue[head++];
      const x = current % info.width;
      const y = Math.floor(current / info.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const neighbors = [current - 1, current + 1, current - info.width, current + info.width];
      for (const next of neighbors) {
        if (next < 0 || next >= pixels || !white[next]) continue;
        if ((next === current - 1 || next === current + 1) && Math.floor(next / info.width) !== y) continue;
        white[next] = 0;
        queue[tail++] = next;
      }
    }
    if (!best || tail > best.pixelCount) {
      best = { height: maxY - minY + 1, maxX, maxY, minX, minY, pixelCount: tail, width: maxX - minX + 1 };
    }
  }
  return best;
}

async function meanAbsoluteImageDifference(leftPath, rightPath) {
  const left = await sharp(leftPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const right = await sharp(rightPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(left.info, right.info, 'Native stress screenshots have different geometry');
  let total = 0;
  for (let index = 0; index < left.data.length; index += 1) {
    total += Math.abs(left.data[index] - right.data[index]);
  }
  return total / left.data.length;
}

async function main() {
  await mkdir(artifactDir, { recursive: true });
  const simulator = await selectSimulator();
  if (simulator.state !== 'Booted') await run('xcrun', ['simctl', 'boot', simulator.udid]);
  await run('xcrun', ['simctl', 'bootstatus', simulator.udid, '-b']);

  const { baseUrl, managedProcess } = await ensureViteServer(process.env.MOBILE_QA_BASE_URL || null);
  const originalConfigText = await readFile(nativeConfigPath, 'utf8');
  const testUrl = new URL(baseUrl);
  testUrl.searchParams.set('testPdf', 'clickable-link-test.pdf');
  testUrl.searchParams.set('mobileNav', 'tabs');
  testUrl.searchParams.set('nativeShell', 'capacitor');
  testUrl.searchParams.set('nativePinchE2E', '1');

  try {
    const config = JSON.parse(originalConfigText);
    config.server = { url: testUrl.toString(), cleartext: true };
    await writeFile(nativeConfigPath, `${JSON.stringify(config, null, 2)}\n`);

    const resultBundle = path.join(artifactDir, 'NativePinch.xcresult');
    const buildLog = path.join(artifactDir, 'xcodebuild.log');
    await run('xcodebuild', [
      '-project', project,
      '-scheme', 'AppNativePinch',
      '-configuration', 'Debug',
      '-destination', `platform=iOS Simulator,id=${simulator.udid}`,
      '-derivedDataPath', path.join(artifactDir, 'DerivedData'),
      '-resultBundlePath', resultBundle,
      '-quiet',
      '-only-testing:AppNativePinchUITests/NativePinchUITests',
      'CODE_SIGNING_ALLOWED=NO',
      'test',
    ], { outputPath: buildLog });

    const attachmentsDir = path.join(artifactDir, 'attachments');
    await mkdir(attachmentsDir, { recursive: true });
    await run('xcrun', ['xcresulttool', 'export', 'attachments', '--path', resultBundle, '--output-path', attachmentsDir]);
    const attachmentManifest = JSON.parse(await readFile(path.join(attachmentsDir, 'manifest.json'), 'utf8'));
    const attachments = attachmentManifest.flatMap((entry) => entry.attachments || []);
    const findAttachment = (prefix) => attachments.find((entry) => entry.suggestedHumanReadableName?.startsWith(prefix));
    const beforeAttachment = findAttachment('before-native-pinch');
    const afterAttachment = findAttachment('after-native-pinch');
    const beforeStressAttachment = findAttachment('before-rapid-pinch-stress');
    const afterStressAttachment = findAttachment('after-rapid-pinch-stress');
    assert.ok(beforeAttachment && afterAttachment, 'XCTest did not retain both native pinch screenshots');
    assert.ok(beforeStressAttachment && afterStressAttachment, 'XCTest did not retain both native stress screenshots');
    const beforeScreenshot = path.join(attachmentsDir, beforeAttachment.exportedFileName);
    const afterScreenshot = path.join(attachmentsDir, afterAttachment.exportedFileName);
    const beforeStressScreenshot = path.join(attachmentsDir, beforeStressAttachment.exportedFileName);
    const afterStressScreenshot = path.join(attachmentsDir, afterStressAttachment.exportedFileName);
    const beforePage = await largestWhiteSurface(beforeScreenshot);
    const afterPage = await largestWhiteSurface(afterScreenshot);
    assert.ok(beforePage?.pixelCount > 100_000 && afterPage?.pixelCount > 100_000, 'Could not locate the visible PDF page in native screenshots');
    const visibleScaleRatio = Math.max(
      afterPage.width / beforePage.width,
      afterPage.height / beforePage.height,
      beforePage.width / afterPage.width,
      beforePage.height / afterPage.height,
    );
    assert.ok(visibleScaleRatio > 1.05, `Native pinch changed app state but not visible PDF geometry (${visibleScaleRatio.toFixed(3)}x)`);
    const stressImageDifference = await meanAbsoluteImageDifference(beforeStressScreenshot, afterStressScreenshot);
    assert.ok(
      stressImageDifference < 12,
      `Native pinch stress did not restore the rendered PDF after Fit Page (mean image difference ${stressImageDifference.toFixed(2)})`,
    );

    const screenshotPath = path.join(artifactDir, 'final-simulator.png');
    await run('xcrun', ['simctl', 'io', simulator.udid, 'screenshot', '--type=png', screenshotPath]);
    const log = await readFile(buildLog, 'utf8');
    const evidence = log.match(/NATIVE_PINCH_EVIDENCE[^\r\n]*/)?.[0] || 'Recorded in NativePinch.xcresult attachments';
    const summaryPath = path.join(artifactDir, 'summary.json');
    await writeFile(summaryPath, `${JSON.stringify({
      assertion: 'Accessible viewer state changes from a selected fit mode to manual zoom',
      device: simulator.name,
      evidence,
      input: 'XCUIElement.pinch(withScale:velocity:) native two-contact gesture',
      nativeScreenshots: { after: afterScreenshot, before: beforeScreenshot },
      stressScreenshots: {
        after: afterStressScreenshot,
        before: beforeStressScreenshot,
        meanAbsoluteDifference: stressImageDifference,
      },
      pageGeometry: { after: afterPage, before: beforePage, visibleScaleRatio },
      result: 'passed',
      resultBundle,
      runtime: simulator.runtime,
      screenshotPath,
      testUrl: testUrl.toString(),
      udid: simulator.udid,
    }, null, 2)}\n`);
    console.log(`\n✅ Native two-finger pinch passed\nEvidence: ${summaryPath}\nXcode result: ${resultBundle}`);
  } finally {
    await writeFile(nativeConfigPath, originalConfigText);
    if (managedProcess) managedProcess.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(`\nNative pinch test failed: ${error.message}`);
  process.exitCode = 1;
});
