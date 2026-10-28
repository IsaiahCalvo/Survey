// Guest links (Nightly, flag 'guest-links'): the small client helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanGuestName, guestLinkEnds, guestLinkUrl, guestTokenFrom, GUEST_NAME_MAX } from '../src/services/guestLinks.js';

const TOKEN = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';

test('the link carries its secret, and only a well-formed one is read back', () => {
  const url = guestLinkUrl(TOKEN, 'https://surveytool-nightly.vercel.app');
  assert.equal(url, `https://surveytool-nightly.vercel.app/?guest=${TOKEN}`);
  assert.equal(guestTokenFrom(url), TOKEN);
  assert.equal(guestTokenFrom('https://x.test/?guest=nope'), null);
  assert.equal(guestTokenFrom(`https://x.test/?guest=${TOKEN.toUpperCase()}`), null);
  assert.equal(guestTokenFrom('not a url'), null);
});

test('a guest name loses control characters, spaces at the ends, and length past the cap', () => {
  assert.equal(cleanGuestName('  Gus\u0000 Guest\n '), 'Gus Guest');
  assert.equal(cleanGuestName('x'.repeat(200)).length, GUEST_NAME_MAX);
  assert.equal(cleanGuestName(null), '');
});

test('how long a link has left reads plainly', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const at = (ms) => new Date(now + ms).toISOString();
  assert.equal(guestLinkEnds(at(-1000), now), 'Ended');
  assert.equal(guestLinkEnds(at(20 * 60e3), now), 'Ends within the hour');
  assert.equal(guestLinkEnds(at(3 * 3600e3), now), 'Ends in 3 hours');
  assert.equal(guestLinkEnds(at(26 * 3600e3), now), 'Ends tomorrow');
  assert.equal(guestLinkEnds(at(4 * 86400e3), now), 'Ends in 4 days');
  assert.match(guestLinkEnds(at(30 * 86400e3), now), /^Ends \w+ \d+$/);
});
