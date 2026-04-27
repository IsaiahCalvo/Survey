// tests/phase27/applyUpdateOnlyInvariant.test.mjs
// Phase 27 Wave 0 scaffold — runs as test.skip until production code lands in Plan 27-02.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md § Validation Architecture (Pattern 3).
//
// UX/architecture rationale: defends Pitfall 5 (1-second verify-wipe regression). The
// applyUpdate-only invariant says: NEW Y.Doc instances may only be constructed inside
// the registry module — every other consumer must call getOrCreateYDoc() and apply
// updates onto an existing doc. Asserts via `git grep` that `new Y.Doc(` only appears
// inside src/lib/collab/ydocRegistry.js.
//
// Skip condition: src/lib/collab/ydocRegistry.js has not been created yet (Plan 27-02
// owns that file). Once Plan 27-02 lands the registry, this test flips automatically
// from skip → green and locks the invariant for every subsequent commit.

import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const REGISTRY_FILE = resolve(REPO_ROOT, 'src/lib/collab/ydocRegistry.js');

const skipReason = !existsSync(REGISTRY_FILE)
  ? 'src/lib/collab/ydocRegistry.js not yet created (Plan 27-02)'
  : false;

test(
  'applyUpdate-only invariant — `new Y.Doc(` appears only inside ydocRegistry.js',
  { skip: skipReason },
  async () => {
    const { execSync } = await import('node:child_process');
    // `git grep` exits 1 when there are no matches — the trailing `|| true`
    // collapses that to exit 0 so execSync doesn't throw on a clean tree.
    const rg = execSync(
      `git grep -nE "new[[:space:]]+Y\\.Doc\\(" -- 'src/**/*.js' 'src/**/*.jsx' 'src/**/*.ts' 'src/**/*.tsx' || true`,
      { encoding: 'utf8', cwd: REPO_ROOT }
    ).trim();
    const matches = rg ? rg.split('\n') : [];
    const allowedFile = 'src/lib/collab/ydocRegistry.js';
    const violations = matches.filter((line) => !line.startsWith(`${allowedFile}:`));
    strictEqual(
      violations.length,
      0,
      `applyUpdate-only invariant violated. \`new Y.Doc(\` may only appear in ${allowedFile}. Found unauthorized usages:\n${violations.join('\n')}\nDefends against Pitfall 5 (1-second verify-wipe regression).`
    );
  }
);
