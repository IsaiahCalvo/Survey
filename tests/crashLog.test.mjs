// Crash reports kept on the device (src/utils/crashLog.js) and the phone
// app's quiet reload after its page is killed (mobile-expo/App.tsx).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CRASH_LIVE_KEY, CRASH_LOG_KEY, CRASH_LOG_MAX,
  collectDeadSessions, formatCrashReports, noteAction, readCrashReports, recentActions,
  recordCrash, recordShellNote, safeRoute, stackTop, clearCrashReports, onCrashRecorded,
  __resetCrashLogForTests,
} from '../src/utils/crashLog.js';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    map,
  };
};

test('a crash is kept with its message, stack top, actions and build; the list holds the last 20', () => {
  __resetCrashLogForTests();
  const storage = memoryStorage();
  noteAction('Undo'); noteAction('Undo'); noteAction('Zoom in');
  const error = new Error('Boom');
  const r = recordCrash({ kind: 'react', error, componentStack: '\n    at PagesPanel\n    at PDFViewer' }, { storage, now: Date.parse('2026-10-07T10:00:00Z') });
  assert.equal(r.kind, 'react');
  assert.equal(r.message, 'Boom');
  assert.match(r.stack, /Error: Boom/);
  assert.match(r.componentStack, /PagesPanel/);
  assert.deepEqual(r.actions.map((a) => a.replace(/^\S+ /, '')), ['Undo x2', 'Zoom in']);
  assert.equal(r.sentAt, null, 'ready for a later "send to us" step');
  for (let i = 0; i < 30; i += 1) recordCrash({ message: `e${i}` }, { storage, now: Date.parse('2026-10-07T11:00:00Z') + i * 60000 });
  const list = readCrashReports(storage);
  assert.equal(list.length, CRASH_LOG_MAX);
  assert.equal(list[list.length - 1].message, 'e29');
});

test('the same crash again within 30 s only bumps its count', () => {
  __resetCrashLogForTests();
  const storage = memoryStorage();
  const t = Date.parse('2026-10-07T10:00:00Z');
  recordCrash({ kind: 'error', message: 'x' }, { storage, now: t });
  recordCrash({ kind: 'error', message: 'x' }, { storage, now: t + 1000 });
  recordCrash({ kind: 'error', message: 'x' }, { storage, now: t + 60000 });
  const list = readCrashReports(storage);
  assert.equal(list.length, 2);
  assert.equal(list[0].count, 2);
});

test('a page that vanished while on screen is found at the next start; one hidden in the background is not', () => {
  __resetCrashLogForTests();
  const storage = memoryStorage();
  const now = Date.parse('2026-10-07T10:00:00Z');
  storage.setItem(CRASH_LIVE_KEY, JSON.stringify({
    dead: { beat: now - 60000, visible: true, route: '/mobile', actions: ['10:00:00 Pinch'], memory: { jsHeapMB: 900 }, build: 'v1' },
    background: { beat: now - 60000, visible: false, route: '/mobile', actions: [] },
    alive: { beat: now - 2000, visible: true },
  }));
  assert.equal(collectDeadSessions({ storage, now, selfId: 'me' }), 1);
  const [r] = readCrashReports(storage);
  assert.equal(r.kind, 'closed');
  assert.equal(r.memory.jsHeapMB, 900);
  assert.deepEqual(r.actions, ['10:00:00 Pinch']);
  const live = JSON.parse(storage.getItem(CRASH_LIVE_KEY));
  assert.deepEqual(Object.keys(live), ['alive'], 'another open tab is left alone');
});

test("the phone app's reload note joins the page's own record of the same death", () => {
  __resetCrashLogForTests();
  const storage = memoryStorage();
  const now = Date.parse('2026-10-07T10:00:00Z');
  storage.setItem(CRASH_LIVE_KEY, JSON.stringify({ dead: { beat: now - 30000, visible: true, route: '/mobile' } }));
  collectDeadSessions({ storage, now, selfId: 'me' });
  recordShellNote({ source: 'ios-content-process', at: '2026-10-07T09:59:40Z', url: 'https://x/mobile?token=secret', recoveriesInLastMinute: 0 }, { storage, now: now + 2000 });
  const list = readCrashReports(storage);
  assert.equal(list.length, 1);
  assert.equal(list[0].shell.source, 'ios-content-process');
  // Without a page record it stands alone, and never keeps query secrets.
  clearCrashReports(storage);
  recordShellNote({ source: 'ios-content-process', url: 'https://x/mobile?token=secret&mobileNav=tabs' }, { storage, now });
  const [solo] = readCrashReports(storage);
  assert.equal(solo.kind, 'shell-reload');
  assert.equal(solo.route, '/mobile?mobileNav=tabs');
});

test('routes keep no tokens; stacks keep only their top lines', () => {
  assert.equal(safeRoute({ href: 'https://surveytool.app/invite/abc?token=t&mobileNav=tabs#access_token=z' }), '/invite/abc?mobileNav=tabs');
  const top = stackTop('Error: a\n at f (https://x/a.js?v=123:1:2)\n at g\n at h\n at i\n at j\n at k\n at l');
  assert.equal(top.split('\n').length, 6);
  assert.doesNotMatch(top, /v=123/);
});

test('the Copy text names each crash, newest first', () => {
  __resetCrashLogForTests();
  const storage = memoryStorage();
  recordCrash({ kind: 'freeze', message: 'The page did not respond for 9.0 s.', memory: { jsHeapMB: 400, jsHeapLimitMB: 4096, canvases: 12, canvasMB: 80 } }, { storage, now: Date.parse('2026-10-07T10:00:00Z') });
  recordCrash({ kind: 'react', message: 'Maximum update depth exceeded' }, { storage, now: Date.parse('2026-10-07T10:05:00Z') });
  const text = formatCrashReports(readCrashReports(storage));
  assert.match(text, /^#1 2026-10-07T10:05:00.000Z Error screen\nWhat: Maximum update depth exceeded/);
  assert.match(text, /#2 .* Froze[\s\S]*Memory: JS heap 400\/4096 MB, canvases 12 \(80 MB\)/);
  assert.equal(formatCrashReports([]), 'No crash reports.');
});

test('listeners hear new records (the hook a later send step plugs into)', () => {
  __resetCrashLogForTests();
  const storage = memoryStorage();
  const heard = [];
  const off = onCrashRecorded((r) => heard.push(r?.message));
  recordCrash({ message: 'one' }, { storage });
  off();
  recordCrash({ message: 'two' }, { storage });
  assert.deepEqual(heard, ['one']);
  assert.ok(storage.map.has(CRASH_LOG_KEY));
  assert.equal(recentActions().length, 0);
});

test('the app installs the crash log first thing and the error screen records into it', () => {
  const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /installCrashLog\(\{/);
  const boundary = fs.readFileSync(new URL('../src/components/ErrorBoundary.jsx', import.meta.url), 'utf8');
  assert.match(boundary, /recordReactCrash\(error, errorInfo\?\.componentStack\)/);
  const settings = fs.readFileSync(new URL('../src/components/AccountSettings.jsx', import.meta.url), 'utf8');
  assert.match(settings, /Crash reports/);
  assert.match(settings, /<CrashReportsPanel \/>/);
});

test('the phone app reloads a killed page quietly to the same place and hands over a note', () => {
  const app = fs.readFileSync(new URL('../mobile-expo/App.tsx', import.meta.url), 'utf8');
  const recover = app.slice(app.indexOf('const recoverTerminatedProcess'), app.indexOf('<View style={[styles.root'));
  assert.match(recover, /withLaunchCacheBust\(\s*lastSurveyUrlRef\.current \|\| SURVEY_URL/);
  assert.match(recover, /pendingCrashNotesRef\.current = \[/);
  assert.match(app, /message\?\.type === 'survey:location'/);
  assert.match(app, /flushCrashNotes\(\);/);
  assert.match(app, /window\.dispatchEvent\(new CustomEvent\('survey-native-crash-note'\)\)/);
  assert.match(app, /Survey had to close/);
  assert.match(app, /if \(!loadError \|\| loadErrorKind === 'crash'\) return undefined;/);
});

test('browser ResizeObserver notices are not recorded as crashes', async () => {
  const { isBrowserNotice } = await import('../src/utils/crashLog.js');
  assert.equal(isBrowserNotice('ResizeObserver loop completed with undelivered notifications.'), true);
  assert.equal(isBrowserNotice('ResizeObserver loop limit exceeded'), true);
  assert.equal(isBrowserNotice('TypeError: x is undefined'), false);
  assert.equal(isBrowserNotice(undefined), false);
  const src = fs.readFileSync(new URL('../src/utils/crashLog.js', import.meta.url), 'utf8');
  assert.match(src, /if \(isBrowserNotice\(event\.message\)\) return;/);
});

test('freeze watch: a stuck page is a freeze, a page the device paused is not', async () => {
  const { classifyPageGap, FREEZE_MS } = await import('../src/utils/crashLog.js');
  const from = 100_000;
  const to = from + 9_400;
  const every = (start, end, step = 1000) => { const out = []; for (let t = start; t <= end; t += step) out.push(t); return out; };
  // The background timer kept ticking the whole time: the page's thread was stuck.
  assert.equal(classifyPageGap(every(from - 5000, to + 2000), from, to), 'frozen');
  // It stopped too (laptop asleep, iPhone app behind a native sheet).
  assert.equal(classifyPageGap([...every(from - 5000, from), ...every(to + 50, to + 2000)], from, to), 'paused');
  // A short hiccup in the background timer is still a freeze.
  const hiccup = every(from - 5000, to + 2000).filter((t) => t < from + 3500 || t > from + 4500);
  assert.equal(classifyPageGap(hiccup, from, to), 'frozen');
  // No background timer: counted as before.
  assert.equal(classifyPageGap([], from, to), 'unknown');
  assert.equal(FREEZE_MS, 8000);
});

test('freeze watch: a real freeze says which scripts ran long', async () => {
  const { describeLongFrames } = await import('../src/utils/crashLog.js');
  const origin = 1_000_000;
  const entries = [
    { startTime: 500, duration: 1200, scripts: [] },
    {
      startTime: 10_000,
      duration: 9_300,
      scripts: [
        { duration: 6_000, sourceURL: 'https://surveytool.app/assets/PDFViewer-abc.js?v=1', sourceFunctionName: 'decodeSnapshot', sourceCharPosition: 1234 },
        { duration: 2_500, sourceURL: 'https://surveytool.app/assets/vendor-pdfjs.js', sourceFunctionName: '', invoker: 'MessagePort.onmessage' },
      ],
    },
  ];
  const text = describeLongFrames(entries, origin + 10_000, origin + 19_300, origin);
  assert.match(text, /^long frame 9300 ms/);
  assert.match(text, /6000 ms decodeSnapshot \(PDFViewer-abc\.js@1234\)/);
  assert.match(text, /2500 ms MessagePort\.onmessage \(vendor-pdfjs\.js\)/);
  assert.match(text, /800 ms outside scripts/);
  assert.doesNotMatch(text, /surveytool\.app|\?v=1/, 'no address or query');
  assert.equal(describeLongFrames(entries, origin + 50_000, origin + 60_000, origin), '');
});
