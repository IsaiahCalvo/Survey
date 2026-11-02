// Launch polish 2026-11-02: on the iPhone walk the "Live sync is offline"
// notice stood ~250px tall over the top of the page, and the tool settings
// strip covered its heading. On a phone it is now one line and hangs under
// the strip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the live-sync notice has a one-line phone form', () => {
  const jsx = read('src/components/collab/StorageFailureBanner.jsx');
  assert.match(jsx, /PHONE_BRIEF_BY_CODE = \{\s*transport_offline: 'Trying to reconnect',/);
  assert.match(jsx, /'storage-banner storage-banner--brief'/);
  assert.match(jsx, /className="storage-banner__brief"/);
  const css = read('src/components/collab/StorageFailureBanner.css');
  assert.match(css, /\.storage-banner__brief \{ display: none; \}/, 'hidden off the phone');
  const phone = css.slice(css.lastIndexOf('@media screen and (max-width: 599px)'));
  assert.match(phone, /\.storage-banner--brief \{\s*flex-wrap: nowrap;/);
  assert.match(phone, /\.storage-banner--brief \.storage-banner__body,\s*\.storage-banner--brief \.storage-banner__secondary \{ display: none; \}/);
  assert.match(phone, /\.storage-banner--brief \.storage-banner__brief \{\s*display: block;/);
});

test('on a phone the notice hangs under the tool settings strip', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /if \(isMobileViewer\) \{\s*document\.querySelectorAll\('\.mobile-pdf-properties'\)/);
  assert.match(shell, /bannerTop = Math\.max\(bannerTop, rect\.bottom - 8\)/);
  assert.match(shell, /isMobileViewer \? subscribeViewerTopOverlays\(scheduleUpdate\) : null/);
});
