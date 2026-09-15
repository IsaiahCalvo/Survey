#!/usr/bin/env node

/**
 * Publish the Expo native shell to Isaiah's iPhone (Expo Go preview).
 *
 *   npm run mobile:phone
 *   npm run mobile:phone -- "What changed in the shell"
 *
 * WHAT THIS DOES AND DOES NOT DO
 * ------------------------------
 * `mobile-expo` is a thin native WebView shell. It does NOT embed the Vite
 * bundle: it loads the hosted Survey UI from `https://surveytool.app/mobile`
 * (see DEFAULT_SURVEY_URL in mobile-expo/App.tsx). So:
 *
 *   - The Survey *web app* on the phone is whatever Vercel currently serves.
 *     Deploying main to surveytool.app is what ships web changes; the phone
 *     picks them up on the next cold launch, with no Expo step at all.
 *   - This command ships the *native shell* (App.tsx, its helpers, config,
 *     assets) over-the-air to the permanent `expo-go` branch, which is the
 *     link the iPhone's Expo Go app opens.
 *
 * Both halves are stamped into the update message as
 * `shell:<sha256> release:<commit>`, which is exactly what the fail-closed
 * release gate (`npm run release:mobile:readiness`) reads back from Expo's
 * read-only `update:list` metadata. Keep that format.
 *
 * Requires: a clean worktree (the shell hash must describe reviewed, committed
 * source) and a cached Expo login for `isaiahcalvo` (`npx eas-cli whoami`).
 *
 * Full context, including the dev-client and TestFlight paths: docs/MOBILE-RUN.md
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPO_DIR = path.join(ROOT, 'mobile-expo');

// The permanent Expo Go entry point. The QR/deep link on the phone never
// changes; only the update at the top of this branch does.
const BRANCH = 'expo-go';
const PROJECT_ID = '7522d24f-7afd-4d5b-a5c0-58f2ea863c28';
const BRANCH_ID = '019fd954-cd01-705b-a108-2e1ac9f755d7';
const PHONE_LINK = `exp://u.expo.dev/${PROJECT_ID}/branch/${BRANCH_ID}`;

// The shell is published against the hosted UI on purpose. Overriding this to a
// Tailscale/LAN origin is a *local dev* workflow (mobile-expo's start:remote),
// never something that should be baked into the permanent preview.
const SURVEY_URL = 'https://surveytool.app/mobile';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function capture(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`\`${command} ${args.join(' ')}\` failed:\n${detail}`);
  }
  return (result.stdout || '').trim();
}

function main() {
  const note = process.argv.slice(2).join(' ').trim()
    || 'Publish current main shell for the iPhone Expo Go preview';

  // The hash covers the Expo entry point, config, dependencies, assets, and
  // native-shell helpers, and refuses to run on a dirty tree. Reuse the release
  // gate's own implementation so the two can never drift apart.
  let shellHash;
  try {
    shellHash = capture('node', ['scripts/verify-mobile-rollout-readiness.mjs', '--print-expo-hash']);
  } catch (error) {
    throw new Error(
      `Could not compute the shell hash. The worktree must be clean and committed.\n${error.message}`,
    );
  }

  const commit = capture('git', ['rev-parse', 'HEAD']);
  const message = `shell:${shellHash} release:${commit} ${note}`;

  console.log(`Publishing the Survey native shell to the "${BRANCH}" branch.`);
  console.log(`  shell   ${shellHash}`);
  console.log(`  release ${commit}`);
  console.log(`  web UI  ${SURVEY_URL} (served by Vercel, not bundled here)\n`);

  const publish = run('npx', [
    '--yes', 'eas-cli@latest', 'update',
    '--branch', BRANCH,
    '--platform', 'ios',
    '--message', message,
  ], {
    cwd: EXPO_DIR,
    // eas-cli rejects --non-interactive on `update`; CI=1 is the supported way.
    env: { ...process.env, CI: '1', EXPO_PUBLIC_SURVEY_URL: SURVEY_URL },
    stdio: 'inherit',
  });

  if (publish.status !== 0) {
    throw new Error(
      'eas update failed. If it asked you to log in, run `npx eas-cli login` as isaiahcalvo '
      + 'and try again — never paste credentials into an agent session.',
    );
  }

  console.log('\nOn the iPhone: open Expo Go, then Survey. Force-quit and reopen it if it');
  console.log('was already running — Expo Go fetches the new shell on a cold launch.');
  console.log(`Permanent link (unchanged): ${PHONE_LINK}`);
  console.log(`Safari fallback:            ${SURVEY_URL}`);
}

try {
  main();
} catch (error) {
  console.error(`\nPHONE UPDATE FAILED: ${error.message}`);
  process.exitCode = 1;
}
