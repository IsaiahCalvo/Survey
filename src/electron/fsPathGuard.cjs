// src/electron/fsPathGuard.cjs
//
// Link-aware check behind assertAllowedPath() in src/electron-main.js
// (KAL-369, closing the review blocker on the KAL-259 allowlist).
//
// The KAL-259 allowlist compares the renderer's path TEXT against the trusted
// roots (app folder, userData, tmp, OneDrive / CloudStorage) and the files the
// user picked in a dialog. A symbolic link (or Windows junction) that already
// sits inside one of those roots defeats a text-only check: `<tmp>/x/secret`
// passes the prefix test while `<tmp>/x` actually points at the home folder.
//
// Rule here: a path is allowed only when BOTH hold
//   1. its text, after path.resolve(), is inside an allowed entry (the old
//      rule, unchanged), and
//   2. the place it really lands on disk is inside the REAL location of some
//      allowed entry.
// "Really lands" = fs.realpathSync() of the path, or, for a file that does
// not exist yet (a write target), the real path of its nearest existing
// parent with the missing tail appended. A dangling link (the link exists but
// its target does not) is refused: writing through it would create the
// target wherever the link points. Any other error while resolving (EACCES,
// ELOOP, ...) also refuses. Entries are resolved the same way, so a root that
// is itself a link (macOS /var -> /private/var for os.tmpdir(), a OneDrive
// folder linked into CloudStorage) keeps working, and a dialog-picked file
// that is a link still opens: its real target is an allowed entry too.
//
// Pure apart from the injected fs (default: node:fs), so it is unit tested
// with real links in tests/electronFsPathGuard.test.mjs.

const nodePath = require('path');
const nodeFs = require('fs');

function isWithin(candidate, root, pathApi = nodePath) {
  if (candidate === root) return true;
  const prefix = root.endsWith(pathApi.sep) ? root : root + pathApi.sep;
  return candidate.startsWith(prefix);
}

function resolveRealPath(target, { fsApi = nodeFs, pathApi = nodePath } = {}) {
  let current = pathApi.resolve(target);
  const missingTail = [];
  for (;;) {
    try {
      const real = fsApi.realpathSync(current);
      return missingTail.length > 0 ? pathApi.join(real, ...missingTail.slice().reverse()) : real;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') return null;
      // ENOENT on something that lstat can see is a dangling link: refuse.
      try {
        fsApi.lstatSync(current);
        return null;
      } catch (_) { /* really missing: walk up */ }
      const parent = pathApi.dirname(current);
      if (parent === current) return null;
      missingTail.push(pathApi.basename(current));
      current = parent;
    }
  }
}

function isPathAllowed(candidate, { entries = [], fsApi = nodeFs, pathApi = nodePath } = {}) {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.includes('\0')) return false;
  const lexical = pathApi.resolve(candidate);
  const allowed = entries
    .filter((entry) => typeof entry === 'string' && entry.length > 0 && !entry.includes('\0'))
    .map((entry) => pathApi.resolve(entry));
  if (!allowed.some((entry) => isWithin(lexical, entry, pathApi))) return false;

  const real = resolveRealPath(lexical, { fsApi, pathApi });
  if (!real) return false;
  return allowed.some((entry) => {
    const realEntry = resolveRealPath(entry, { fsApi, pathApi });
    return Boolean(realEntry) && isWithin(real, realEntry, pathApi);
  });
}

// fs:clearDir deletes a folder recursively, so being "inside an allowed root"
// is far too wide: the root itself (all of OneDrive, userData, tmp) or a
// dialog-picked folder would qualify. Only folders named here, compared
// exactly after path.resolve(), may be cleared.
function isClearableDirectory(candidate, clearableDirectories = [], { pathApi = nodePath } = {}) {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.includes('\0')) return false;
  const resolved = pathApi.resolve(candidate);
  return clearableDirectories.some((dir) => (
    typeof dir === 'string' && dir.length > 0 && pathApi.resolve(dir) === resolved
  ));
}

module.exports = { isClearableDirectory, isPathAllowed, isWithin, resolveRealPath };
