// Generate the 13 Supabase Auth mailer templates in the shared email frame
// (style F, owner-approved 2026-08-12). Templates go to
// debug/email-templates-staged/ (real files, Go template vars intact) and are
// PATCHed to prod via the Management API — see docs/KAL-email-redesign.md.
// A --preview run also writes var-substituted previews for visual checks.
//
// Run: node scripts/gen-auth-email-templates.mjs [--preview <dir>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const layout = await import(
  new URL('../supabase/functions/_shared/emailLayout.ts', import.meta.url).href
);
const {
  renderEmailLayout, emailButton, emailCode,
  EMAIL_DANGER, EMAIL_P_STYLE: P, EMAIL_MUTED_STYLE: MUTED, EMAIL_FINE_STYLE: FINE,
} = layout;

const { SUITE_NAME, SUITE_ACCOUNT_NAME: ACCOUNT, SUITE_APPS_LINE } = await import(
  new URL('../src/suite/suiteName.js', import.meta.url).href
);
// These are account emails. One account signs in to all three apps, so they
// carry the suite's name, not Survey's (owner 2026-11-16, KAL-664). No icon
// and no link: the icon is Survey's own, and the suite has no home page yet.
const SUITE_BRAND = { name: SUITE_NAME, logoUrl: null, link: null };
const ONE_ACCOUNT = `It signs you in to ${SUITE_APPS_LINE}.`;

const IGNORE = (what) => `If you didn&#8217;t ${what}, you can safely ignore this email.`;
const NOT_YOU =
  `<p style="${MUTED}" class="em-mut"><strong>If this wasn&#8217;t you:</strong> reset your password immediately from the sign-in screen &#8212; someone may have access to your account.</p>`;

// Subjects are managed alongside contents so one PATCH sets both.
export const TEMPLATES = {
  confirmation: {
    subject: `Confirm your email for your ${ACCOUNT}`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: 'Confirm your email',
      preheader: 'One click and your account is ready.',
      footerReason: `You're receiving this because this address was used to create a ${ACCOUNT}.`,
      bodyHtml:
        `<p style="${P}">You&#8217;re almost in. Confirm this email address to finish creating your ${ACCOUNT}. ${ONE_ACCOUNT}</p>` +
        emailButton('Confirm email', '{{ .ConfirmationURL }}') +
        `<p style="${FINE}" class="em-mut">${IGNORE(`create a ${ACCOUNT}`)}</p>`,
    }),
  },
  invite: {
    subject: `You've been invited to ${SUITE_NAME}`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: `You&#8217;ve been invited to ${SUITE_NAME}`,
      preheader: 'Accept the invitation to create your account.',
      footerReason: `You're receiving this because someone invited this address to ${SUITE_NAME}.`,
      bodyHtml:
        `<p style="${P}">Accept the invitation to create your ${ACCOUNT} and see what&#8217;s been shared with you. ${ONE_ACCOUNT}</p>` +
        emailButton('Accept invitation', '{{ .ConfirmationURL }}') +
        `<p style="${FINE}" class="em-mut">${IGNORE('expect this invitation')}</p>`,
    }),
  },
  magic_link: {
    subject: `Your ${SUITE_NAME} sign-in link`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: `Sign in to your ${ACCOUNT}`,
      preheader: 'This link expires in one hour.',
      footerReason: `You're receiving this because a sign-in link was requested for this address.`,
      bodyHtml:
        `<p style="${P}">Use the button below to sign in. This link expires in one hour and can be used once.</p>` +
        emailButton('Sign in', '{{ .ConfirmationURL }}') +
        `<p style="${FINE}" class="em-mut">${IGNORE('request this link')}</p>`,
    }),
  },
  recovery: {
    subject: `Reset your ${SUITE_NAME} password`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: 'Reset your password',
      preheader: 'This link expires in one hour.',
      footerReason: `You're receiving this because a password reset was requested for this address.`,
      bodyHtml:
        `<p style="${P}">Choose a new password using the button below. This link expires in one hour. If you didn&#8217;t ask for this, you can safely ignore this email &#8212; your password won&#8217;t change.</p>` +
        emailButton('Reset password', '{{ .ConfirmationURL }}'),
    }),
  },
  email_change: {
    subject: `Confirm your new email for your ${ACCOUNT}`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: 'Confirm your email change',
      preheader: 'Approve the change to finish updating your sign-in email.',
      footerReason: `You're receiving this because an email change was requested on your ${ACCOUNT}.`,
      bodyHtml:
        `<p style="${P}">A request was made to change your ${SUITE_NAME} sign-in email from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong>. Confirm to complete the change.</p>` +
        emailButton('Confirm email change', '{{ .ConfirmationURL }}') +
        `<p style="${FINE}" class="em-mut">${IGNORE('request this change')}</p>`,
    }),
  },
  email_changed_notification: {
    subject: `Your ${SUITE_NAME} email address was changed`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: 'Your email address was changed',
      headingColor: EMAIL_DANGER,
      preheader: `If this wasn't you, secure your account now.`,
      footerReason: `You're receiving this because the sign-in email on your ${ACCOUNT} changed.`,
      bodyHtml:
        `<p style="${P}">The sign-in email on your ${ACCOUNT} was changed from <strong>{{ .OldEmail }}</strong> to <strong>{{ .Email }}</strong>. If you made this change, no action is needed.</p>` +
        NOT_YOU,
    }),
  },
  identity_linked_notification: {
    subject: `A new sign-in method was linked to your ${ACCOUNT}`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: 'A sign-in method was linked',
      headingColor: EMAIL_DANGER,
      preheader: `If this wasn't you, secure your account now.`,
      footerReason: `You're receiving this because the sign-in methods on your ${ACCOUNT} changed.`,
      bodyHtml:
        `<p style="${P}">A new <strong>{{ .Provider }}</strong> identity was linked to your ${ACCOUNT} (<strong>{{ .Email }}</strong>). If you made this change, no action is needed.</p>` +
        NOT_YOU,
    }),
  },
  identity_unlinked_notification: {
    subject: `A sign-in method was removed from your ${ACCOUNT}`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: 'A sign-in method was removed',
      headingColor: EMAIL_DANGER,
      preheader: `If this wasn't you, secure your account now.`,
      footerReason: `You're receiving this because the sign-in methods on your ${ACCOUNT} changed.`,
      bodyHtml:
        `<p style="${P}">A <strong>{{ .Provider }}</strong> identity was unlinked from your ${ACCOUNT} (<strong>{{ .Email }}</strong>). If you made this change, no action is needed.</p>` +
        NOT_YOU,
    }),
  },
  mfa_factor_enrolled_notification: {
    subject: `Two-factor authentication was added to your ${ACCOUNT}`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: 'Two-factor authentication added',
      headingColor: EMAIL_DANGER,
      preheader: `If this wasn't you, secure your account now.`,
      footerReason: `You're receiving this because the security settings on your ${ACCOUNT} changed.`,
      bodyHtml:
        `<p style="${P}">A new two-factor method (<strong>{{ .FactorType }}</strong>) was added to your ${ACCOUNT} (<strong>{{ .Email }}</strong>). If you made this change, no action is needed.</p>` +
        NOT_YOU,
    }),
  },
  mfa_factor_unenrolled_notification: {
    subject: `Two-factor authentication was removed from your ${ACCOUNT}`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: 'Two-factor authentication removed',
      headingColor: EMAIL_DANGER,
      preheader: `If this wasn't you, secure your account now.`,
      footerReason: `You're receiving this because the security settings on your ${ACCOUNT} changed.`,
      bodyHtml:
        `<p style="${P}">A two-factor method (<strong>{{ .FactorType }}</strong>) was removed from your ${ACCOUNT} (<strong>{{ .Email }}</strong>). If you made this change, no action is needed.</p>` +
        NOT_YOU,
    }),
  },
  password_changed_notification: {
    subject: `Your ${SUITE_NAME} password was changed`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: 'Your password was changed',
      headingColor: EMAIL_DANGER,
      preheader: `If this wasn't you, secure your account now.`,
      footerReason: `You're receiving this because the password on your ${ACCOUNT} changed.`,
      bodyHtml:
        `<p style="${P}">The password for your ${ACCOUNT} (<strong>{{ .Email }}</strong>) was just changed. If you made this change, no action is needed.</p>` +
        `<p style="${MUTED}" class="em-mut"><strong>If this wasn&#8217;t you:</strong> use &#8220;Forgot password&#8221; on the sign-in screen right away to take back control, and contact us at <strong>isaiahcalvo123@gmail.com</strong>.</p>`,
    }),
  },
  phone_changed_notification: {
    subject: `Your ${SUITE_NAME} phone number was changed`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: 'Your phone number was changed',
      headingColor: EMAIL_DANGER,
      preheader: `If this wasn't you, secure your account now.`,
      footerReason: `You're receiving this because the phone number on your ${ACCOUNT} changed.`,
      bodyHtml:
        `<p style="${P}">The phone number on your ${ACCOUNT} was changed from <strong>{{ .OldPhone }}</strong> to <strong>{{ .Phone }}</strong>. If you made this change, no action is needed.</p>` +
        NOT_YOU,
    }),
  },
  reauthentication: {
    subject: `Your ${SUITE_NAME} verification code`,
    html: renderEmailLayout({
      brand: SUITE_BRAND,
      heading: 'Confirm it&#8217;s you',
      preheader: 'Enter this code in the app to continue.',
      footerReason: `You're receiving this because a sensitive change on your ${ACCOUNT} needs verification.`,
      bodyHtml:
        `<p style="${P}">Enter this code in the app to confirm your identity and continue:</p>` +
        emailCode('{{ .Token }}') +
        `<p style="${FINE}" class="em-mut">${IGNORE('request a code')}</p>`,
    }),
  },
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagedDir = path.join(repoRoot, 'debug', 'email-templates-staged');
mkdirSync(stagedDir, { recursive: true });

for (const [key, t] of Object.entries(TEMPLATES)) {
  writeFileSync(path.join(stagedDir, `${key}.html`), t.html);
  writeFileSync(path.join(stagedDir, `${key}.subject.txt`), t.subject);
}
console.log(`staged ${Object.keys(TEMPLATES).length} templates -> ${stagedDir}`);

// Optional visual previews with dummy values substituted for Go vars.
const previewIdx = process.argv.indexOf('--preview');
if (previewIdx !== -1) {
  const previewDir = process.argv[previewIdx + 1];
  mkdirSync(previewDir, { recursive: true });
  const SUBS = {
    '{{ .ConfirmationURL }}': 'https://surveytool.app/auth/v1/verify?token=abc123',
    '{{ .Email }}': 'isaiah@rivertoncivil.com',
    '{{ .NewEmail }}': 'i.calvo@rivertoncivil.com',
    '{{ .OldEmail }}': 'old@rivertoncivil.com',
    '{{ .Provider }}': 'Microsoft',
    '{{ .FactorType }}': 'TOTP',
    '{{ .Phone }}': '+1 555 010 7788',
    '{{ .OldPhone }}': '+1 555 010 1122',
    '{{ .Token }}': '84921066',
  };
  for (const [key, t] of Object.entries(TEMPLATES)) {
    let html = t.html;
    for (const [k, v] of Object.entries(SUBS)) html = html.replaceAll(k, v);
    writeFileSync(path.join(previewDir, `auth-${key}.html`), html);
  }
  console.log(`previews -> ${previewDir}`);
}
