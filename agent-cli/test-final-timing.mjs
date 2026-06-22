// Final test: exact timeline of when things happen
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

let cdpLogs = [];
page.on('console', (msg) => {
  cdpLogs.push({
    type: msg.type(),
    text: msg.text(),
    at: Date.now(),
  });
});

const tStart = Date.now();

// BEFORE navigation: install hook
await page.addInitScript(() => {
  window.__hookInstalled = performance.now();
  
  const origLog = console.log;
  const origDebug = console.debug;
  let logCount = 0;
  
  console.log = (...args) => {
    logCount++;
    window.__firstLog = window.__firstLog || performance.now();
    origLog('[LOG INTERCEPTED #' + logCount + ']', ...args);
  };
  
  console.debug = (...args) => {
    window.__firstDebug = window.__firstDebug || performance.now();
    origDebug('[DEBUG INTERCEPTED]', ...args);
  };
});

console.log(`[PLAYWRIGHT T+${Date.now() - tStart}ms] Before goto, installed hook`);

// Navigate
const tNav = Date.now();
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
const tDcl = Date.now();

console.log(`[PLAYWRIGHT T+${tDcl - tStart}ms] Navigation took ${tDcl - tNav}ms`);

// Check timing
let timing = await page.evaluate(() => {
  return {
    hookInstalled: window.__hookInstalled,
    firstLog: window.__firstLog,
    firstDebug: window.__firstDebug,
    bufferLength: window.__consoleLogBuffer?.length || 0,
  };
});

console.log('\n=== TIMELINE ===');
console.log(`addInitScript ran at: ${timing.hookInstalled?.toFixed(2)}ms (relative to page start)`);
console.log(`First console.log() called at: ${timing.firstLog?.toFixed(2)}ms`);
console.log(`First console.debug() called at: ${timing.firstDebug?.toFixed(2)}ms`);
console.log(`__consoleLogBuffer length: ${timing.bufferLength}`);

console.log('\n=== CDP MESSAGES ===');
cdpLogs.forEach((log, i) => {
  const relTime = log.at - tNav;
  console.log(`  [${i}] T+${relTime}ms ${log.type}: ${log.text.slice(0, 70)}`);
});

console.log('\n=== KEY INSIGHT ===');
if (timing.firstDebug && timing.firstDebug < 100) {
  console.log('Vite logs happen VERY EARLY (< 100ms)');
  console.log('addInitScript hook CAN catch them if it runs first');
  console.log('But main.jsx IIFE console override is not catching them');
  console.log('This means main.jsx IIFE runs AFTER the Vite logs');
}

await browser.close();
