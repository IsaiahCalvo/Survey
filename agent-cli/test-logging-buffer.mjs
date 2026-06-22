// test-logging-buffer.mjs — reproduce the empty-buffer symptom via Playwright
import { chromium } from 'playwright';

const DOC_NAME = 'Package 2 - Rev 4 -- IC.pdf';
const HEADLESS = true;

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

// Log all console messages from renderer
let rendererLogs = [];
page.on('console', (msg) => {
  rendererLogs.push({ type: msg.type(), text: msg.text() });
});

console.log('\n=== STEP 1: Navigate to home page ===');
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

let bufferLenHome = await page.evaluate(() => {
  return Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer.length : -1;
});
let bufferSampleHome = await page.evaluate(() => {
  const buf = window.__consoleLogBuffer || [];
  return buf.slice(-5).map(l => l.slice(0, 100));
});
console.log(`HOME BUFFER LENGTH: ${bufferLenHome}`);
console.log(`HOME BUFFER SAMPLE (last 5):`, bufferSampleHome);
console.log(`RENDERER LOGS COLLECTED: ${rendererLogs.length}`);

let homeFrames = await page.frames();
console.log(`HOME FRAMES COUNT: ${homeFrames.length}`);
for (let i = 0; i < homeFrames.length; i++) {
  const f = homeFrames[i];
  try {
    const hasBuffer = await f.evaluate(() => typeof window.__consoleLogBuffer !== 'undefined');
    const bufLen = await f.evaluate(() => 
      Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer.length : -1
    );
    console.log(`  Frame ${i}: hasBuffer=${hasBuffer}, bufLen=${bufLen}, url=${f.url()}`);
  } catch (e) {
    console.log(`  Frame ${i}: eval failed (different origin or sandboxed)`);
  }
}

console.log('\n=== STEP 2: Open PDF ===');
try {
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 30000 });
  await tile.click();
  await page.waitForTimeout(2500);
} catch (e) {
  console.log('Could not open PDF:', e.message);
}

let bufferLenAfterOpen = await page.evaluate(() => {
  return Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer.length : -1;
});
let bufferSampleAfterOpen = await page.evaluate(() => {
  const buf = window.__consoleLogBuffer || [];
  return buf.slice(-5).map(l => l.slice(0, 100));
});
console.log(`AFTER OPEN BUFFER LENGTH: ${bufferLenAfterOpen}`);
console.log(`AFTER OPEN BUFFER SAMPLE (last 5):`, bufferSampleAfterOpen);
console.log(`RENDERER LOGS COLLECTED (total): ${rendererLogs.length}`);

let openFrames = await page.frames();
console.log(`AFTER OPEN FRAMES COUNT: ${openFrames.length}`);
for (let i = 0; i < openFrames.length; i++) {
  const f = openFrames[i];
  try {
    const hasBuffer = await f.evaluate(() => typeof window.__consoleLogBuffer !== 'undefined');
    const bufLen = await f.evaluate(() => 
      Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer.length : -1
    );
    console.log(`  Frame ${i}: hasBuffer=${hasBuffer}, bufLen=${bufLen}, url=${f.url()}`);
  } catch (e) {
    console.log(`  Frame ${i}: eval failed (different origin or sandboxed)`);
  }
}

console.log('\n=== STEP 3: Simulate zoom (synthetic wheel event) ===');
try {
  await page.evaluate(() => {
    const evt = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true
    });
    document.body.dispatchEvent(evt);
  });
  await page.waitForTimeout(500);
} catch (e) {
  console.log('Zoom action failed:', e.message);
}

let bufferLenAfterZoom = await page.evaluate(() => {
  return Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer.length : -1;
});
let bufferSampleAfterZoom = await page.evaluate(() => {
  const buf = window.__consoleLogBuffer || [];
  return buf.slice(-5).map(l => l.slice(0, 100));
});
console.log(`AFTER ZOOM BUFFER LENGTH: ${bufferLenAfterZoom}`);
console.log(`AFTER ZOOM BUFFER SAMPLE (last 5):`, bufferSampleAfterZoom);

console.log('\n=== STEP 4: Check sessionStorage persistence ===');
let sessionStorageContent = await page.evaluate(() => {
  try {
    const raw = window.sessionStorage.getItem('__consoleLogBuffer');
    if (!raw) return { exists: false };
    const parsed = JSON.parse(raw);
    return { exists: true, length: Array.isArray(parsed) ? parsed.length : 'not-array' };
  } catch (e) {
    return { exists: true, error: e.message };
  }
});
console.log(`SESSION STORAGE:`, sessionStorageContent);

console.log('\n=== FINAL ANALYSIS ===');
let fullBuffer = await page.evaluate(() => {
  return Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer : [];
});
console.log(`Final buffer length: ${fullBuffer.length}`);
if (fullBuffer.length === 0) {
  console.log('** BUFFER IS EMPTY - REPRODUCES THE BUG **');
} else {
  console.log('First 10 lines:');
  fullBuffer.slice(0, 10).forEach((line, i) => {
    console.log(`  [${i}] ${line.slice(0, 120)}`);
  });
  console.log('Last 10 lines:');
  fullBuffer.slice(-10).forEach((line, i) => {
    console.log(`  [${fullBuffer.length - 10 + i}] ${line.slice(0, 120)}`);
  });
}

// Print all renderer logs we captured to compare
console.log('\n=== RENDERER LOGS FROM DevTools (CDPChromium bridge) ===');
console.log(`Total: ${rendererLogs.length}`);
rendererLogs.slice(0, 20).forEach((log, i) => {
  console.log(`  [${i}] ${log.type}: ${log.text.slice(0, 100)}`);
});
if (rendererLogs.length > 20) {
  console.log(`  ... ${rendererLogs.length - 20} more ...`);
}

await browser.close();
