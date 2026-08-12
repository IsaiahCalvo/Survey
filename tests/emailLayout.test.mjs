// Frame invariants for the shared transactional-email layout
// (supabase/functions/_shared/emailLayout.ts, docs/design/email-style-guide.md).
//
// The layout file uses only erasable TS syntax (by design — see its header
// comment) so Node's native type stripping can import it directly. If this
// import ever fails, someone added non-erasable TS syntax (enum, namespace,
// parameter properties) to emailLayout.ts — revert that.
import test from 'node:test';
import assert from 'node:assert/strict';

async function loadLayout() {
  return import(new URL('../supabase/functions/_shared/emailLayout.ts', import.meta.url).href);
}

test('emailLayout frame invariants', async () => {
  const { renderEmailLayout, emailButton, emailFileCard, EMAIL_LOGO_URL } = await loadLayout();

  // Render a representative template through the shared layout, the way
  // send-email's document-shared template does.
  const html = renderEmailLayout({
    heading: 'Alex shared a document with you',
    preheader: 'Open it in Survey.',
    footerReason: "You're receiving this because Alex shared a document with this address.",
    bodyHtml:
      '<p>Alex shared <strong>Site Plan.pdf</strong> with you on Survey.</p>' +
      emailFileCard('Site Plan.pdf', 'Shared by Alex') +
      emailButton('Open document', 'https://surveytool.app/doc/123'),
  });

  // Logo: absolute hosted URL, explicit dimensions, EMPTY alt (the live-text
  // wordmark beside it already says "Survey"; non-empty alt would read twice).
  assert.equal(EMAIL_LOGO_URL, 'https://surveytool.app/logo192.png');
  assert.ok(html.includes('src="https://surveytool.app/logo192.png"'), 'logo img src');
  assert.ok(/img [^>]*alt=""[^>]*width="30" height="30"/.test(html), 'logo alt + attribute dimensions');
  assert.ok(html.includes('>SURVEY<'), 'hardcoded uppercase wordmark (Outlook ignores text-transform)');

  // Gold accent present (divider + button background).
  assert.ok(html.includes('#d8a84e'), 'gold accent');

  // Card + footer tables, both capped at 600px, table-based layout.
  assert.equal(html.split('max-width:600px').length - 1, 2, 'card + footer 600px tables');
  assert.ok(html.includes('<table'), 'table-based layout');

  // Dark mode: exactly one <style> block (dark overrides ONLY — base styles
  // stay inline), plus the color-scheme metas dark-capable clients require.
  assert.equal(html.split('<style').length - 1, 1, 'single style block');
  assert.ok(html.includes('@media (prefers-color-scheme: dark)'), 'dark-mode media query');
  assert.ok(html.includes('[data-ogsc]'), 'Outlook.com dark selectors');
  assert.ok(html.includes('name="color-scheme" content="light dark"'), 'color-scheme meta');
  assert.ok(html.includes('name="supported-color-schemes"'), 'supported-color-schemes meta');

  // Bulletproof button: bgcolor'd td + padded link, never a <button> element,
  // text color re-declared on an inner span (Gmail dark-mode armor).
  assert.ok(!html.includes('<button'), 'no <button> element');
  assert.ok(/<td bgcolor="#d8a84e"[^>]*><a href="https:\/\/surveytool\.app\/doc\/123"/.test(html),
    'CTA is a gold bgcolor td wrapping the link');
  assert.ok(/<a href="https:\/\/surveytool\.app\/doc\/123"[^>]*background-color:#d8a84e[^>]*><span style="color:#15110a;">/.test(html),
    'button link carries background + span-redeclared text color');

  // Plain-URL fallback under the button (auth emails need it; all get it).
  assert.ok(html.includes('copy and paste this link'), 'plain-URL fallback line');

  // The divider is a height-attributed td (a styled div renders ~15px in Outlook).
  assert.ok(/<td height="2" bgcolor="#d8a84e"[^>]*mso-line-height-rule:exactly/.test(html),
    'gold divider is an Outlook-safe td');

  // Body content, heading, file card, and footer reason all made it in.
  assert.ok(html.includes('Alex shared a document with you'), 'heading rendered');
  assert.ok(html.includes('<h1'), 'heading is a real h1');
  assert.ok(html.includes('Site Plan.pdf'), 'file card rendered');
  assert.ok(html.includes('Open document'), 'button label rendered');
  assert.ok(html.includes('because Alex shared a document'), 'footer reason rendered');

  // Preheader is present and hidden.
  assert.ok(/display:none[^>]*>Open it in Survey\./.test(html), 'hidden preheader');
});
