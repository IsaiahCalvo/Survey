// Nightly 'phone-sign' (Drawboard PDF Pro push 2026-11-12, row A8): the Add
// signature dialog shows a QR code; the phone signs at /sign/<token>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import {
  PHONE_SIGN_MAX_POINTS,
  packStrokes,
  phoneSignTokenFromPath,
  phoneSignUrl,
  submitPhoneSignature,
  unpackStrokes,
} from '../src/signature/phoneSign.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const SAMPLE_ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';

test('phone-sign is a Nightly beta flag with an off-by-default row', () => {
  assert.equal(FEATURE_FLAGS['phone-sign']?.stage, 'beta');
  assert.match(read('../supabase/migrations/20261112162000_phone_signatures.sql'), /\('phone-sign', 'off'/);
});

test('strokes pack small and come back the same', () => {
  const strokes = [[{ x: 10.04, y: 20.06 }, { x: 30, y: 40 }], [], [{ x: 500, y: -5 }]];
  const payload = packStrokes(strokes);
  assert.deepEqual(payload, { v: 1, w: 440, h: 160, strokes: [[10, 20.1, 30, 40], [440, 0]] });
  assert.deepEqual(unpackStrokes(payload), [[{ x: 10, y: 20.1 }, { x: 30, y: 40 }], [{ x: 440, y: 0 }]]);
});

test('a flood of points is capped; junk is refused', () => {
  const long = Array.from({ length: PHONE_SIGN_MAX_POINTS + 50 }, (_, i) => ({ x: i % 440, y: 80 }));
  assert.equal(packStrokes([long]).strokes[0].length, PHONE_SIGN_MAX_POINTS * 2);
  assert.equal(unpackStrokes(null), null);
  assert.equal(unpackStrokes({ v: 2, strokes: [[1, 2]] }), null);
  assert.equal(unpackStrokes({ v: 1, strokes: [['x', 'y']] }), null);
  // A payload made on a pad twice the size lands scaled to ours.
  assert.deepEqual(unpackStrokes({ v: 1, w: 880, h: 320, strokes: [[880, 320]] }), [[{ x: 440, y: 160 }]]);
});

test('the link: own site on the web, surveytool.app from the apps; only uuids pass', () => {
  const web = { location: { protocol: 'https:', origin: 'https://surveytool-nightly.vercel.app' } };
  assert.equal(phoneSignUrl(SAMPLE_ID, web), `https://surveytool-nightly.vercel.app/sign/${SAMPLE_ID}`);
  const electron = { location: { protocol: 'file:', origin: 'null' }, electronAPI: {} };
  assert.equal(phoneSignUrl(SAMPLE_ID, electron), `https://surveytool.app/sign/${SAMPLE_ID}`);
  const capacitor = { location: { protocol: 'https:', origin: 'https://localhost' }, Capacitor: { isNativePlatform: () => true } };
  assert.equal(phoneSignUrl(SAMPLE_ID, capacitor), `https://surveytool.app/sign/${SAMPLE_ID}`);
  assert.equal(phoneSignTokenFromPath(`/sign/${SAMPLE_ID}`), SAMPLE_ID);
  assert.equal(phoneSignTokenFromPath(`/sign/${SAMPLE_ID.toUpperCase()}/`), SAMPLE_ID);
  assert.equal(phoneSignTokenFromPath('/sign/not-a-token'), null);
  assert.equal(phoneSignTokenFromPath(`/sign/${SAMPLE_ID}/more`), null);
});

test('the phone sends through the one-time RPC, never a table write', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: true, error: null }; } };
  assert.equal(await submitPhoneSignature(SAMPLE_ID, [[{ x: 1, y: 2 }]], client), true);
  assert.equal(calls[0][0], 'submit_phone_signature');
  assert.equal(calls[0][1].p_token, SAMPLE_ID);
  assert.equal(await submitPhoneSignature(SAMPLE_ID, [], client), false, 'nothing drawn: nothing sent');
  assert.equal(calls.length, 1);
});

test('the server side: owner-only rows, the anonymous phone only through the RPC', () => {
  const sql = read('../supabase/migrations/20261112162000_phone_signatures.sql');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.phone_signatures FROM anon;/);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /AND submitted_at IS NULL\s+AND created_at > now\(\) - interval '10 minutes';/);
  assert.match(sql, /octet_length\(p_payload::text\) > 200000/);
});

test('wiring: the Phone tab only with the flag, the /sign route, the pad shared', () => {
  const card = read('../src/components/SignatureCard.jsx');
  assert.match(card, /const \[phoneSignOn\] = useState\(\(\) => isFeatureOn\('phone-sign'\)\);/);
  assert.match(card, /phoneSignOn \? \[\['draw', 'Draw'\], \['type', 'Type'\], \['phone', 'Phone'\]\]/);
  assert.match(card, /<PhoneSignPanel onStrokes=\{\(next\) => \{ setStrokes\(next\); setTab\('draw'\); \}\} \/>/);
  const main = read('../src/main.jsx');
  assert.match(main, /import\('\.\/home\/PhoneSignPage'\)/);
  assert.match(read('../src/home/PhoneSignPage.jsx'), /import SignaturePad from '\.\.\/signature\/SignaturePad\.jsx';/);
});
