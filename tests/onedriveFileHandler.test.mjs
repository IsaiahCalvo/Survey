// KAL-703: "Open in Survey" from OneDrive and SharePoint on the web.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler, { fileFromHandlerItems } from '../api/onedrive-open.mjs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const GRAPH = 'https://graph.microsoft.com/v1.0/drives/b!AbC_12-x/items/01ABCDEF2345';

function invoke({ method = 'POST', body, url = '/api/onedrive-open' }) {
  const headers = {};
  let status = 200;
  const response = {
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    status: (s) => { status = s; return response; },
    end: () => ({ status, headers }),
    json: (j) => ({ status, headers, json: j }),
  };
  return handler({ method, body, url, headers: {} }, response);
}

test('the first file Microsoft names becomes its drive and item ids', () => {
  assert.deepEqual(fileFromHandlerItems(JSON.stringify([GRAPH])), { driveId: 'b!AbC_12-x', itemId: '01ABCDEF2345' });
  assert.deepEqual(fileFromHandlerItems([{ url: GRAPH }]), { driveId: 'b!AbC_12-x', itemId: '01ABCDEF2345' });
  assert.equal(fileFromHandlerItems(JSON.stringify(['https://evil.example/v1.0/drives/a/items/b'])), null, 'only Microsoft Graph addresses');
  assert.equal(fileFromHandlerItems('http://graph.microsoft.com/v1.0/drives/a/items/b'), null, 'only https');
  assert.equal(fileFromHandlerItems(JSON.stringify(['https://graph.microsoft.com/v1.0/drives/a%22%3E/items/b'])), null, 'odd characters are refused');
  assert.equal(fileFromHandlerItems(null), null);
});

test('a POST from OneDrive is sent on to the app as a plain address', async () => {
  const form = await invoke({ body: { items: JSON.stringify([GRAPH]) } });
  assert.equal(form.status, 303);
  assert.equal(form.headers.location, '/?open-onedrive=b!AbC_12-x&item=01ABCDEF2345');
  const raw = await invoke({ body: `items=${encodeURIComponent(JSON.stringify([GRAPH]))}&cultureName=en-US` });
  assert.equal(raw.headers.location, '/?open-onedrive=b!AbC_12-x&item=01ABCDEF2345');
  const bad = await invoke({ body: { items: '[]' } });
  assert.equal(bad.headers.location, '/?open-onedrive-error=1');
  assert.equal((await invoke({ method: 'DELETE' })).status, 405);
});

test('wiring: Nightly flag, seeded, home screen opens the file linked', () => {
  assert.equal(FEATURE_FLAGS['onedrive-file-handler'].stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261117193500_onedrive_file_handler_flag.sql', import.meta.url), 'utf8');
  assert.match(sql, /\('onedrive-file-handler', 'off'/);
  const dash = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  assert.match(dash, /params\.get\('open-onedrive'\)/);
  assert.match(dash, /if \(!isFeatureOn\('onedrive-file-handler'\)\) return;/);
  assert.match(dash, /openFromDrive\(\{ driveId, itemId \}/);
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const spa = vercel.rewrites.find((r) => r.destination === '/index.html' && r.source.includes('api/'));
  assert.ok(spa && /\(\?!assets\/\|api\/\)/.test(spa.source), 'api/ is not rewritten to the app');
});
