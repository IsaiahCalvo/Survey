// Phase 28 UAT — Live two-account testing helper.
//
// Launches a HEADED Chromium window signed in as phase28-bot-1 against the
// running Vite dev server. Uses Playwright's `page.route()` to rewrite the
// AuthContext.jsx module that Vite serves so that `import.meta.env`'s
// VITE_DEV_AUTO_LOGIN_EMAIL / _PASSWORD point at the bot instead of the
// real dev account. That keeps the existing auto-login codepath intact and
// stops the AuthContext "cached email mismatches dev email -> sign out and
// re-sign-in as dev" override from kicking the bot back out.
//
// The browser is launched with a persistent context (so the bot's session
// survives) and a stable window title so the user can tell it apart from
// their main app instance.
//
// Run:  node .planning/phases/28-transport-spike-auth-validator/launch-bot1-window.mjs
// Quit: close the Chromium window. The Node process exits when the browser
//       context is closed.

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const credsPath = join(__dirname, '.bot-credentials.json');
const creds = JSON.parse(readFileSync(credsPath, 'utf8'));

const bot = creds.bots.find((b) => b.email === 'phase28-bot-1@betasafes2.test');
if (!bot) {
  throw new Error('phase28-bot-1 not found in .bot-credentials.json');
}

const APP_URL = 'http://localhost:5173/';
const PROFILE_DIR = '/tmp/phase28-bot1-profile';

console.log('[phase28-bot1] launching Chromium...');
console.log('[phase28-bot1] bot email :', bot.email);
console.log('[phase28-bot1] document  :', creds.test_document_name, '(', creds.test_document_id, ')');

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1440, height: 900 },
  // Big distinguishing flags so the user can spot which window is the bot.
  args: [
    '--window-position=80,80',
    '--window-size=1440,900',
    '--window-name=PHASE28-BOT-1',
  ],
});

// Phase 28 UAT — rewrite the dev auto-login env values in the AuthContext
// module so the bot creds are used instead of Isaiah's real account. This
// only runs on the AuthContext source request and is scoped to this browser
// instance.
await context.route('**/src/contexts/AuthContext.jsx*', async (route) => {
  const response = await route.fetch();
  let body = await response.text();
  body = body
    .replace(
      /"VITE_DEV_AUTO_LOGIN_EMAIL":\s*"[^"]*"/,
      `"VITE_DEV_AUTO_LOGIN_EMAIL": ${JSON.stringify(bot.email)}`
    )
    .replace(
      /"VITE_DEV_AUTO_LOGIN_PASSWORD":\s*"[^"]*"/,
      `"VITE_DEV_AUTO_LOGIN_PASSWORD": ${JSON.stringify(bot.password)}`
    );
  await route.fulfill({
    status: response.status(),
    headers: response.headers(),
    body,
  });
});

const page = context.pages()[0] ?? (await context.newPage());

// Capture console + network signal so we can confirm a Realtime channel
// subscription is wired up. We only watch — never edit.
const consoleEvents = [];
page.on('console', (msg) => {
  const text = msg.text();
  consoleEvents.push(text);
  if (
    text.includes('[dev-auto-login]') ||
    text.toLowerCase().includes('realtime') ||
    text.toLowerCase().includes('phoenix') ||
    text.toLowerCase().includes('channel') ||
    text.toLowerCase().includes('phase28')
  ) {
    console.log('[browser]', text);
  }
});

let realtimeWsSeen = false;
page.on('websocket', (ws) => {
  console.log('[ws ] open  ', ws.url());
  if (ws.url().includes('realtime')) realtimeWsSeen = true;
});

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

// Set a window title hint so the user can spot this tab/window quickly.
await page.evaluate(() => {
  document.title = 'PHASE28-BOT-1 (collab UAT)';
  const tag = document.createElement('div');
  tag.textContent = 'PHASE28-BOT-1';
  Object.assign(tag.style, {
    position: 'fixed',
    top: '8px',
    right: '8px',
    background: '#FFCC00',
    color: '#000',
    fontFamily: 'monospace',
    fontWeight: 'bold',
    padding: '4px 8px',
    borderRadius: '4px',
    zIndex: '2147483647',
    pointerEvents: 'none',
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
  });
  document.body.appendChild(tag);
});

// Smoke check: wait briefly for the auto-login + realtime channel to come
// up, then report findings to stdout.
await page.waitForTimeout(8000);

const authLoginLines = consoleEvents.filter((l) => l.includes('[dev-auto-login]'));
console.log('[phase28-bot1] auto-login console lines:');
for (const l of authLoginLines) console.log('   ', l);
console.log('[phase28-bot1] realtime websocket observed:', realtimeWsSeen);

// Re-paint the badge in case the SPA re-mounted and wiped the tag.
await page.evaluate(() => {
  if (!document.getElementById('phase28-bot1-badge')) {
    const tag = document.createElement('div');
    tag.id = 'phase28-bot1-badge';
    tag.textContent = 'PHASE28-BOT-1';
    Object.assign(tag.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      background: '#FFCC00',
      color: '#000',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      padding: '4px 8px',
      borderRadius: '4px',
      zIndex: '2147483647',
      pointerEvents: 'none',
      boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
    });
    document.body.appendChild(tag);
  }
  document.title = 'PHASE28-BOT-1 (collab UAT)';
});

console.log('[phase28-bot1] window is live. Close it when finished.');

context.on('close', () => {
  console.log('[phase28-bot1] context closed; exiting.');
  process.exit(0);
});
