#!/usr/bin/env node

/**
 * Build, install, and launch Survey on a PHYSICAL iPhone/iPad.
 *
 * Mirrors scripts/run-ios-simulator.mjs, but targets a paired device via
 * `xcrun devicectl` instead of `simctl`, and therefore has to code-sign.
 *
 *   npm run mobile:ios:device                      # embedded bundle (default)
 *   npm run mobile:ios:device -- --dev-server      # live Vite reload over Wi-Fi
 *   npm run mobile:ios:device -- --dev-server=http://100.x.y.z:5177/
 *
 * Bundled mode (default) builds `dist`, runs `npx cap sync ios`, builds the
 * Debug app for the device, installs it, launches it, and verifies the shipped
 * `release.json` commit matches the worktree HEAD — the same guarantee the
 * simulator runner gives.
 *
 * Dev-server mode points the native shell at a Vite server running on this Mac
 * so the phone live-reloads. The phone cannot reach 127.0.0.1, so the URL must
 * be a LAN or Tailscale address; the default is discovered automatically
 * (Tailscale MagicDNS host when tailscaled is up, otherwise the en0 LAN IP).
 * As in the simulator runner, the live URL is written only into a DISPOSABLE
 * copy of `ios/` — the checked-in Capacitor config stays production-safe.
 *
 * Signing: the App target uses automatic signing with the personal team
 * (DEVELOPMENT_TEAM in ios/App/App.xcodeproj). xcodebuild is invoked with
 * -allowProvisioningUpdates -allowProvisioningDeviceRegistration so it can mint
 * the profile and register the phone — that requires an Apple ID signed into
 * Xcode (Xcode -> Settings -> Accounts). Without it the build fails with
 * "No Accounts"; this script explains the fix rather than dumping raw xcodebuild.
 *
 * Note: there is no `xcrun devicectl device screenshot`, so unlike the
 * simulator runner this script cannot prove the painted frame. It verifies the
 * launch by reading back the launched process id from devicectl.
 */

import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { simulatorDevServerUrl, withSimulatorDevServer } from './ios-simulator-dev-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'ios', 'App', 'App.xcodeproj');
const SCHEME = 'App';
const BUNDLE_ID = 'com.kalvoe.survey';
const DEV_SERVER_PORT = 5177;
const runKey = createHash('sha1').update(ROOT).digest('hex').slice(0, 8);
const artifactRoot = path.resolve(
  process.env.MOBILE_IOS_ARTIFACT_DIR || path.join(tmpdir(), `survey-ios-device-${runKey}`),
);
const derivedData = path.join(artifactRoot, 'DerivedData');
const cliArgs = new Set(process.argv.slice(2));
const rawCliArgs = process.argv.slice(2);

function optionValue(name) {
  const inline = rawCliArgs.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = rawCliArgs.indexOf(name);
  const next = index >= 0 ? rawCliArgs[index + 1] : null;
  return next && !next.startsWith('--') ? next : null;
}

if (cliArgs.has('--help')) {
  console.log(`Usage: npm run mobile:ios:device -- [--dev-server[=<url>]] [--device <name|udid>] [--skip-sync] [--no-launch]

Builds Survey, installs it on a paired iPhone/iPad, and launches it.

  --dev-server[=<url>]  Load a live Vite dev server instead of the embedded web
                        assets (default: this Mac's Tailscale or LAN address on
                        port ${DEV_SERVER_PORT}). Must NOT be localhost — the phone
                        cannot reach this Mac's loopback interface.
  --device <name|udid>  Target a specific paired device
  --skip-sync           Reuse the existing dist/ and native copy
  --no-launch           Install only; do not launch

Environment overrides:
  MOBILE_IOS_DEVICE_UDID      Exact device identifier
  MOBILE_IOS_DEVICE_NAME      Device name to match
  MOBILE_IOS_DEV_SERVER_URL   Same as --dev-server=<url>
  MOBILE_IOS_ARTIFACT_DIR     DerivedData and metadata directory
  MOBILE_IOS_TEAM_ID          Override DEVELOPMENT_TEAM for this build`);
  process.exit(0);
}

function commandText(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

/**
 * Run a command. `capture` collects output instead of inheriting the terminal;
 * `tee` does both, which is what the long xcodebuild step wants (live progress
 * plus a transcript we can pattern-match for the known signing failures).
 */
async function run(command, args, options = {}) {
  const { capture = false, tee = false, env = process.env, allowFailure = false } = options;
  const piped = capture || tee;
  if (!capture) console.log(`\n$ ${commandText(command, args)}`);

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: piped ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    if (piped) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (tee) process.stdout.write(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        if (tee) process.stderr.write(chunk);
      });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code === 0 || allowFailure) {
        resolve(result);
        return;
      }
      const detail = capture ? `\n${stderr || stdout}` : '';
      const error = new Error(`${commandText(command, args)} failed with exit code ${code}${detail}`);
      error.result = result;
      reject(error);
    });
  });
}

async function commandOutput(command, args) {
  try {
    const result = await run(command, args, { capture: true, allowFailure: true });
    return result.code === 0 ? result.stdout : '';
  } catch {
    return '';
  }
}

/** Reachable host for the phone: Tailscale MagicDNS name if up, else the LAN IP. */
async function reachableHost() {
  const tailscaleStatus = await commandOutput('tailscale', ['status', '--json']);
  if (tailscaleStatus) {
    try {
      const status = JSON.parse(tailscaleStatus);
      const dnsName = status?.Self?.DNSName?.replace(/\.$/, '');
      if (dnsName) return dnsName;
      const tailscaleIp = status?.Self?.TailscaleIPs?.find((value) => !value.includes(':'));
      if (tailscaleIp) return tailscaleIp;
    } catch {
      // Fall through to the LAN address.
    }
  }
  for (const nic of ['en0', 'en1']) {
    const address = await commandOutput('ipconfig', ['getifaddr', nic]);
    if (address) return address;
  }
  throw new Error("Could not determine this Mac's LAN or Tailscale address. Pass --dev-server=<url> explicitly.");
}

async function resolveDevServerUrl() {
  const requested = optionValue('--dev-server') || process.env.MOBILE_IOS_DEV_SERVER_URL?.trim();
  const url = simulatorDevServerUrl(requested || `http://${await reachableHost()}:${DEV_SERVER_PORT}/`);
  const { hostname } = new URL(url);
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) {
    throw new Error(`A physical device cannot reach ${hostname}. Use this Mac's LAN or Tailscale address.`);
  }
  return url;
}

async function assertSurveyViteServer(serverUrl) {
  let html = '';
  try {
    const response = await fetch(serverUrl, { signal: AbortSignal.timeout(5_000) });
    html = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`Dev server ${serverUrl} is unreachable (${error.message}). Start it with \`npm run dev -- --host\`.`);
  }
  if (!html.includes('id="root"') || !html.includes('/src/entry.jsx')) {
    throw new Error(`Dev server is not the Survey Vite app: ${serverUrl}`);
  }
}

async function selectDevice() {
  const listPath = path.join(artifactRoot, 'devices.json');
  await run('xcrun', ['devicectl', 'list', 'devices', '-j', listPath], { capture: true });
  const payload = JSON.parse(await readFile(listPath, 'utf8'));
  const devices = (payload?.result?.devices || []).map((device) => ({
    identifier: device.identifier,
    name: device.deviceProperties?.name || 'unknown',
    platform: device.hardwareProperties?.platform,
    model: device.hardwareProperties?.marketingName || device.hardwareProperties?.productType,
    pairing: device.connectionProperties?.pairingState,
    transport: device.connectionProperties?.transportType,
    tunnel: device.connectionProperties?.tunnelState,
  }));

  const requestedUdid = optionValue('--device') || process.env.MOBILE_IOS_DEVICE_UDID?.trim();
  const requestedName = process.env.MOBILE_IOS_DEVICE_NAME?.trim();
  const usable = devices.filter((device) => device.platform === 'iOS' && device.pairing === 'paired');

  if (requestedUdid) {
    const exact = devices.find((device) => device.identifier === requestedUdid || device.name === requestedUdid);
    if (!exact) {
      throw new Error(`No paired device matches "${requestedUdid}". Paired iOS devices: ${usable.map((d) => `${d.name} (${d.identifier})`).join(', ') || 'none'}`);
    }
    return exact;
  }
  if (requestedName) {
    const named = usable.find((device) => device.name === requestedName);
    if (!named) throw new Error(`No paired iOS device named "${requestedName}".`);
    return named;
  }
  if (!usable.length) {
    throw new Error('No paired iOS device found. Connect the iPhone by USB (or same Wi-Fi), unlock it, and trust this Mac.');
  }
  return usable[0];
}

/**
 * xcodebuild's automatic signing failures are unreadable in a 2,000-line log,
 * and every one of them needs a human to do something in Xcode or on the phone.
 * Translate the two we actually hit into instructions.
 */
function signingHelp(log) {
  if (/No Accounts|Add a new account in Accounts settings/i.test(log)) {
    return [
      'Xcode has no Apple ID signed in, so it cannot create a provisioning profile.',
      'Fix (one time, on this Mac):',
      '  1. Open Xcode -> Settings... (Cmd+,) -> Accounts',
      '  2. Click "+" -> Apple ID -> sign in with the Apple ID that owns the signing certificate',
      '  3. Re-run this command.',
    ].join('\n');
  }
  if (/No profiles for|doesn't match the provisioning profile|requires a provisioning profile/i.test(log)) {
    return [
      `Xcode could not create a provisioning profile for ${BUNDLE_ID}.`,
      'On a free personal team the bundle id must be unused by anyone else. If Apple rejects it,',
      'build with a dev-only id instead: PRODUCT_BUNDLE_IDENTIFIER=com.kalvoe.survey.dev',
      '(pass it to xcodebuild only — never change the id in the project, it is the store id).',
    ].join('\n');
  }
  return null;
}

function deviceTrustHelp() {
  return [
    'The phone has not trusted this developer certificate yet.',
    'On the iPhone: Settings -> General -> VPN & Device Management -> tap the developer app',
    'entry -> Trust. Also confirm Settings -> Privacy & Security -> Developer Mode is ON',
    '(the phone reboots the first time you enable it). Then re-run this command.',
  ].join('\n');
}

async function main() {
  await mkdir(artifactRoot, { recursive: true });

  const device = await selectDevice();
  console.log(`Target: ${device.name} — ${device.model || device.platform}`);
  console.log(`Device: ${device.identifier} (${device.transport || 'unknown transport'})`);

  const devServerRequested = cliArgs.has('--dev-server')
    || rawCliArgs.some((argument) => argument.startsWith('--dev-server='))
    || Boolean(process.env.MOBILE_IOS_DEV_SERVER_URL?.trim());
  const devServerUrl = devServerRequested ? await resolveDevServerUrl() : null;

  if (devServerUrl) {
    await assertSurveyViteServer(devServerUrl);
    console.log(`Verified Survey Vite dev server ${devServerUrl}`);
  }

  if (!cliArgs.has('--skip-sync')) {
    if (devServerUrl) {
      // Keep the checked-in/native generated configuration production-safe.
      // The live URL is added only to the disposable source copy below.
      await run('npx', ['cap', 'sync', 'ios'], { env: { ...process.env, CAPACITOR_SERVER_URL: '' } });
    } else {
      await run('npm', ['run', 'mobile:sync'], { env: { ...process.env, CAPACITOR_SERVER_URL: '' } });
    }
  } else {
    console.log('\nSkipping web build and Capacitor sync by explicit request.');
  }

  const sourceCommit = (await run('git', ['rev-parse', 'HEAD'], { capture: true })).stdout;
  if (!devServerUrl) {
    const distRelease = JSON.parse(await readFile(path.join(ROOT, 'dist', 'release.json'), 'utf8'));
    if (distRelease.commit !== sourceCommit) {
      throw new Error(`Bundle commit ${distRelease.commit || 'unknown'} does not match source ${sourceCommit}. Run without --skip-sync.`);
    }
    console.log(`Verified web bundle commit ${sourceCommit.slice(0, 8)}.`);
  } else {
    console.log(`Using live worktree code at ${sourceCommit.slice(0, 8)}.`);
  }

  let buildProject = PROJECT;
  let temporaryIosRoot = null;
  let appPath;
  try {
    if (devServerUrl) {
      temporaryIosRoot = path.join(artifactRoot, 'DeviceSource');
      await rm(temporaryIosRoot, { recursive: true, force: true });
      await cp(path.join(ROOT, 'ios'), temporaryIosRoot, { recursive: true, preserveTimestamps: true });
      const temporaryConfigPath = path.join(temporaryIosRoot, 'App', 'App', 'capacitor.config.json');
      const temporaryConfig = JSON.parse(await readFile(temporaryConfigPath, 'utf8'));
      await writeFile(
        temporaryConfigPath,
        `${JSON.stringify(withSimulatorDevServer(temporaryConfig, devServerUrl), null, 2)}\n`,
      );
      buildProject = path.join(temporaryIosRoot, 'App', 'App.xcodeproj');
    }

    const teamOverride = process.env.MOBILE_IOS_TEAM_ID?.trim();
    try {
      await run('xcodebuild', [
        '-project', buildProject,
        '-scheme', SCHEME,
        '-configuration', 'Debug',
        '-destination', `id=${device.identifier}`,
        '-derivedDataPath', derivedData,
        '-allowProvisioningUpdates',
        '-allowProvisioningDeviceRegistration',
        ...(teamOverride ? [`DEVELOPMENT_TEAM=${teamOverride}`] : []),
        'build',
      ], { tee: true });
    } catch (error) {
      const help = signingHelp(`${error.result?.stdout || ''}\n${error.result?.stderr || ''}`);
      if (help) throw new Error(`Code signing is not set up.\n\n${help}`);
      throw error;
    }

    appPath = path.join(derivedData, 'Build', 'Products', 'Debug-iphoneos', 'App.app');
    await access(appPath);
    if (!devServerUrl) {
      const appRelease = JSON.parse(await readFile(path.join(appPath, 'public', 'release.json'), 'utf8'));
      if (appRelease.commit !== sourceCommit) {
        throw new Error(`Built iOS app commit ${appRelease.commit || 'unknown'} does not match source ${sourceCommit}.`);
      }
    }

    try {
      await run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device.identifier, appPath], { tee: true });
    } catch (error) {
      const log = `${error.result?.stdout || ''}\n${error.result?.stderr || ''}`;
      if (/verif|trust|0xe8008015|developer mode/i.test(log)) {
        throw new Error(`Install was rejected by the phone.\n\n${deviceTrustHelp()}`);
      }
      throw error;
    }
  } finally {
    if (temporaryIosRoot) await rm(temporaryIosRoot, { recursive: true, force: true });
  }

  let launch = null;
  if (!cliArgs.has('--no-launch')) {
    const launchJson = path.join(artifactRoot, 'launch.json');
    try {
      await run('xcrun', [
        'devicectl', 'device', 'process', 'launch',
        '--device', device.identifier,
        '--terminate-existing',
        '-j', launchJson,
        BUNDLE_ID,
      ], { tee: true });
      launch = JSON.parse(await readFile(launchJson, 'utf8'));
    } catch (error) {
      const log = `${error.result?.stdout || ''}\n${error.result?.stderr || ''}`;
      if (/verif|trust|untrusted|0xe8008015|developer mode/i.test(log)) {
        throw new Error(`The app installed but the phone refused to launch it.\n\n${deviceTrustHelp()}`);
      }
      throw error;
    }
  }

  const processIdentifier = launch?.result?.process?.processIdentifier ?? null;
  const metadataPath = path.join(artifactRoot, `survey-device-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.json`);
  await writeFile(metadataPath, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    device,
    bundleId: BUNDLE_ID,
    sourceCommit,
    mode: devServerUrl ? 'vite-dev-server' : 'embedded-bundle',
    devServerUrl,
    appPath,
    processIdentifier,
  }, null, 2)}\n`);

  console.log(`\nSurvey is installed on ${device.name}.`);
  if (processIdentifier) console.log(`Launched process id ${processIdentifier}.`);
  if (devServerUrl) console.log(`The app is loading ${devServerUrl} — keep the Vite server running.`);
  // There is no `devicectl device screenshot`, so a painted-frame check like the
  // simulator runner's is not possible; look at the phone to confirm the UI.
  console.log(`Metadata: ${metadataPath}`);
}

main().catch((error) => {
  console.error(`\nDevice run failed: ${error.message}`);
  process.exitCode = 1;
});
