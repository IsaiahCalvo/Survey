import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backLayerCount, closeTopBackLayer, nativeBackAction, pushBackLayer, resetBackNavigationForTests,
} from '../src/utils/backNavigation.js';

test('native back: history first, then minimise (flag on) or quit (flag off)', () => {
  assert.equal(nativeBackAction({ canGoBack: true, enabled: true }), 'back');
  assert.equal(nativeBackAction({ canGoBack: true, enabled: false }), 'back');
  assert.equal(nativeBackAction({ canGoBack: false, enabled: true }), 'minimize');
  assert.equal(nativeBackAction({ canGoBack: false, enabled: false }), 'exit');
});

test('back closes the newest layer first, and a removed layer is skipped', () => {
  resetBackNavigationForTests();
  const closed = [];
  pushBackLayer(() => closed.push('a'));
  const removeB = pushBackLayer(() => closed.push('b'));
  pushBackLayer(() => closed.push('c'));
  removeB();
  assert.equal(backLayerCount(), 2);
  assert.equal(closeTopBackLayer(null), true);
  assert.deepEqual(closed, ['c']);
  resetBackNavigationForTests();
  assert.equal(closeTopBackLayer(null), false);
});

// A window whose history.back() lands later, like a browser's.
function fakeWindow() {
  const entries = [{ state: null }];
  let index = 0;
  let pending = 0;
  const listeners = [];
  const win = {
    history: {
      get state() { return entries[index].state; },
      pushState(state) { entries.splice(index + 1); entries.push({ state }); index += 1; pending = index; },
      replaceState(state) { entries[index] = { state }; },
      // Backs queue like a browser's: each one steps from where the last one
      // will land, so two quick backs from one entry deep leave the site.
      back() {
        pending -= 1;
        const target = pending;
        setTimeout(() => {
          if (target < 0) { win.left = true; return; }
          index = target;
          let stopped = false;
          const event = { stopImmediatePropagation() { stopped = true; } };
          for (const l of [...listeners.filter((x) => x.capture), ...listeners.filter((x) => !x.capture)]) {
            if (stopped) break;
            l.fn(event);
          }
        }, 0);
      },
    },
    addEventListener(type, fn, capture) { if (type === 'popstate') listeners.push({ fn, capture: !!capture }); },
    removeEventListener(type, fn) { const i = listeners.findIndex((x) => x.fn === fn); if (i !== -1) listeners.splice(i, 1); },
    get depth() { return index; },
    left: false,
  };
  return win;
}
const settle = () => new Promise((r) => setTimeout(r, 5));

test('home: a dialog closing as a document opens backs once, not twice (R3-X bug 1)', async () => {
  resetBackNavigationForTests();
  const { installHomeBack, installViewerBack } = await import('../src/utils/backNavigation.js');
  const win = fakeWindow();
  const removeHome = installHomeBack(win);
  const removeDialog = pushBackLayer(() => {});
  assert.equal(win.depth, 1, 'the dialog owns an entry');
  removeDialog(); // Create: the dialog closes...
  removeHome(); // ...and the viewer opens in the same tick.
  const removeViewer = installViewerBack(win, () => {});
  await settle();
  assert.equal(win.left, false, 'still in Survey');
  assert.equal(win.depth, 1, 'the viewer owns its entry');
  removeViewer();
  await settle();
  resetBackNavigationForTests();
});

test('home: a sheet handing over to a dialog keeps a back entry (R3-X bug 5)', async () => {
  resetBackNavigationForTests();
  const { installHomeBack } = await import('../src/utils/backNavigation.js');
  const win = fakeWindow();
  const removeHome = installHomeBack(win);
  const removeSheet = pushBackLayer(() => {});
  assert.equal(win.depth, 1);
  removeSheet(); // New sheet closes...
  let closed = false;
  const removeDialog = pushBackLayer(() => { closed = true; removeDialog(); }); // ...Blank document form opens.
  await settle();
  assert.equal(win.depth, 1, 'the form got its own entry back');
  win.history.back(); // the user presses Back
  await settle();
  assert.equal(closed, true, 'Back closed the form');
  assert.equal(win.left, false, 'and stayed in Survey');
  removeHome();
  await settle();
  resetBackNavigationForTests();
});

test('home: Back while a busy dialog ignores it puts the entry back (R3-Z B2)', async () => {
  resetBackNavigationForTests();
  const { installHomeBack } = await import('../src/utils/backNavigation.js');
  const win = fakeWindow();
  win.setTimeout = (fn, ms) => setTimeout(fn, ms);
  const removeHome = installHomeBack(win);
  const removeDialog = pushBackLayer(() => {}); // busy: Back does not close it
  assert.equal(win.depth, 1);
  win.history.back();
  await new Promise((r) => setTimeout(r, 320));
  assert.equal(win.depth, 1, 'the still-open dialog owns an entry again');
  win.history.back(); // a second Back while still busy
  await new Promise((r) => setTimeout(r, 320));
  assert.equal(win.left, false, 'still in Survey');
  removeDialog();
  removeHome();
  await settle();
  resetBackNavigationForTests();
});

test('home: Back right after Create stays in Survey (R4-B B2)', async () => {
  resetBackNavigationForTests();
  const { installHomeBack, installViewerBack } = await import('../src/utils/backNavigation.js');
  const win = fakeWindow();
  const removeHome = installHomeBack(win);
  const removeDialog = pushBackLayer(() => {});
  removeDialog(); // Create: the dialog closes...
  removeHome(); // ...and the document opens in the same tick.
  let left = 0;
  const removeViewer = installViewerBack(win, () => { left += 1; });
  win.history.back(); // the user presses Back at once
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(win.left, false, 'still in Survey');
  assert.equal(left, 1, 'Back closed the document');
  removeViewer();
  await settle();
  resetBackNavigationForTests();
});

test('home: Back while the dialog closes and before the document shows stays in Survey', async () => {
  resetBackNavigationForTests();
  const { installHomeBack, installViewerBack } = await import('../src/utils/backNavigation.js');
  const win = fakeWindow();
  const removeHome = installHomeBack(win);
  const removeDialog = pushBackLayer(() => {});
  removeDialog(); // the dialog closes a render before the document shows
  win.history.back(); // Back in between
  await settle();
  removeHome();
  const removeViewer = installViewerBack(win, () => {});
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(win.left, false, 'still in Survey');
  assert.equal(win.depth, 1, 'the document owns its entry');
  removeViewer();
  await settle();
  resetBackNavigationForTests();
});

test('home: a closed sheet with no document opening takes its entry off', async () => {
  resetBackNavigationForTests();
  const { installHomeBack } = await import('../src/utils/backNavigation.js');
  const win = fakeWindow();
  const removeHome = installHomeBack(win);
  const removeSheet = pushBackLayer(() => {});
  assert.equal(win.depth, 1);
  removeSheet();
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(win.depth, 0, 'back on the first entry');
  removeHome();
  resetBackNavigationForTests();
});
