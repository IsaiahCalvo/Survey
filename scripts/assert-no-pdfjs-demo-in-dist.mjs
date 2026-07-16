#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'dist');
const forbiddenFileName = /FeatureSpike|CanvasAnnotationLayer|prototype/i;
const forbiddenContent = [
  'PDF.JS FEATURE PERFORMANCE LOG',
  'performance-mode-toggle',
  'PDF.js Feature Demo',
  '?spike=features',
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

const files = await walk(distDir);
const violations = [];

for (const file of files) {
  const relative = path.relative(distDir, file);
  if (forbiddenFileName.test(relative)) violations.push(`filename: ${relative}`);
  if (!/\.(?:css|html|js|json|mjs|txt)$/i.test(file)) continue;
  const contents = await readFile(file, 'utf8');
  for (const marker of forbiddenContent) {
    if (contents.includes(marker)) violations.push(`content: ${relative} (${marker})`);
  }
}

if (violations.length > 0) {
  throw new Error(`Temporary PDF.js demo leaked into the production build:\n${violations.join('\n')}`);
}

console.log('Production bundle check passed: temporary PDF.js demo is absent.');
