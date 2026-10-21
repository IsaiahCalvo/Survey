#!/usr/bin/env node
// Fails the build if a server-only secret ended up in dist/ (see
// scripts/lib/findLeakedSecrets.mjs for what counts).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLeakedSecrets } from './lib/findLeakedSecrets.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.resolve(repoRoot, process.argv[2] || 'dist');
const TEXT_FILE = /\.(?:js|mjs|cjs|css|html|json|map|txt|md|svg|webmanifest)$/i;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (TEXT_FILE.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const leaks = [];
for (const file of await walk(distDir)) {
  for (const leak of findLeakedSecrets(await readFile(file, 'utf8'))) {
    leaks.push(`${path.relative(repoRoot, file)}: ${leak.kind} (${leak.sample})`);
  }
}

if (leaks.length) {
  console.error('Secrets found in the built client bundle. Move them to an edge function secret:');
  for (const leak of leaks) console.error(`  ${leak}`);
  process.exit(1);
}
console.log('Bundle secret scan passed: only public keys in dist.');
