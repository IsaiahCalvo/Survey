/**
 * emailLayout.ts — the ONE branded frame for every Survey transactional email.
 *
 * Visual precedent (locked): the Supabase Auth confirmation / invite /
 * magic-link / recovery templates — gold #d8a84e button with #15110a text,
 * #b6904a headings, #1f2430 body text on a light surface, muted #666 fine
 * print, "Survey — surveytool.app" sign-off. This module wraps that exact
 * language in a reusable frame; see docs/design/email-style-guide.md.
 *
 * Email-client constraints (non-negotiable — clients strip <style> blocks and
 * choke on modern CSS):
 *   - table-based layout only, ALL styles inline
 *   - one card table, width 100% / max-width 600px, centered
 *   - the button is a padded <a> with a background color (never <button>)
 *   - system font stack; single-name web-safe fallbacks
 *   - must read fine with images blocked (the wordmark text carries the brand,
 *     the logo <img> has alt text) and in dark-mode clients (the header band
 *     is explicitly dark, the card surface explicitly light — nothing relies
 *     on a client-default white background)
 *
 * NOTE: this file uses only erasable TS syntax (type annotations, no enums or
 * namespaces) so the node test suite can import it directly via Node's native
 * type stripping — see tests/emailLayout.test.mjs.
 */

// Palette — mirrors docs/design/design.md tokens. Literal hexes on purpose:
// email HTML cannot reference CSS variables.
export const EMAIL_GOLD = '#d8a84e';          // --gold: primary action/accent
export const EMAIL_GOLD_SOFT = '#b6904a';     // --gold-soft: headings on light
export const EMAIL_DANGER = '#d95a56';        // --accent-red: destructive/alert headings
export const EMAIL_INK = '#1f2430';           // body text on light surface
export const EMAIL_INK_DEEP = '#12151c';      // --ink-800: header band
export const EMAIL_ON_GOLD = '#15110a';       // text on gold button
export const EMAIL_BONE = '#f4f1ea';          // --bone-100: page background / wordmark
export const EMAIL_MUTED = '#666666';         // secondary text
export const EMAIL_FAINT = '#999999';         // footer / fine print

export const EMAIL_LOGO_URL = 'https://surveytool.app/logo192.png';

// System font stack (email-safe).
export const EMAIL_FONT =
  "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Reusable inline-style fragments so every template writes identical text.
export const EMAIL_P_STYLE =
  `margin:0 0 14px;font-family:${EMAIL_FONT};font-size:14px;line-height:1.5;color:${EMAIL_INK};`;
export const EMAIL_MUTED_STYLE =
  `margin:18px 0 0;font-family:${EMAIL_FONT};font-size:13px;line-height:1.5;color:${EMAIL_MUTED};`;
export const EMAIL_FINE_STYLE =
  `margin:18px 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.5;color:${EMAIL_FAINT};`;
export const EMAIL_LIST_STYLE =
  `margin:0 0 14px;padding:0 0 0 20px;font-family:${EMAIL_FONT};font-size:14px;line-height:1.6;color:${EMAIL_INK};`;

/**
 * Bulletproof CTA button: a padded link styled as a button (background color
 * on both the td and the <a> so Outlook and webmail clients both fill it).
 * One primary button style app-wide — always gold, never per-template colors.
 */
export function emailButton(label: string, url: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;">` +
    `<tr><td style="border-radius:6px;background-color:${EMAIL_GOLD};">` +
    `<a href="${url}" target="_blank" ` +
    `style="display:inline-block;padding:12px 22px;font-family:${EMAIL_FONT};font-size:14px;font-weight:700;` +
    `color:${EMAIL_ON_GOLD};text-decoration:none;border-radius:6px;background-color:${EMAIL_GOLD};">` +
    `${label}</a></td></tr></table>`
  );
}

/**
 * Big one-time-code block (reauthentication etc.). Mono, high-contrast,
 * selectable — no image, no button.
 */
export function emailCode(code: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;">` +
    `<tr><td style="background-color:#f4f1ea;border:1px solid #e3ddd0;border-radius:6px;padding:14px 22px;` +
    `font-family:'SF Mono', Menlo, Consolas, monospace;font-size:22px;font-weight:700;letter-spacing:4px;color:${EMAIL_INK};">` +
    `${code}</td></tr></table>`
  );
}

export interface EmailLayoutOptions {
  /** Sentence-case heading (see the copy style guide). */
  heading: string;
  /** Inner HTML — build it from the EMAIL_*_STYLE fragments and emailButton. */
  bodyHtml: string;
  /** EMAIL_GOLD_SOFT (default) or EMAIL_DANGER for destructive/alert emails. */
  headingColor?: string;
  /** Hidden inbox preview text. */
  preheader?: string;
}

/** Wrap body content in the Survey email frame; returns a full HTML document. */
export function renderEmailLayout({ heading, bodyHtml, headingColor, preheader }: EmailLayoutOptions): string {
  const accent = headingColor || EMAIL_GOLD_SOFT;
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>`
    : '';
  return (
    `<!DOCTYPE html>` +
    `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Survey</title></head>` +
    `<body style="margin:0;padding:0;background-color:${EMAIL_BONE};">` +
    preheaderHtml +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${EMAIL_BONE};">` +
    `<tr><td align="center" style="padding:28px 12px;">` +
    // The single card table — width 100%, max-width 600px, centered.
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e3ddd0;border-radius:10px;">` +
    // Header band: dark ink surface + logo + wordmark (brand survives blocked images via alt + text).
    `<tr><td style="background-color:${EMAIL_INK_DEEP};padding:18px 32px;border-radius:10px 10px 0 0;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    // The hosted logo is a dark ink glyph on transparency — seat it on a gold
    // chip so it reads on the dark header band (and in dark-mode clients).
    `<td style="vertical-align:middle;background-color:${EMAIL_GOLD};border-radius:8px;padding:4px;">` +
    `<img src="${EMAIL_LOGO_URL}" alt="Survey" width="28" height="28" style="display:block;border:0;"></td>` +
    `<td style="vertical-align:middle;padding-left:12px;font-family:${EMAIL_FONT};font-size:18px;font-weight:700;letter-spacing:0;color:${EMAIL_BONE};">Survey</td>` +
    `</tr></table></td></tr>` +
    // Body.
    `<tr><td style="padding:28px 32px 30px;">` +
    `<h2 style="margin:0 0 14px;font-family:${EMAIL_FONT};font-size:20px;line-height:1.3;font-weight:700;color:${accent};">${heading}</h2>` +
    bodyHtml +
    `</td></tr>` +
    // Footer — matches the auth templates' sign-off.
    `<tr><td style="background-color:#faf8f2;border-top:1px solid #e3ddd0;border-radius:0 0 10px 10px;padding:14px 32px;` +
    `font-family:${EMAIL_FONT};font-size:12px;line-height:1.5;color:${EMAIL_FAINT};">` +
    `Survey — <a href="https://surveytool.app" target="_blank" style="color:${EMAIL_GOLD_SOFT};text-decoration:none;">surveytool.app</a>` +
    `</td></tr>` +
    `</table>` +
    `</td></tr></table></body></html>`
  );
}
