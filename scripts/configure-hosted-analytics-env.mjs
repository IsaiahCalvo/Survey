#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const keyFile = process.env.AGENT_NATIVE_PUBLIC_KEY_FILE;
if (!keyFile) {
  throw new Error('[ANALYTICS_ENV] Set AGENT_NATIVE_PUBLIC_KEY_FILE to the protected key file');
}
const publicKey = readFileSync(resolve(keyFile), 'utf8').trim();
if (!/^anpk_[A-Za-z0-9]+$/.test(publicKey)) {
  throw new Error('[ANALYTICS_ENV] Public key file does not contain an Agent Native public key');
}

function upsertEnvironmentFile(path, values, removeNames = []) {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const names = new Set([...Object.keys(values), ...removeNames]);
  const retained = existing
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
      return !match || !names.has(match[1]);
    })
    .filter((line, index, lines) => line || index < lines.length - 1);
  const body = [
    ...retained,
    ...Object.entries(values).map(([name, value]) => `${name}=${value}`),
    '',
  ].join('\n');
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

const root = process.cwd();
const webPath = resolve(root, '.env.local');
const expoPath = resolve(root, 'mobile-expo', '.env.local');
upsertEnvironmentFile(webPath, {
  AGENT_NATIVE_ANALYTICS_PUBLIC_KEY: publicKey,
}, [
  'VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY',
  'VITE_AGENT_NATIVE_ANALYTICS_URL',
]);
upsertEnvironmentFile(expoPath, {}, [
  'EXPO_PUBLIC_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY',
  'EXPO_PUBLIC_AGENT_NATIVE_ANALYTICS_URL',
]);
console.log(`[ANALYTICS_ENV] Server-side hosted collector proxy configured in ${webPath}; native public key removed from ${expoPath}`);
