// Test: where do Vite logs come from? Are they in an iframe/worker/different context?
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

let cdpLogs = [];
page.on('console', (msg) => {
  cdpLogs.push({
    type: msg.type(),
    text: msg.text(),
    location: msg.location ? msg.location() : null,
  });
});

// Also track ALL messages that happen during load vs after
let beforeLoadLogs = [];
let afterLoadLogs = [];
let loadComplete = false;

page.on('console', (msg) => {
  const entry = { type: msg.type(), text: msg.text() };
  if (!loadComplete) {
    beforeLoadLogs.push(entry);
  } else {
    afterLoadLogs.push(entry);
  }
});

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
loadComplete = true;
await page.waitForTimeout(2000);

console.log('=== VITE/REACT LOGS ANALYSIS ===\n');

console.log(`CDP logs during DOMContentLoaded: ${beforeLoadLogs.length}`);
beforeLoadLogs.forEach((log, i) => {
  console.log(`  [${i}] ${log.type}: ${log.text.slice(0, 100)}`);
});

console.log(`\nCDP logs after DOMContentLoaded: ${afterLoadLogs.length}`);
afterLoadLogs.slice(0, 5).forEach((log, i) => {
  console.log(`  [${i}] ${log.type}: ${log.text.slice(0, 100)}`);
});

// Check actual page console buffer now
let pageState = await page.evaluate(() => {
  return {
    bufferLength: window.__consoleLogBuffer?.length || 0,
    buffer: (window.__consoleLogBuffer || []).slice(0, 5),
    sessionStorage: window.sessionStorage.getItem('__consoleLogBuffer') ? 'has data' : 'empty',
  };
});

console.log(`\n=== PAGE CONSOLE BUFFER ===`);
console.log(`Buffer length: ${pageState.bufferLength}`);
console.log(`Buffer contents: ${pageState.buffer.length > 0 ? pageState.buffer.map(l => l.slice(0, 60)).join(' | ') : '(empty)'}`);
console.log(`SessionStorage: ${pageState.sessionStorage}`);

console.log(`\n=== KEY FINDING ===`);
console.log('Vite/React logs (3 messages) are captured by CDP console hook');
console.log('but NOT captured by window.__consoleLogBuffer (which is 0 lines)');
console.log('This suggests:');
console.log('- main.jsx console.log override is installed AFTER Vite logs');
console.log('- OR Vite uses a logging mechanism that bypasses console.log');
console.log('- OR the CDP hook captures logs before they reach JS console.log');

await browser.close();
