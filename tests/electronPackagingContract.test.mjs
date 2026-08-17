import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const packagedFiles = packageJson.build?.files || [];

const isIncludedInPackage = (relativePath) => packagedFiles.some((entry) => {
  const normalized = String(entry).replaceAll('\\', '/');
  if (normalized.endsWith('/**/*')) return relativePath.startsWith(normalized.slice(0, -4));
  return normalized === relativePath;
});

const resolveLocalModule = (importer, specifier) => {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(base)
    ? [base]
    : [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, path.join(base, 'index.js')];
  return candidates.find((candidate) => existsSync(candidate)) || null;
};

const collectLocalRuntimeModules = (entrypoints) => {
  const pending = [...entrypoints];
  const visited = new Set();
  const missing = [];
  const localSpecifierPattern = /(?:require\s*\(\s*|from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g;

  while (pending.length > 0) {
    const importer = pending.pop();
    if (visited.has(importer)) continue;
    visited.add(importer);
    const source = readFileSync(importer, 'utf8');
    for (const match of source.matchAll(localSpecifierPattern)) {
      const resolved = resolveLocalModule(importer, match[1]);
      if (!resolved) {
        missing.push(`${path.relative(repoRoot, importer)} -> ${match[1]}`);
      } else {
        pending.push(resolved);
      }
    }
  }

  assert.deepEqual(missing, [], `unresolved Electron runtime modules: ${missing.join(', ')}`);
  return [...visited].map((file) => path.relative(repoRoot, file).replaceAll('\\', '/')).sort();
};

test('electron-builder packages every local runtime module reachable from main and preload', () => {
  const runtimeModules = collectLocalRuntimeModules([
    path.join(repoRoot, packageJson.build.extraMetadata.main),
    path.join(repoRoot, 'src', 'preload.js'),
  ]);

  const omitted = runtimeModules.filter((file) => !isIncludedInPackage(file));
  assert.deepEqual(omitted, [], `electron-builder omits required runtime modules: ${omitted.join(', ')}`);
});
