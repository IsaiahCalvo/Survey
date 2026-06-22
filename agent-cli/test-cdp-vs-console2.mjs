// Test: Is Vite logging via console.log or via CDP only?
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

let cdpConsoleMessages = [];
page.on('console', (msg) => {
  cdpConsoleMessages.push({
    type: msg.type(),
    text: msg.text(),
  });
});

// Hook console at the VERY START, before any script loads
await page.addInitScript(() => {
  const originalLog = console.log;
  const originalDebug = console.debug;
  const originalInfo = console.info;
  
  window.__capturedBeforeMain = [];
  
  console.log = (...args) => {
    window.__capturedBeforeMain.push({ fn: 'log', args: args.map(a => String(a).slice(0, 60)) });
    originalLog(...args);
  };
  
  console.debug = (...args) => {
    window.__capturedBeforeMain.push({ fn: 'debug', args: args.map(a => String(a).slice(0, 60)) });
    originalDebug(...args);
  };
  
  console.info = (...args) => {
    window.__capturedBeforeMain.push({ fn: 'info', args: args.map(a => String(a).slice(0, 60)) });
    originalInfo(...args);
  };
  
  originalLog('[INIT-SCRIPT] Hooked console methods');
});

console.log('[PLAYWRIGHT] Starting navigation');
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
console.log('[PLAYWRIGHT] DOMContentLoaded reached');

let capturedBeforeMain = await page.evaluate(() => window.__capturedBeforeMain);

console.log('=== RESULTS ===\n');
console.log(`CDP console messages: ${cdpConsoleMessages.length}`);
cdpConsoleMessages.forEach((msg, i) => {
  console.log(`  [${i}] ${msg.type}: ${msg.text.slice(0, 80)}`);
});

console.log(`\nCaptured via addInitScript hook: ${capturedBeforeMain.length}`);
capturedBeforeMain.forEach((msg, i) => {
  console.log(`  [${i}] ${msg.fn}(...)`);
});

console.log('\n=== ANALYSIS ===');
const hasInitLog = capturedBeforeMain.some(m => m.args.some(a => a.includes('INIT-SCRIPT')));
console.log(`Init script ran: ${hasInitLog}`);
console.log(`CDP caught ${cdpConsoleMessages.length} messages`);
console.log(`JS hooked captured ${capturedBeforeMain.length} messages`);

if (capturedBeforeMain.length === 0 && cdpConsoleMessages.length > 0) {
  console.log('\nCRITICAL: CDP is capturing logs that bypass console.log!');
} else if (capturedBeforeMain.length >= cdpConsoleMessages.length) {
  console.log('\nCalls are going through console.log, but hook in main.jsx is too late.');
}

await browser.close();
