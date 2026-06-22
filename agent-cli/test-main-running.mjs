// Test: is the main.jsx IIFE actually running?
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(500);

// Check what actually exists on window after page load
let windowState = await page.evaluate(() => {
  return {
    hasConsoleLogBuffer: '__consoleLogBuffer' in window,
    bufferType: Array.isArray(window.__consoleLogBuffer) ? 'array' : typeof window.__consoleLogBuffer,
    bufferLength: Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer.length : null,
    bufferContents: window.__consoleLogBuffer || [],
    
    // Check if the console was patched
    consoleLogString: console.log.toString().slice(0, 200),
    
    // Check for other evidence of main.jsx running (e.g., ErrorBoundary, React)
    hasReact: typeof React !== 'undefined',
    hasReactDOM: typeof ReactDOM !== 'undefined',
    
    // Check for our session storage key
    sessionStorageHasKey: window.sessionStorage.getItem('__consoleLogBuffer') !== null,
  };
});

console.log('=== WINDOW STATE AFTER PAGE LOAD ===');
console.log(JSON.stringify(windowState, null, 2));

// Try to log something and see if it gets captured
await page.evaluate(() => {
  console.log('[TEST] Direct test log from Playwright');
});

let afterTest = await page.evaluate(() => {
  return {
    bufferLength: window.__consoleLogBuffer?.length,
    lastLine: window.__consoleLogBuffer?.[window.__consoleLogBuffer.length - 1],
  };
});

console.log('\n=== AFTER TEST LOG ===');
console.log(JSON.stringify(afterTest, null, 2));

await browser.close();
