// agent-cli/selftest-load-watchdog.mjs — deterministic state-machine proof of
// the sleep/wake load-watchdog fix (PDFViewer.jsx).
//
// It models the exact gate + effect contract the real viewer uses:
//   - gate "Loading..." is shown while (isLoadingPDF === true)
//   - loadPDF: on (re)run, sets isLoadingPDF=true, then awaits a download.
//     A "dead socket" download neither resolves nor rejects (hang forever).
//   - watchdog: while isLoadingPDF, arm a HANG_TIMEOUT_MS timer. On fire,
//     auto-retry up to MAX_AUTO_RETRIES (bump loadRetryToken → loadPDF re-runs),
//     else flip isLoadingPDF=false + show the retryable error screen.
//
// We run two worlds — WITHOUT the watchdog (legacy) and WITH it — over the same
// dead-socket wake, and assert the legacy world hangs forever while the fixed
// world recovers (network heals on a retry, PDF renders).

let virtualNow = 0;
const timers = [];
const setT = (fn, ms) => { const id = { at: virtualNow + ms, fn, dead: false }; timers.push(id); return id; };
const clearT = (id) => { if (id) id.dead = true; };
const advance = (ms) => {
  const target = virtualNow + ms;
  // Fire due timers in order, allowing new ones to be scheduled.
  for (;;) {
    const due = timers.filter((t) => !t.dead && t.at <= target).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    virtualNow = due.at;
    due.dead = true;
    due.fn();
  }
  virtualNow = target;
};

function makeViewer({ withWatchdog }) {
  const HANG_TIMEOUT_MS = 20000;
  const MAX_AUTO_RETRIES = 2;
  const DOWNLOAD_OK_MS = 800; // a live download

  const state = {
    isLoadingPDF: true,
    pdfDoc: null,
    pdfLoadError: null,
    loadRetryToken: 0,
    watchdogRetryCount: 0,
  };
  // dead-socket switch: when true, loadPDF's download hangs forever.
  let networkDead = false;
  let activeDownload = null; // the pending (possibly hung) download timer
  let watchdogTimer = null;

  const gateShowsLoading = () => state.isLoadingPDF === true && !state.pdfLoadError;
  const gateShowsError = () => !!state.pdfLoadError;
  const gateShowsPdf = () => !state.isLoadingPDF && !!state.pdfDoc && !state.pdfLoadError;

  const armWatchdog = () => {
    if (!withWatchdog) return;
    clearT(watchdogTimer);
    if (!state.isLoadingPDF) return;
    watchdogTimer = setT(() => {
      if (state.watchdogRetryCount < MAX_AUTO_RETRIES) {
        state.watchdogRetryCount += 1;
        // bump loadRetryToken → loadPDF re-runs
        state.loadRetryToken += 1;
        loadPDF();
      } else {
        state.isLoadingPDF = false;
        state.pdfLoadError = { kind: 'parse', message: 'took too long' };
      }
    }, HANG_TIMEOUT_MS);
  };

  function loadPDF() {
    // cancel any prior in-flight download (effect cleanup / re-run)
    clearT(activeDownload);
    state.isLoadingPDF = true;
    state.pdfLoadError = null;
    armWatchdog();
    if (networkDead) {
      // hung socket: schedule a download that never fires.
      activeDownload = setT(() => { /* unreachable while networkDead */ }, Number.MAX_SAFE_INTEGER);
      return;
    }
    activeDownload = setT(() => {
      state.pdfDoc = { numPages: 36 };
      state.isLoadingPDF = false;
      armWatchdog(); // re-arm (no-op: isLoadingPDF false)
    }, DOWNLOAD_OK_MS);
  }

  return {
    state, gateShowsLoading, gateShowsError, gateShowsPdf,
    boot() { loadPDF(); },
    sleep() { networkDead = true; },
    wake() { networkDead = false; },
    // production wake re-resolves pdfFile → loadPDF re-runs.
    wakeRemount() { loadPDF(); },
    clickTryAgain() { state.pdfLoadError = null; state.isLoadingPDF = true; state.loadRetryToken += 1; loadPDF(); },
  };
}

function run(label, { withWatchdog }) {
  virtualNow = 0; timers.length = 0;
  const v = makeViewer({ withWatchdog });
  v.boot();
  advance(2000);
  const renderedOk = v.gateShowsPdf();

  // SLEEP: socket dies. WAKE: viewer re-resolves pdfFile (loadPDF re-runs) on a
  // STILL-dead socket (stale pre-sleep connection), then the real network comes
  // back a few seconds later.
  v.sleep();
  v.wakeRemount(); // loadPDF re-runs; download hangs on the dead socket
  advance(5000);
  const stuckRightAfterWake = v.gateShowsLoading() && !v.gateShowsPdf();

  // The genuine network is back ~6s after wake (fresh sockets would work),
  // but the in-flight hung download never knows that.
  v.wake();

  // Let the system run for a while (well past the watchdog window).
  advance(60000);
  // If an error screen is surfaced, a user/recovery clicks Try again once.
  if (v.gateShowsError()) { v.clickTryAgain(); advance(2000); }

  const recovered = v.gateShowsPdf();
  const stuckForever = v.gateShowsLoading() && !v.gateShowsPdf();
  console.log(`[${label}] firstRender=${renderedOk} stuckAfterWake=${stuckRightAfterWake} recovered=${recovered} stuckForever=${stuckForever} retries=${v.state.watchdogRetryCount}`);
  return { renderedOk, stuckRightAfterWake, recovered, stuckForever };
}

console.log('=== load-watchdog state-machine self-test ===');
const legacy = run('LEGACY (no watchdog)', { withWatchdog: false });
const fixed = run('FIXED  (watchdog)   ', { withWatchdog: true });

const pass =
  legacy.renderedOk && legacy.stuckRightAfterWake && legacy.stuckForever && !legacy.recovered &&
  fixed.renderedOk && fixed.stuckRightAfterWake && fixed.recovered && !fixed.stuckForever;

console.log('\nLEGACY reproduces the permanent-Loading bug:', legacy.stuckForever);
console.log('FIXED recovers to a rendered PDF after wake :', fixed.recovered);
console.log('\nSELFTEST:', pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
