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

// Hook console BEFORE navigation
await page.evaluateOnNewDocument(() => {
  const originalLog = console.log;
  const originalDebug = console.debug;
  const originalInfo = console.info;
  
  window.__capturedBeforeMain = [];
  
  console.log = (...args) => {
    window.__capturedBeforeMain.push({ fn: 'log', args: args.map(String) });
    originalLog(...args);
  };
  
  console.debug = (...args) => {
    window.__capturedBeforeMain.push({ fn: 'debug', args: args.map(String) });
    originalDebug(...args);
  };
  
  console.info = (...args) => {
    window.__capturedBeforeMain.push({ fn: 'info', args: args.map(String) });
    originalInfo(...args);
  };
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

console.log(`\nCaptured via evaluateOnNewDocument: ${capturedBeforeMain.length}`);
capturedBeforeMain.forEach((msg, i) => {
  console.log(`  [${i}] ${msg.fn}(${msg.args.map(s => s.slice(0, 60)).join(', ')})`);
});

console.log('\n=== CONCLUSION ===');
if (capturedBeforeMain.length === 0 && cdpConsoleMessages.length > 0) {
  console.log('CDP is capturing logs that are NOT going through console.log!');
  console.log('This suggests Vite is using a different logging mechanism.');
  console.log('Possible: direct console method replacement, or logging via a different API.');
} else if (capturedBeforeMain.length === cdpConsoleMessages.length) {
  console.log('CDP logs match captured logs - they ARE going through console.log');
} else {
  console.log(`Mismatch: CDP=${cdpConsoleMessages.length}, captured=${capturedBeforeMain.length}`);
}

await browser.close();
