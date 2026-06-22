// Test: is React actually rendering? Check DOM and errors
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

let pageErrors = [];
let pageWarnings = [];

page.on('console', (msg) => {
  if (msg.type() === 'error') {
    pageErrors.push(msg.text());
  } else if (msg.type() === 'warning') {
    pageWarnings.push(msg.text());
  }
});

page.on('pageerror', (err) => {
  pageErrors.push(`[pageerror] ${err.message}`);
});

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });

// Wait a bit longer for React to render
await page.waitForTimeout(3000);

// Check the DOM
let domState = await page.evaluate(() => {
  return {
    rootExists: !!document.getElementById('root'),
    rootHasChildren: (document.getElementById('root')?.children || []).length > 0,
    rootInnerHTML: document.getElementById('root')?.innerHTML?.slice(0, 200) || null,
    bodyClasses: document.body.className,
    pageTitle: document.title,
  };
});

console.log('=== DOM STATE ===');
console.log(JSON.stringify(domState, null, 2));

// Check for loaded chunks
let chunks = await page.evaluate(() => {
  const scripts = Array.from(document.querySelectorAll('script[src]'));
  return {
    scriptCount: scripts.length,
    srcs: scripts.map(s => s.src),
  };
});

console.log('\n=== SCRIPT CHUNKS ===');
console.log(`Loaded: ${chunks.scriptCount}`);
chunks.srcs.forEach(src => {
  console.log(`  ${src}`);
});

console.log('\n=== PAGE ERRORS ===');
if (pageErrors.length === 0) {
  console.log('  (no errors)');
} else {
  pageErrors.forEach(err => console.log(`  ${err}`));
}

console.log('\n=== PAGE WARNINGS ===');
if (pageWarnings.length === 0) {
  console.log('  (no warnings)');
} else {
  pageWarnings.slice(0, 10).forEach(warn => console.log(`  ${warn.slice(0, 150)}`));
}

// Check the actual app state
let appState = await page.evaluate(() => {
  return {
    hasAuthProvider: !!window.__authProvider, // might be set by AuthProvider
    hasRouter: !!window.__router, // might be set by Router
    visibleText: document.body.innerText.slice(0, 300),
  };
});

console.log('\n=== APP STATE ===');
console.log(JSON.stringify(appState, null, 2));

// Most importantly: check the buffer at this point
let bufferState = await page.evaluate(() => {
  return {
    bufferLength: window.__consoleLogBuffer?.length,
    buffer: window.__consoleLogBuffer || [],
  };
});

console.log('\n=== BUFFER STATE (after 3s wait) ===');
console.log(`Length: ${bufferState.bufferLength}`);
if (bufferState.buffer.length > 0) {
  console.log('First 10 lines:');
  bufferState.buffer.slice(0, 10).forEach((line, i) => {
    console.log(`  [${i}] ${line.slice(0, 100)}`);
  });
}

await browser.close();
