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
    location: msg.location(),
    args: msg.args().length, // number of arguments
  });
});

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1000);

// Get list of all frames
let frameInfo = await page.evaluate(() => {
  // The page.frames() API is not available in evaluate, so we check from main context
  return {
    frameCount: 1, // default, checked below
    iframeCount: document.querySelectorAll('iframe').length,
  };
});

// Use page.frames() from the Playwright side
const frames = page.frames();
console.log(`=== FRAMES ===`);
console.log(`Main frame: ${page.mainFrame().url()}`);
console.log(`Total frames: ${frames.length}`);

for (let i = 0; i < frames.length; i++) {
  const frame = frames[i];
  try {
    const content = await frame.evaluate(() => {
      return {
        hasConsoleLogBuffer: typeof window.__consoleLogBuffer !== 'undefined',
        bufferLength: Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer.length : null,
        url: window.location.href,
      };
    });
    console.log(`Frame ${i} (${frame.name()}): ${JSON.stringify(content)}`);
  } catch (e) {
    console.log(`Frame ${i} (${frame.name()}): eval failed - ${e.message}`);
  }
}

console.log(`\n=== CDP CONSOLE CALLS ===`);
console.log(`Total: ${cdpLogs.length}`);
cdpLogs.forEach((log, i) => {
  console.log(`[${i}] ${log.type} (${log.args} args): ${log.text.slice(0, 100)}`);
  if (log.location()) {
    console.log(`     at ${log.location().url}:${log.location().lineNumber}`);
  }
});

console.log(`\n=== KEY INSIGHT ===`);
console.log('Vite logs come from CDP but are not captured by our console.log patch.');
console.log('Possible causes:');
console.log('1. Vite logging happens during page load, before main.jsx runs');
console.log('2. Vite might use a different console object');
console.log('3. Logs might come from a Worker/SharedWorker');
console.log('4. The CDP layer might be capturing logs that never actually hit console.log');

await browser.close();
