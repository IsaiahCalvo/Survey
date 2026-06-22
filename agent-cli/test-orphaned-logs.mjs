// Test: prove that logs are orphaned by main.jsx creating a new buffer
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

// Install a buffer at window level BEFORE main.jsx runs
await page.addInitScript(() => {
  // This simulates what an earlier console.log override might have done
  window.__orphanedBuffer = [];
  
  const origLog = console.log;
  const origDebug = console.debug;
  
  console.log = (...args) => {
    window.__orphanedBuffer.push({ fn: 'log', args });
    origLog(...args);
  };
  
  console.debug = (...args) => {
    window.__orphanedBuffer.push({ fn: 'debug', args });
    origDebug(...args);
  };
  
  origLog('[EARLY] Buffer created, console patched');
});

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);

let buffers = await page.evaluate(() => {
  return {
    orphanedBuffer: window.__orphanedBuffer,
    mainBuffer: window.__consoleLogBuffer,
    consoleLogFn: console.log.toString().slice(0, 100),
  };
});

console.log('=== ORPHANED LOGS TEST ===\n');
console.log(`Orphaned buffer (from addInitScript): ${buffers.orphanedBuffer.length} entries`);
buffers.orphanedBuffer.forEach((entry, i) => {
  const arg0 = String(entry.args[0]).slice(0, 60);
  console.log(`  [${i}] ${entry.fn}: ${arg0}`);
});

console.log(`\nMain buffer (from main.jsx IIFE): ${buffers.mainBuffer.length} entries`);
buffers.mainBuffer.forEach((entry, i) => {
  console.log(`  [${i}] ${entry.slice(0, 80)}`);
});

console.log('\n=== CONCLUSION ===');
if (buffers.orphanedBuffer.length > 0 && buffers.mainBuffer.length === 0) {
  console.log('CONFIRMED: main.jsx creates a NEW buffer, orphaning the old one');
  console.log('Logs captured before main.jsx IIFE runs are LOST');
}

await browser.close();
