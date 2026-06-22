// Test: when does the console override get installed relative to Vite/React logs?
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

// Capture ALL console calls via CDP, which happens at a lower level than JS
const allConsoleCalls = [];
page.on('console', (msg) => {
  allConsoleCalls.push({
    type: msg.type(),
    text: msg.text(),
    location: msg.location(),
  });
});

// Try to patch console even earlier
await page.addInitScript(() => {
  window.__consoleOverrideInstalled = false;
  
  // Log that we're about to patch
  const origLog = console.log;
  origLog('[INIT-SCRIPT] About to patch console at', performance.now());
  
  // Now patch it
  const buffer = [];
  window.__testBuffer = buffer;
  
  console.log = (...args) => {
    const now = performance.now();
    const line = args.join(' ');
    buffer.push({ at: now, line });
    origLog(...args);
  };
  
  window.__consoleOverrideInstalled = true;
  origLog('[INIT-SCRIPT] Console patched, now installing main.jsx handlers...');
});

console.log('[PLAYWRIGHT] Navigation start');
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('[PLAYWRIGHT] DOMContentLoaded');

// Wait for rendering
await page.waitForTimeout(1000);

let testResults = await page.evaluate(() => {
  return {
    overrideInstalled: window.__consoleOverrideInstalled,
    testBufferLength: window.__testBuffer?.length || 0,
    testBuffer: window.__testBuffer || [],
    mainBufferLength: window.__consoleLogBuffer?.length || 0,
    mainBuffer: (window.__consoleLogBuffer || []).slice(0, 5),
  };
});

console.log('=== EXECUTION ORDER TEST ===');
console.log('Override installed:', testResults.overrideInstalled);
console.log('Test buffer length:', testResults.testBufferLength);
console.log('Test buffer contents:');
testResults.testBuffer.forEach((entry, i) => {
  console.log(`  [${i}] @${entry.at.toFixed(1)}ms: ${entry.line}`);
});

console.log('\nMain buffer length:', testResults.mainBufferLength);
console.log('Main buffer sample:');
testResults.mainBuffer.forEach((line, i) => {
  console.log(`  [${i}] ${line.slice(0, 100)}`);
});

console.log('\n=== CDP CONSOLE MESSAGES ===');
console.log(`Total CDP messages: ${allConsoleCalls.length}`);
allConsoleCalls.slice(0, 15).forEach((call, i) => {
  console.log(`[${i}] ${call.type}: ${call.text.slice(0, 100)}`);
});

await browser.close();
