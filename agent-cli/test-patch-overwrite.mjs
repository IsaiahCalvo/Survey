// Test: is the addInitScript patch being overwritten by main.jsx?
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

// Install a marker to see if console.log gets patched multiple times
await page.addInitScript(() => {
  window.__patchLog = {
    patchCount: 0,
    patches: [],
  };
  
  const marker = () => {
    window.__patchLog.patchCount++;
    window.__patchLog.patches.push({
      num: window.__patchLog.patchCount,
      at: performance.now(),
      stackLen: new Error().stack.split('\n').length,
    });
  };
  
  const origLog = console.log;
  console.log = (...args) => {
    marker();
    origLog(...args);
  };
});

console.log('[BEFORE NAV] Before navigation');

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });

console.log('[AFTER NAV] After DOMContentLoaded');

let patchData = await page.evaluate(() => window.__patchLog);
console.log('=== PATCH LOG ===');
console.log(JSON.stringify(patchData, null, 2));

// Also check: is console.log defined at window level?
let consoleState = await page.evaluate(() => {
  return {
    hasLog: 'log' in console,
    logIsFunction: typeof console.log === 'function',
    windowHasLog: typeof window.console?.log === 'function',
    consoleRef: console === window.console,
  };
});

console.log('=== CONSOLE STATE ===');
console.log(JSON.stringify(consoleState, null, 2));

await browser.close();
