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
  const { renderEmailLayout, emailButton, EMAIL_LOGO_URL } = await loadLayout();

  // Render a representative template through the shared layout, the way
  // send-email's document-shared template does.
  const html = renderEmailLayout({
    heading: 'Site Plan.pdf was shared with you',
    bodyHtml:
      '<p>Alex shared <strong>Site Plan.pdf</strong> with you on Survey.</p>' +
      emailButton('Open Site Plan.pdf', 'https://surveytool.app/doc/123'),
  });

  // Logo: absolute hosted URL with brand alt text (survives blocked images).
  assert.equal(EMAIL_LOGO_URL, 'https://surveytool.app/logo192.png');
  assert.ok(html.includes('src="https://surveytool.app/logo192.png"'), 'logo img src');
  assert.ok(html.includes('alt="Survey"'), 'logo alt text');

  // Gold accent present (button background).
  assert.ok(html.includes('#d8a84e'), 'gold accent');

  // Exactly one 600px card table, centered.
  assert.equal(html.split('max-width:600px').length - 1, 1, 'single 600px card table');
  assert.ok(html.includes('<table'), 'table-based layout');

  // All styles inline — clients strip stylesheets.
  assert.ok(!html.includes('<style'), 'no <style> block');

  // Bulletproof button: link styled as a button, never a <button> element.
  assert.ok(!html.includes('<button'), 'no <button> element');
  assert.ok(/<a href="https:\/\/surveytool\.app\/doc\/123"[^>]*background-color:#d8a84e/.test(html),
    'CTA is a gold background-filled link');

  // Body content and heading actually made it into the frame.
  assert.ok(html.includes('Site Plan.pdf was shared with you'), 'heading rendered');
  assert.ok(html.includes('Open Site Plan.pdf'), 'button label rendered');
});
