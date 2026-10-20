// KAL-369: the desktop file allowlist must follow links. Uses real folders and
// real symbolic links in a temp dir, so it checks what the disk does, not text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isClearableDirectory, isPathAllowed, isWithin, resolveRealPath } = require('../src/electron/fsPathGuard.cjs');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kal369-guard-'));
const root = path.join(base, 'root');          // a trusted root (like userData)
const outside = path.join(base, 'outside');    // NOT trusted (like the home folder)
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'plan.pdf'), 'pdf');
fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');

let symlinksWork = true;
try {
  fs.symlinkSync(outside, path.join(root, 'escape'), 'dir');            // root/escape -> outside
  fs.symlinkSync(path.join(root, 'docs'), path.join(root, 'alias'), 'dir'); // root/alias -> root/docs
  fs.symlinkSync(path.join(outside, 'gone.txt'), path.join(root, 'dangling.txt')); // target missing
  fs.symlinkSync(root, path.join(base, 'root-link'), 'dir');           // a root that is a link
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'picked-link.txt'));
} catch (_) {
  symlinksWork = false; // e.g. Windows without the symlink privilege
}
const linkTest = symlinksWork ? test : test.skip;

test.after(() => fs.rmSync(base, { recursive: true, force: true }));

const entries = [root];

test('plain files and new write targets inside a root are allowed (old behaviour kept)', () => {
  assert.equal(isPathAllowed(path.join(root, 'docs', 'plan.pdf'), { entries }), true);
  assert.equal(isPathAllowed(path.join(root, 'docs', 'new.pdf'), { entries }), true);
  assert.equal(isPathAllowed(path.join(root, 'a', 'b', 'c.json'), { entries }), true);
  assert.equal(isPathAllowed(root, { entries }), true);
});

test('paths whose text is outside every entry are refused (old behaviour kept)', () => {
  assert.equal(isPathAllowed(path.join(outside, 'secret.txt'), { entries }), false);
  assert.equal(isPathAllowed(path.join(root, '..', 'outside', 'secret.txt'), { entries }), false);
  assert.equal(isPathAllowed(`${root}-sibling/x`, { entries }), false);
});

test('bad input is refused', () => {
  for (const bad of [undefined, null, '', 42, {}, `${root}/x\0.txt`]) {
    assert.equal(isPathAllowed(bad, { entries }), false);
  }
  assert.equal(isPathAllowed(path.join(root, 'x'), { entries: [] }), false);
});

linkTest('a link inside a root that points outside cannot be read or written through', () => {
  // The text-only check passed both of these.
  assert.equal(isPathAllowed(path.join(root, 'escape', 'secret.txt'), { entries }), false);
  assert.equal(isPathAllowed(path.join(root, 'escape', 'new-file.txt'), { entries }), false);
  assert.equal(isPathAllowed(path.join(root, 'escape', 'deep', 'new.txt'), { entries }), false);
  assert.equal(isPathAllowed(path.join(root, 'escape'), { entries }), false);
});

linkTest('a link that stays inside the root still works', () => {
  assert.equal(isPathAllowed(path.join(root, 'alias', 'plan.pdf'), { entries }), true);
  assert.equal(isPathAllowed(path.join(root, 'alias', 'new.pdf'), { entries }), true);
});

linkTest('a dangling link is refused, since writing through it would create the target outside', () => {
  assert.equal(resolveRealPath(path.join(root, 'dangling.txt')), null);
  assert.equal(isPathAllowed(path.join(root, 'dangling.txt'), { entries }), false);
});

linkTest('a root that is itself a link (macOS /var -> /private/var) keeps working', () => {
  const linkedEntries = [path.join(base, 'root-link')];
  assert.equal(isPathAllowed(path.join(base, 'root-link', 'docs', 'plan.pdf'), { entries: linkedEntries }), true);
  assert.equal(isPathAllowed(path.join(base, 'root-link', 'docs', 'new.pdf'), { entries: linkedEntries }), true);
  assert.equal(isPathAllowed(path.join(base, 'root-link', 'escape', 'secret.txt'), { entries: linkedEntries }), false);
});

linkTest('a file the user picked in a dialog still opens when it is a link', () => {
  const picked = path.join(root, 'picked-link.txt');
  // Not picked: the link leads outside, so it is refused.
  assert.equal(isPathAllowed(picked, { entries }), false);
  // Picked through the dialog: that exact path is an entry, so it opens.
  assert.equal(isPathAllowed(picked, { entries: [...entries, picked] }), true);
  // Picking one file does not open its target's neighbours.
  assert.equal(isPathAllowed(path.join(root, 'escape', 'other.txt'), { entries: [...entries, picked] }), false);
});

test('a drive-root allowlist entry does not trust the whole volume', () => {
  // recordDialogPath stores path.dirname of a pick. Opening /file.pdf or
  // C:\file.pdf would persist `/` or `C:\`. Those must not unlock every path.
  assert.equal(isWithin('/etc/passwd', '/'), false);
  assert.equal(isWithin('/file.pdf', '/'), false);
  assert.equal(isWithin('/', '/'), true);
  assert.equal(isPathAllowed('/etc/passwd', { entries: ['/'] }), false);
  assert.equal(isPathAllowed(path.join(outside, 'secret.txt'), { entries: ['/'] }), false);
  assert.equal(isPathAllowed('/file.pdf', { entries: ['/file.pdf', '/'] }), true);
  assert.equal(isPathAllowed('/other.pdf', { entries: ['/file.pdf', '/'] }), false);

  const win32 = path.win32;
  assert.equal(isWithin('C:\\Windows\\secret.txt', 'C:\\', win32), false);
  assert.equal(isWithin('C:\\file.pdf', 'C:\\', win32), false);
  assert.equal(isWithin('C:\\', 'C:\\', win32), true);
  assert.equal(isWithin('C:\\Users\\me\\doc.pdf', 'C:\\Users\\me', win32), true);
});

test('only the exact diagnostics folder may be cleared', () => {
  const testLogs = path.join(root, 'TestLogs');
  const allowed = [testLogs];
  assert.equal(isClearableDirectory(testLogs, allowed), true);
  assert.equal(isClearableDirectory(`${testLogs}/`, allowed), true);
  assert.equal(isClearableDirectory(path.join(root, 'docs', '..', 'TestLogs'), allowed), true);
  // The whole root, a parent, a child, a look-alike and junk are all refused.
  assert.equal(isClearableDirectory(root, allowed), false);
  assert.equal(isClearableDirectory(base, allowed), false);
  assert.equal(isClearableDirectory(path.join(testLogs, 'sub'), allowed), false);
  assert.equal(isClearableDirectory(path.join(root, 'docs', 'TestLogs'), allowed), false);
  assert.equal(isClearableDirectory(`${testLogs}-old`, allowed), false);
  for (const bad of [undefined, null, '', 7, `${testLogs}\0`]) {
    assert.equal(isClearableDirectory(bad, allowed), false);
  }
  assert.equal(isClearableDirectory(testLogs, []), false);
});
