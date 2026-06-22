// Test whether the console override is actually installed
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

// Add script BEFORE navigation to intercept module init
await page.addInitScript(() => {
  // Check if buffer exists and what happens when we log
  window.__testBefore = {
    bufferExists: typeof window.__consoleLogBuffer !== 'undefined',
    bufferLength: Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer.length : null,
    originalLogType: typeof window._originalLog,
  };
  
  // Patch console.log to see if it gets patched again
  const origLog = console.log;
  window.__logCallCount = 0;
  console.log = (...args) => {
    window.__logCallCount = (window.__logCallCount || 0) + 1;
    origLog(...args);
  };
  
  console.log('[BEFORE-INIT] Testing if console.log patch persists');
});

console.log('\n=== Navigating to home page ===');
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });

// Check if our patch was overridden
let overrideStatus = await page.evaluate(() => {
  return {
    testBeforeData: window.__testBefore,
    logCallCount: window.__logCallCount,
    bufferExists: typeof window.__consoleLogBuffer !== 'undefined',
    bufferLength: Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer.length : null,
    bufferSample: Array.isArray(window.__consoleLogBuffer) 
      ? window.__consoleLogBuffer.slice(0, 3)
      : null,
  };
});

console.log('=== OVERRIDE STATUS ===');
console.log(JSON.stringify(overrideStatus, null, 2));

// Now try to manually test if console.log is hooked
console.log('\n=== Testing console.log directly ===');
await page.evaluate(() => {
  console.log('[DIRECT-TEST] This is a test log');
  console.warn('[DIRECT-TEST] This is a test warn');
});

let afterManualLog = await page.evaluate(() => {
  return {
    bufferLength: Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer.length : null,
    lastLines: Array.isArray(window.__consoleLogBuffer) 
      ? window.__consoleLogBuffer.slice(-3)
      : null,
  };
});

console.log('=== AFTER MANUAL LOG ===');
console.log(JSON.stringify(afterManualLog, null, 2));

// Check if console.log has been replaced at all
let consoleInspection = await page.evaluate(() => {
  return {
    isNativeLog: console.log.toString().includes('[native code]'),
    logFnName: console.log.name,
    logFnLength: console.log.length,
    consoleKeys: Object.keys(console),
  };
});

console.log('=== CONSOLE INSPECTION ===');
console.log(JSON.stringify(consoleInspection, null, 2));

await browser.close();
