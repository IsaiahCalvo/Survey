// Test: what is the actual script loading order?
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

let scriptLoadingOrder = [];

// Track when scripts are requested
page.on('request', (req) => {
  const url = req.url();
  if (url.includes('main.jsx') || url.includes('vite') || url.includes('@vite')) {
    scriptLoadingOrder.push({ event: 'request', url, method: req.method() });
  }
});

// Track when scripts complete
page.on('response', (res) => {
  const url = res.url();
  if (url.includes('main.jsx') || url.includes('vite') || url.includes('@vite')) {
    scriptLoadingOrder.push({ event: 'response', url, status: res.status() });
  }
});

// Track script evaluation
await page.addInitScript(() => {
  window.__scriptEvalOrder = [];
  window.__scriptEvalOrder.push('INIT-SCRIPT-RAN');
  
  // This should run before anything else in main.jsx
  console.log('[PRE-MAIN] Init script running');
});

console.log('[START] Starting navigation');
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('[DOMContentLoaded]');

let evalOrder = await page.evaluate(() => window.__scriptEvalOrder);

console.log('=== SCRIPT LOADING ORDER ===');
console.log('Requests/Responses:');
scriptLoadingOrder.forEach((item, i) => {
  const url = item.url.split('/').pop();
  console.log(`  [${i}] ${item.event.toUpperCase()}: ${url} ${item.status ? `(${item.status})` : ''}`);
});

console.log('\nScript Evaluation Order:');
evalOrder.forEach((item, i) => {
  console.log(`  [${i}] ${item}`);
});

// Try to read the actual HTML to see script tags
let html = await page.content();
let scriptMatches = html.match(/<script[^>]*src="[^"]*"/g) || [];
console.log('\n=== SCRIPT TAGS IN HTML ===');
scriptMatches.forEach((match, i) => {
  console.log(`  [${i}] ${match}`);
});

console.log('\n=== HYPOTHESIS ===');
console.log('If main.jsx script is loaded AFTER Vite connects, then:');
console.log('1. Vite logs happen BEFORE main.jsx runs its IIFE');
console.log('2. The console.log override in main.jsx misses those early logs');
console.log('3. This explains why the buffer is empty in the normal case');

await browser.close();
