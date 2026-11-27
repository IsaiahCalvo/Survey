import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTabSessionController,
  serializeTabSession,
  writeTabSession,
} from '../src/tabs/tabStrip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

test('leaving phone device mode after booting on Projects list does not reopen an old drawing (#1738)', () => {
  const storage = memoryStorage();
  const home = { id: 'home', isHome: true };
  const docTab = { id: 't1', file: { id: 'doc-1', name: 'B02.pdf', isSupabaseDocument: true } };
  writeTabSession(storage, 'user-1', serializeTabSession([home, docTab], 't1'));

  const controller = createTabSessionController(() => storage);
  const restores = [];
  const onRestore = (plan) => restores.push(plan);
  const docs = [{ id: 'doc-1', name: 'B02.pdf' }];

  // Phone shell boots on Home with enabled=false once library finishes loading
  controller.restore({
    enabled: false,
    userId: 'user-1',
    documents: docs,
    documentsUserId: 'user-1',
    tabs: [home],
    onRestore,
  });

  // User turns off phone device mode -> enabled flips to true on Projects list
  const res = controller.restore({
    enabled: true,
    userId: 'user-1',
    documents: docs,
    documentsUserId: 'user-1',
    tabs: [home],
    onRestore,
  });

  assert.equal(res, null);
  assert.equal(restores.length, 0);
});

test('ValueSelect dropdown clamps max-height and scrolls on desktop and phone (#1721)', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'src/components/ValueSelect.css'), 'utf8');
  assert.match(css, /\.annotation-dropdown__popover\.value-select__menu\s*\{[\s\S]*max-height:[\s\S]*overflow-y:\s*auto/);
});

test('Phone project screen exposes From Walkthru, From a job file, From OneDrive, and Send back to Plot (#1720)', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'src/home/ProjectsFolderTree.jsx'), 'utf8');
  assert.match(src, /data-mobile-project-handoff=""/);
  const block = src.slice(src.indexOf('data-mobile-project-handoff=""'), src.indexOf('projects-mobile-file-list'));
  assert.match(block, /From Walkthru/);
  assert.match(block, /From a job file/);
  assert.match(block, /From OneDrive/);
  assert.match(block, /Send back to Plot/);
});
