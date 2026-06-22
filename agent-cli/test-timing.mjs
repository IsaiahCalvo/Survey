// Test timing: when is console override installed vs when do logs appear?
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

const timestamps = [];

// Tap into the page's performance timeline from the very start
await page.addInitScript(() => {
  window.__timing = {};
  window.__logTimeline = [];
  const origLog = console.log;
  const origWarn = console.warn;
  let logCount = 0;
  
  // Wrap to track when logs appear relative to page start
  console.log = (...args) => {
    const now = performance.now();
    logCount++;
    window.__logTimeline.push({ 
      at: now, 
      type: 'log',
      num: logCount,
      text: String(args[0]).slice(0, 80)
    });
    origLog(...args);
  };
  
  console.warn = (...args) => {
    const now = performance.now();
    logCount++;
    window.__logTimeline.push({ 
      at: now, 
      type: 'warn',
      num: logCount,
      text: String(args[0]).slice(0, 80)
    });
    origWarn(...args);
  };
  
  window.__timing.initScriptRan = performance.now();
});

const navStart = performance.now();
console.log(`[PLAYWRIGHT] Navigation starting at T+${navStart.toFixed(1)}ms`);

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
const navEnd = performance.now();
console.log(`[PLAYWRIGHT] DOMContentLoaded at T+${(navEnd - navStart).toFixed(1)}ms`);

await page.waitForTimeout(1000);

let timeline = await page.evaluate(() => {
  return {
    initScriptRan: window.__timing?.initScriptRan,
    logTimeline: window.__logTimeline || [],
    bufferLength: Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer.length : null,
    bufferContents: Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer : null,
  };
});

console.log('\n=== LOG TIMELINE (relative to page start) ===');
console.log(`Init script ran at: ${timeline.initScriptRan?.toFixed(1) || '?'}ms`);
console.log(`Total logs captured during page load: ${timeline.logTimeline.length}`);
console.log('Timeline:');
timeline.logTimeline.slice(0, 20).forEach(entry => {
  console.log(`  @${entry.at.toFixed(1)}ms [${entry.num}] ${entry.type}: ${entry.text}`);
});
if (timeline.logTimeline.length > 20) {
  console.log(`  ... ${timeline.logTimeline.length - 20} more entries ...`);
}

console.log(`\n=== BUFFER STATE ===`);
console.log(`Buffer length: ${timeline.bufferLength}`);
if (timeline.bufferLength > 0) {
  console.log('Buffer contents (first 5):');
  timeline.bufferContents.slice(0, 5).forEach((line, i) => {
    console.log(`  [${i}] ${line.slice(0, 100)}`);
  });
}

// Check main.jsx location
let mainMeta = await page.evaluate(() => {
  // Look for the main.jsx module in the module graph
  const scripts = Array.from(document.querySelectorAll('script'));
  return {
    scriptCount: scripts.length,
    srcValues: scripts.filter(s => s.src).map(s => ({ src: s.src, type: s.type })),
    hasConsoleLogBuffer: typeof window.__consoleLogBuffer !== 'undefined',
  };
});

console.log(`\n=== PAGE STRUCTURE ===`);
console.log(`Scripts loaded: ${mainMeta.scriptCount}`);
console.log(`Has console buffer: ${mainMeta.hasConsoleLogBuffer}`);

await browser.close();
