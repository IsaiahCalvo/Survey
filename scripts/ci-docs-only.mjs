#!/usr/bin/env node
// Decides whether a pull request changes ONLY files that never affect the
// build: root-level *.md notes and graphify-out/**. Such a pull request still
// has to report "Build the app and gate the run" (main's ruleset requires it),
// but there is nothing to build or test, so ci.yml skips the shards and the
// build and lets the gate pass on its own.
//
// Two safety rules keep this from hiding a break:
//   * any file outside those two places means the full run, and
//   * a changed note that a test or script names (tests/tooltipRule reads the
//     root agent notes, for one) also means the full run, so an edit there is
//     still checked by the test that reads it.
// Anything unexpected (no file list, an API error, a list longer than GitHub
// returns) also means the full run.
//
//   gh api --paginate repos/OWNER/REPO/pulls/N/files \
//     --jq '.[] | .filename, (.previous_filename // empty)' \
//     | node scripts/ci-docs-only.mjs <changed_files count>
//
// Writes docs_only=true|false (and reason=...) to $GITHUB_OUTPUT when set.
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// GitHub's "list pull request files" endpoint stops at 3000 files.
export const MAX_LISTED_FILES = 3000;

const SOURCE = /\.(?:m?js|cjs|ts|tsx|jsx)$/;

export function isDocsPath(path) {
  return (!path.includes('/') && path.endsWith('.md')) || path.startsWith('graphify-out/');
}

/**
 * @param {string[]} paths every changed path (renames list both names)
 * @param {{ expectedCount?: number, sources?: { path: string, text: string }[] }} [opts]
 * @returns {{ docsOnly: boolean, reason: string }}
 */
export function decideDocsOnly(paths, { expectedCount, sources = [] } = {}) {
  const files = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
  if (files.length === 0) return { docsOnly: false, reason: 'no changed files were listed' };
  if (Number.isFinite(expectedCount) && expectedCount >= MAX_LISTED_FILES) {
    return { docsOnly: false, reason: `${expectedCount} files is more than GitHub lists` };
  }
  const other = files.find((p) => !isDocsPath(p));
  if (other) return { docsOnly: false, reason: `${other} can change the build` };
  for (const file of files) {
    // The name as a whole path, not the tail of a longer one
    // (supabase/migrations/README.md does not read the root README.md).
    const named = new RegExp(`(?:^|[^\\w./-])${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w/-])`);
    const reader = sources.find((s) => named.test(s.text));
    if (reader) return { docsOnly: false, reason: `${reader.path} reads ${file}` };
  }
  return { docsOnly: true, reason: 'only root notes or graphify-out changed' };
}

function collectSources(root, dirs) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'fixtures') continue;
      const full = join(dir, name);
      const info = statSync(full);
      if (info.isDirectory()) walk(full);
      else if (SOURCE.test(name)) out.push({ path: relative(root, full), text: readFileSync(full, 'utf8') });
    }
  };
  for (const dir of dirs) walk(join(root, dir));
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const expectedCount = Number(process.argv[2]);
  const paths = readFileSync(0, 'utf8').split('\n');
  const root = process.cwd();
  // This file is in scripts/ and talks about notes in general; leave it out so
  // it can never veto itself.
  const sources = collectSources(root, ['tests', 'scripts'])
    .filter((s) => s.path !== join('scripts', 'ci-docs-only.mjs'));
  const { docsOnly, reason } = decideDocsOnly(paths, { expectedCount, sources });
  console.log(`docs_only=${docsOnly} — ${reason}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${docsOnly}\nreason=${reason.replace(/\n/g, ' ')}\n`);
  }
}
