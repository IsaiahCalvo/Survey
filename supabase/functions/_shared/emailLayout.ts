/**
 * emailLayout.ts — the ONE branded frame for every Survey transactional email.
 *
 * Visual precedent (locked 2026-08-12, owner-approved "style F"; recoloured to
 * the suite's grey and coral 2026-11-17, KAL-663): white card on a light grey
 * canvas; left-aligned header of logo + spaced SURVEY wordmark; a 2px coral
 * rule dividing header from content; ink headline; muted body; optional file
 * card / detail rows; coral table-based button with a plain-URL fallback line;
 * centered footer stating the true reason the recipient got the email.
 * Dark mode is a first-class variant using the suite's dark set.
 *
 * Email-client constraints (non-negotiable):
 *   - table-based layout, ALL base styles inline (light mode is the base)
 *   - ONE <style> block exists solely for dark mode: @media
 *     (prefers-color-scheme: dark) + [data-ogsc]/[data-ogsb] (Outlook.com
 *     apps). Apple Mail/Outlook honor it; Gmail ignores it and auto-inverts
 *     the light design instead — the light palette is chosen to survive that
 *     (no huge pure-white flats besides the card, coral keeps contrast against
 *     both card colors, button text is re-declared on an inner <span>).
 *   - the button is a bgcolor'd <td> wrapping a padded <a> (Outlook desktop
 *     ignores padding/display on bare anchors)
 *   - the 2px divider is a height-attributed <td> with mso-line-height-rule
 *     (a div "height:2px" renders ~15px tall in Outlook)
 *   - wordmark is hardcoded uppercase (Outlook ignores text-transform)
 *   - hosted PNG logo with explicit width/height attributes; empty alt because
 *     the adjacent live-text wordmark already says "Survey" (screen readers
 *     would otherwise announce it twice)
 *   - system font stack; single-name web-safe fallbacks
 *
 * NOTE: this file uses only erasable TS syntax (type annotations, no enums or
 * namespaces) so the node test suite can import it directly via Node's native
 * type stripping — see tests/emailLayout.test.mjs.
 */

// ---------------------------------------------------------------------------
// Palette: the suite's one look, grey and coral (docs/suite/SUITE-RULES.md,
// "One colour set", KAL-663). Literal hexes on purpose: email HTML cannot
// reference CSS variables. Light is the inline base; the dark values are the
// suite's dark set, applied by the <style> block below.
// ---------------------------------------------------------------------------
export const EMAIL_CORAL = '#ba4f2c';         // coral (light): button, rule, badge
export const EMAIL_ON_CORAL = '#ffffff';      // on-coral (light): words on the button
export const EMAIL_DANGER = '#b42318';        // danger-text (light): alert headings
export const EMAIL_DANGER_DARK = '#f87171';   // danger-text (dark)
export const EMAIL_INK = '#131313';           // text: headline / strong text
export const EMAIL_BONE = '#f4f4f6';          // ground: canvas round the card
export const EMAIL_TEXT = '#4b4b4b';          // text-2: body
export const EMAIL_MUTED = '#666666';         // text-3: fine print (5.7:1 on white, 5.2:1 on ground)
export const EMAIL_BADGE = EMAIL_CORAL;       // file-type badge words on the white card
export const EMAIL_TILE = '#f5f5f5';          // raised: code block, file card, quote
export const EMAIL_LINE = '#ececec';          // line: rows inside the card
export const EMAIL_FRAME = '#d4d4d4';         // line-strong: card and tile frames
// Dark set
export const EMAIL_D_CORAL = '#e07a5e';
export const EMAIL_D_ON_CORAL = '#131315';
export const EMAIL_D_CANVAS = '#131315';
export const EMAIL_D_CARD = '#1c1c1e';
export const EMAIL_D_TILE = '#242426';
export const EMAIL_D_BORDER = '#3f3f43';
export const EMAIL_D_INK = '#e8e7e2';
export const EMAIL_D_TEXT = '#d2d1cc';
export const EMAIL_D_MUTED = '#9a9a97';
// Light structural colors
const CARD = '#ffffff';
const TILE = EMAIL_TILE;
const BORDER = EMAIL_FRAME;
const LINE = EMAIL_LINE;

export const EMAIL_LOGO_URL = 'https://surveytool.app/logo192.png';

// System font stack (email-safe).
export const EMAIL_FONT =
  "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Reusable inline-style fragments so every template writes identical text.
// (Dark-mode recolor happens via the frame's <style> block descendant rules.)
export const EMAIL_P_STYLE =
  `margin:0 0 14px;font-family:${EMAIL_FONT};font-size:14px;line-height:1.6;color:${EMAIL_TEXT};`;
export const EMAIL_MUTED_STYLE =
  `margin:18px 0 0;font-family:${EMAIL_FONT};font-size:13px;line-height:1.5;color:${EMAIL_MUTED};`;
export const EMAIL_FINE_STYLE =
  `margin:18px 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.5;color:${EMAIL_MUTED};`;
export const EMAIL_LIST_STYLE =
  `margin:0 0 14px;padding:0 0 0 20px;font-family:${EMAIL_FONT};font-size:14px;line-height:1.6;color:${EMAIL_TEXT};`;

/**
 * Bulletproof CTA button (coral, left-aligned) + plain-URL fallback line.
 * bgcolor on the td AND background on the a so Outlook desktop and webmail
 * both fill it; the inner <span> re-declares the text color so Gmail's
 * dark-mode auto-invert is less likely to flip it illegible.
 * `withFallback` (default true) appends "If the button doesn't work…" + the
 * visible URL — required on auth emails, harmless elsewhere.
 */
export function emailButton(label: string, url: string, withFallback: boolean = true): string {
  const fallback = withFallback
    ? `<p style="margin:14px 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.6;color:${EMAIL_MUTED};" class="em-mut">` +
      `If the button doesn&#8217;t work, copy and paste this link into your browser:<br>` +
      `<a href="${url}" target="_blank" style="color:${EMAIL_MUTED};text-decoration:underline;word-break:break-all;" class="em-mut">${url}</a></p>`
    : '';
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">` +
    `<tr><td bgcolor="${EMAIL_CORAL}" class="em-btn" style="border-radius:6px;background-color:${EMAIL_CORAL};">` +
    `<a href="${url}" target="_blank" class="em-btn" ` +
    `style="display:inline-block;padding:13px 32px;font-family:${EMAIL_FONT};font-size:14px;font-weight:600;` +
    `color:${EMAIL_ON_CORAL};text-decoration:none;border-radius:6px;background-color:${EMAIL_CORAL};">` +
    `<span style="color:${EMAIL_ON_CORAL};">${label}</span></a></td></tr></table>` +
    fallback
  );
}

/**
 * Big one-time-code block (reauthentication etc.). Mono, high-contrast,
 * selectable — no image, no button.
 */
export function emailCode(code: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">` +
    `<tr><td class="em-tile" style="background-color:${TILE};border:1px solid ${BORDER};border-radius:8px;padding:14px 22px;` +
    `font-family:'SF Mono', Menlo, Consolas, monospace;font-size:22px;font-weight:700;letter-spacing:4px;color:${EMAIL_INK};">` +
    `${code}</td></tr></table>`
  );
}

/**
 * The style-F file card: the shared/changed document as its own object — a
 * small extension badge, the file name, and a one-line meta ("Shared by …").
 * `ext` is the uppercase type label; parameterized so non-PDF artifacts
 * (Excel changesets etc.) don't ship with a wrong badge.
 */
export function emailFileCard(name: string, meta: string, ext: string = 'PDF'): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `class="em-tile" style="margin:24px 0 0;border:1px solid ${BORDER};border-radius:8px;background-color:${TILE};">` +
    `<tr><td style="padding:16px;width:44px;vertical-align:middle;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td class="em-card em-badge" width="44" height="52" style="width:44px;height:52px;background-color:${CARD};border:1px solid ${BORDER};border-radius:6px;` +
    `text-align:center;vertical-align:middle;font-family:${EMAIL_FONT};font-size:10px;font-weight:700;letter-spacing:0.5px;color:${EMAIL_BADGE};" ` +
    `>${ext}</td></tr></table></td>` +
    `<td style="padding:16px 16px 16px 14px;vertical-align:middle;">` +
    `<div class="em-ink" style="font-family:${EMAIL_FONT};font-size:15px;font-weight:600;color:${EMAIL_INK};">${name}</div>` +
    `<div class="em-mut" style="font-family:${EMAIL_FONT};font-size:12px;color:${EMAIL_MUTED};padding-top:4px;">${meta}</div>` +
    `</td></tr></table>`
  );
}

/** The inviter's own words, as a quote under their name. Both values must
 *  already be HTML-escaped; line breaks in the message become <br>. Empty
 *  message, nothing drawn. */
export function emailQuote(escapedName: string, escapedMessage: string): string {
  const text = String(escapedMessage || '').trim();
  if (!text) return '';
  return (
    `<div style="margin:20px 0 0;padding:12px 14px;border-left:3px solid ${BORDER};background-color:${TILE};border-radius:4px;">` +
    `<div class="em-mut" style="font-family:${EMAIL_FONT};font-size:12px;color:${EMAIL_MUTED};padding-bottom:6px;">Message from ${escapedName}</div>` +
    `<div class="em-ink" style="font-family:${EMAIL_FONT};font-size:14px;line-height:1.5;color:${EMAIL_INK};">${text.replace(/\n/g, '<br>')}</div>` +
    `</div>`
  );
}

/** Style-F detail rows (receipts etc.): label left, bold value right. */
export function emailDetailRows(rows: Array<[string, string]>): string {
  const trs = rows.map(([k, v]) =>
    `<tr><td class="em-mut em-bdr" style="padding:10px 0;font-family:${EMAIL_FONT};font-size:13px;color:${EMAIL_MUTED};border-bottom:1px solid ${LINE};">${k}</td>` +
    `<td class="em-ink em-bdr" style="padding:10px 0;font-family:${EMAIL_FONT};font-size:13px;font-weight:600;color:${EMAIL_INK};text-align:right;border-bottom:1px solid ${LINE};">${v}</td></tr>`
  ).join('');
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 0;border-collapse:collapse;">` +
    trs + `</table>`
  );
}

export interface EmailLayoutOptions {
  /** Sentence-case heading (see the copy style guide). */
  heading: string;
  /** Inner HTML — build it from the EMAIL_*_STYLE fragments and helpers above. */
  bodyHtml: string;
  /** EMAIL_INK (default) or EMAIL_DANGER for destructive/alert emails. */
  headingColor?: string;
  /** Hidden inbox preview text. */
  preheader?: string;
  /**
   * The true reason this recipient got this email, e.g. "You're receiving
   * this because Nathan Cole (nathan@…) shared a document with this address."
   * Never claim "activity on your account" to someone who has no account.
   */
  footerReason?: string;
  /**
   * Who the email is from. Left out, it is Survey. Account emails (sign-in,
   * confirm, reset) pass the suite's name, since one account signs in to
   * Survey, Walkthru and Plot. `logoUrl: null` shows the name with no icon;
   * `link: null` drops the footer link.
   */
  brand?: EmailBrand;
}

export interface EmailBrand {
  name: string;
  logoUrl?: string | null;
  link?: { href: string; label: string } | null;
}

const SURVEY_BRAND: Required<EmailBrand> = {
  name: 'Survey',
  logoUrl: EMAIL_LOGO_URL,
  link: { href: 'https://surveytool.app', label: 'surveytool.app' },
};

// Dark-mode stylesheet: base (light) styles are inline; these class/descendant
// rules flip the frame in clients that honor prefers-color-scheme (Apple Mail,
// Outlook apps). [data-ogsc]/[data-ogsb] mirror them for Outlook.com dark.
// Gmail ignores all of this and auto-inverts the light design — by design.
function darkModeStyle(headingDark: string): string {
  const rules = (sel: (s: string) => string) => [
    sel(`.em-canvas`) + `{background-color:${EMAIL_D_CANVAS} !important;}`,
    sel(`.em-card`) + `{background-color:${EMAIL_D_CARD} !important;border-color:${EMAIL_D_BORDER} !important;}`,
    sel(`.em-tile`) + `{background-color:${EMAIL_D_TILE} !important;border-color:${EMAIL_D_BORDER} !important;}`,
    sel(`.em-ink`) + `{color:${EMAIL_D_INK} !important;}`,
    sel(`.em-h1`) + `{color:${headingDark} !important;}`,
    sel(`.em-mut`) + `{color:${EMAIL_D_MUTED} !important;}`,
    sel(`.em-bdr`) + `{border-color:${EMAIL_D_BORDER} !important;}`,
    // Template-authored fragments carry inline light colors; recolor by tag.
    sel(`.em-main p`) + `,` + sel(`.em-main li`) + `{color:${EMAIL_D_TEXT} !important;}`,
    sel(`.em-main p.em-mut`) + `,` + sel(`.em-main a.em-mut`) + `{color:${EMAIL_D_MUTED} !important;}`,
    // The button takes the bright coral with dark words, as in the apps.
    sel(`.em-btn`) + `{background-color:${EMAIL_D_CORAL} !important;}`,
    sel(`.em-rule`) + `{background-color:${EMAIL_D_CORAL} !important;}`,
    sel(`.em-badge`) + `{color:${EMAIL_D_CORAL} !important;}`,
    sel(`.em-main a[href] span`) + `{color:${EMAIL_D_ON_CORAL} !important;}`,
  ].join('');
  return (
    `<style>` +
    `@media (prefers-color-scheme: dark){` + rules((s) => s) + `}` +
    rules((s) => `[data-ogsc] ${s}`) +
    `</style>`
  );
}

/** Wrap body content in the Survey email frame; returns a full HTML document. */
export function renderEmailLayout({ heading, bodyHtml, headingColor, preheader, footerReason, brand }: EmailLayoutOptions): string {
  const who = { ...SURVEY_BRAND, ...(brand || {}) };
  const logoCell = who.logoUrl
    ? `<td width="34" style="vertical-align:middle;">` +
      `<img src="${who.logoUrl}" alt="" width="30" height="30" style="display:block;border:0;border-radius:6px;"></td>`
    : '';
  const footerLink = who.link
    ? ` &#183; <a href="${who.link.href}" target="_blank" class="em-mut" style="color:${EMAIL_MUTED};text-decoration:underline;">${who.link.label}</a>`
    : '';
  const accent = headingColor || EMAIL_INK;
  const accentDark = headingColor === EMAIL_DANGER || headingColor === EMAIL_DANGER_DARK
    ? EMAIL_DANGER_DARK
    : EMAIL_D_INK;
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}${'&nbsp;&zwnj;'.repeat(30)}</div>`
    : '';
  const footerLine = footerReason
    ? `<br>${footerReason}`
    : '';
  return (
    `<!DOCTYPE html>` +
    `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">` +
    `<title>${who.name}</title>` + darkModeStyle(accentDark) + `</head>` +
    `<body class="em-canvas" style="margin:0;padding:0;background-color:${EMAIL_BONE};">` +
    preheaderHtml +
    // Full-width wrapper carries the canvas color (Gmail strips body styles).
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_BONE}" class="em-canvas" style="background-color:${EMAIL_BONE};">` +
    `<tr><td align="center" class="em-main" style="padding:36px 16px;">` +
    // The single card table — width 100%, max-width 600px, centered.
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ` +
    `class="em-card" style="width:100%;max-width:600px;background-color:${CARD};border:1px solid ${BORDER};border-radius:10px;">` +
    // Header: logo chip + hardcoded uppercase wordmark, left-aligned.
    `<tr><td style="padding:30px 40px 0;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    logoCell +
    `<td class="em-ink" style="vertical-align:middle;padding-left:${who.logoUrl ? 11 : 0}px;font-family:${EMAIL_FONT};font-size:13px;font-weight:600;letter-spacing:2.5px;color:${EMAIL_INK};">${who.name.toUpperCase()}</td>` +
    `</tr></table></td></tr>` +
    // The coral rule dividing header from content.
    `<tr><td style="padding:22px 40px 0;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>` +
    `<td height="2" bgcolor="${EMAIL_CORAL}" class="em-rule" style="height:2px;line-height:2px;font-size:2px;mso-line-height-rule:exactly;background-color:${EMAIL_CORAL};">&nbsp;</td>` +
    `</tr></table></td></tr>` +
    // Body.
    `<tr><td style="padding:28px 40px 38px;">` +
    `<h1 class="em-h1" style="margin:0 0 12px;font-family:${EMAIL_FONT};font-size:22px;line-height:1.3;font-weight:600;color:${accent};">${heading}</h1>` +
    bodyHtml +
    `</td></tr>` +
    `</table>` +
    // Footer (outside the card): sender identity + the true receipt reason.
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">` +
    `<tr><td class="em-mut" style="padding:20px 8px;font-family:${EMAIL_FONT};font-size:12px;line-height:1.6;color:${EMAIL_MUTED};text-align:center;">` +
    `Sent by ${who.name}` + footerLink +
    footerLine +
    `</td></tr></table>` +
    `</td></tr></table></body></html>`
  );
}
