#!/usr/bin/env node
// scripts/check-licenses.mjs
// Phase 27 — License gate enforcer.
//
// Failure mode: HARD BLOCK (exit code 1) on any production dependency whose
// license is NOT in the allowlist AND is NOT covered by an explicit waiver.
//
// Local usage: `node scripts/check-licenses.mjs` (uses npx if license-checker
// is not yet installed).
// CI usage: invoked by .github/workflows/license-gate.yml after `npm ci`.
//
// Why a hard block: Pitfall 22 (AGPL contagion). A single AGPL-licensed prod
// dependency in a Stripe-billed app forces source-disclosure on every customer
// touchpoint that loads the bundle. Catching this at PR review (before the dep
// ever reaches main) is cheaper than ripping it out later.
//
// IMPORTANT: this script intentionally does NOT pass `--onlyAllow` to
// license-checker. license-checker's --onlyAllow uses an exact-string match
// against `meta.licenses`, which mishandles compound strings ("(MIT AND Zlib)")
// and the license-checker MIT* notation ("verified license content not
// detected") used for legitimately-MIT packages whose package.json predates
// the SPDX identifier convention. We do our own parse to handle those edge
// cases correctly.

import { spawnSync } from 'node:child_process';

// Permissive licenses — known safe, no AGPL/GPL/SSPL contagion risk.
// BlueOak-1.0.0 added Phase 27: modern permissive (MIT-equivalent intent,
// drop-in replacement for ISC across npm-org packages 2024+). Used by chownr,
// glob@13+, lru-cache@11+, minimatch@10+, minipass@7+, path-scurry@2+,
// rimraf@6+, sax@1.6+, tar@7+, yallist@5+, package-json-from-dist.
// MIT-0 is an attribution-free MIT-family permissive license used by modern
// CSS tooling packages.
const ALLOWED_LICENSES = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'CC0-1.0',
  '0BSD',
  'Unlicense',
  'BlueOak-1.0.0',
  'Python-2.0',  // permissive, GPL-compatible — used only by transitive `argparse`
  'Zlib',        // permissive — appears compound with MIT in `pako` (`(MIT AND Zlib)`)
  // SIL's font license permits bundling, use, and redistribution. It applies
  // only to EmbedPDF's fallback font files, not to Survey source code.
  'OFL-1.1',
]);

const PACKAGE_NAME_WAIVERS = [];

// Per-package waivers — explicit `package@version` allowlist for transitive
// deps whose license string is permissive but doesn't fit the SPDX-style
// allowlist machinery. Each entry MUST document why it's safe.
const PACKAGE_VERSION_WAIVERS = new Set([
  // `argparse` ships under Python-2.0 (permissive, GPL-compatible). The
  // ALLOWED_LICENSES entry above handles modern releases, but legacy versions
  // sometimes report differently — keep this here as a safety net.
  'argparse@2.0.1',
  // `chainsaw` / `traverse` declare 'MIT*' in package.json. license-checker's
  // asterisk notation means "license file content not auto-verified" — both
  // packages are confirmed MIT via upstream README/LICENSE inspection
  // (substack-era npm packages from ~2011, predates SPDX identifier
  // convention).
  'chainsaw@0.1.0',
  'traverse@0.3.9',
  // `pako` reports `(MIT AND Zlib)`. Both halves are in ALLOWED_LICENSES; this
  // explicit waiver is belt-and-suspenders.
  'pako@1.0.11',
  // `sax@1.6.0` is BlueOak-1.0.0 (already in ALLOWED_LICENSES). Listed here
  // because the user's Phase 27 review explicitly named it.
  'sax@1.6.0',
  // `buffers@0.1.1` declares `Custom: http://github.com/substack/node-bufferlist`.
  // Verified MIT via upstream LICENSE file (2011 substack utility, transitive
  // dep of unzip-stream → exceljs → xlsx codepath).
  'buffers@0.1.1',
]);

function isLicenseAllowed(licenseString) {
  if (!licenseString || licenseString === 'UNKNOWN') return false;
  // license-checker may return a string OR an array. Normalize to array.
  const list = Array.isArray(licenseString) ? licenseString : [licenseString];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    if (ALLOWED_LICENSES.has(raw)) return true;
    // Strip MIT* asterisk (license-checker's "unverified" notation). The
    // explicit per-package waivers above cover legitimate cases.
    if (raw === 'MIT*') continue;
    const stripped = raw.replace(/[()]/g, '').trim();
    // Dual-license "X OR Y" — the consumer picks one. ANY permissive side is
    // enough (e.g. jszip ships `(MIT OR GPL-3.0-or-later)`; we pick MIT and
    // GPL contagion never reaches the bundle).
    if (/\sOR\s/.test(stripped)) {
      const orParts = stripped.split(/\s+OR\s+/).map((s) => s.trim());
      if (orParts.some((p) => ALLOWED_LICENSES.has(p))) return true;
      continue;
    }
    // Compound "X AND Y" — both halves apply simultaneously, so BOTH must be
    // permissive (e.g. pako ships `(MIT AND Zlib)`).
    if (/\sAND\s/.test(stripped)) {
      const andParts = stripped.split(/\s+AND\s+/).map((s) => s.trim());
      if (andParts.length > 1 && andParts.every((p) => ALLOWED_LICENSES.has(p))) return true;
      continue;
    }
  }
  return false;
}

function isPackageWaived(packageWithVersion) {
  if (PACKAGE_VERSION_WAIVERS.has(packageWithVersion)) return true;
  // Strip @version to test name-pattern waivers.
  // Package keys look like: '@scope/package@1.2.3' or 'react@18.2.0'.
  const lastAt = packageWithVersion.lastIndexOf('@');
  const name = lastAt > 0 ? packageWithVersion.slice(0, lastAt) : packageWithVersion;
  return PACKAGE_NAME_WAIVERS.some((pattern) => pattern.test(name));
}

// Run license-checker as JSON (no --onlyAllow — we do our own filtering).
const result = spawnSync(
  'npx',
  ['--yes', 'license-checker@^25.0.1', '--production', '--excludePrivatePackages', '--json'],
  { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error('\nLicense gate failed: license-checker did not exit cleanly.');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch (err) {
  console.error('\nLicense gate failed: could not parse license-checker JSON output.');
  console.error(err.message);
  process.exit(1);
}

const violations = [];
for (const [pkgKey, meta] of Object.entries(report)) {
  if (isPackageWaived(pkgKey)) continue;
  if (isLicenseAllowed(meta.licenses)) continue;
  violations.push({ pkg: pkgKey, license: meta.licenses });
}

if (violations.length > 0) {
  console.error('\nLicense gate FAILED. The following production packages have licenses outside the allowlist and are not covered by a documented waiver:\n');
  for (const v of violations) {
    console.error(`  ${v.pkg}  →  ${v.license}`);
  }
  console.error(`\nAllowed licenses (SPDX): ${[...ALLOWED_LICENSES].join(', ')}`);
  console.error('Waivers: scoped package-name waivers plus explicit per-package overrides — see scripts/check-licenses.mjs.');
  console.error('Defends Pitfall 22 (AGPL contagion — commercially fatal in a Stripe-billed app).');
  console.error('To request a new waiver, add `@2tag-license-waiver: <reason>` to your PR body and update PACKAGE_VERSION_WAIVERS in scripts/check-licenses.mjs.');
  process.exit(1);
}

console.log('License gate PASSED — all production dependencies are allowlisted or waived.');
