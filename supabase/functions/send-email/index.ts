import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import {
    renderEmailLayout,
    emailButton,
    EMAIL_DANGER,
    EMAIL_P_STYLE as P,
    EMAIL_MUTED_STYLE as MUTED,
    EMAIL_FINE_STYLE as FINE,
    EMAIL_LIST_STYLE as LIST,
} from '../_shared/emailLayout.ts';

// Transactional email via Brevo. Consolidated 2026-07-05 so the whole app uses
// ONE email service — Brevo also sends the Supabase Auth login/reset emails.
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const EMAIL_SENDER = { name: 'Survey', email: 'no-reply@surveytool.app' };

// Authorize the caller before sending anything. Two legitimate callers exist:
//   1. The stripe-webhook function, which calls us with the service-role key.
//   2. The app, which calls us with the signed-in user's JWT (via functions.invoke).
// Anyone else (e.g. an anonymous request bearing only the public anon key) is
// rejected, so this function can't be driven as an open phishing/spam relay.
async function isAuthorizedCaller(req: Request): Promise<boolean> {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return false;

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return false;

    // Trusted server-to-server caller (stripe-webhook).
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (serviceKey && token === serviceKey) return true;

    // Otherwise require a real, signed-in user (not the anonymous public key).
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) return false;
    if (token === anonKey) return false;

    try {
        const supabase = createClient(supabaseUrl, anonKey);
        const { data: { user }, error } = await supabase.auth.getUser(token);
        return !error && !!user;
    } catch {
        return false;
    }
}

const corsHeaders = {
    // ⚠️ INTENTIONAL — do NOT tighten to an origin allowlist (false positive if an
    // audit flags it). Same bundle ships to web + Electron prod (file:// → Origin:
    // null) + Capacitor iOS/Android; an allowlist CORS-breaks email/Excel/payments
    // on desktop+mobile, and Electron would then need Origin:null allowed — the very
    // hole tightening tries to close. Bearer-token auth (not cookies) ⇒ '*' is
    // non-exploitable. Why: CLAUDE.md "DO NOT BREAK" + HANDOFF-post-launch-hardening.md
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // Reject unauthenticated callers before doing any work.
    if (!(await isAuthorizedCaller(req))) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        );
    }

    try {
        const { to, subject, template, data } = await req.json();

        if (!to || !subject || !template) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: to, subject, template' }),
                {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            );
        }

        // Email templates. Every template renders through the shared branded
        // frame (supabase/functions/_shared/emailLayout.ts) — see
        // docs/design/email-style-guide.md. Reskins preserve each message's
        // information and links; copy is sentence case per the copy style guide.
        const templates = {
            'trial-ending': (data: any) => renderEmailLayout({
                heading: 'Your trial is ending soon',
                bodyHtml:
                    `<p style="${P}">Hi${data.firstName ? ' ' + data.firstName : ''},</p>` +
                    `<p style="${P}">Your Pro trial will end in <strong>${data.daysLeft} days</strong> on ${data.trialEndDate}.</p>` +
                    `<p style="${P}">To continue enjoying all Pro features, no action is needed — your subscription will automatically start at $9.99/month.</p>` +
                    `<p style="${P}"><strong>Want to cancel?</strong> You can do so anytime before ${data.trialEndDate} with no charge.</p>` +
                    emailButton('Manage subscription', data.portalUrl) +
                    `<p style="${MUTED}">Questions? Reply to this email for support.</p>`,
            }),

            'payment-failed': (data: any) => renderEmailLayout({
                heading: 'Payment failed',
                headingColor: EMAIL_DANGER,
                bodyHtml:
                    `<p style="${P}">Hi${data.firstName ? ' ' + data.firstName : ''},</p>` +
                    `<p style="${P}">We were unable to process your payment for your Pro subscription ($9.99/month).</p>` +
                    `<p style="${P}"><strong>What happens now?</strong></p>` +
                    `<ul style="${LIST}">` +
                    `<li>Your subscription is currently <strong>past due</strong></li>` +
                    `<li>We'll retry the payment in a few days</li>` +
                    `<li>If payment fails again, your subscription may be canceled</li>` +
                    `</ul>` +
                    emailButton('Update payment method', data.portalUrl) +
                    `<p style="${MUTED}">Questions? Reply to this email for support.</p>`,
            }),

            'subscription-canceled': (data: any) => renderEmailLayout({
                heading: 'Subscription canceled',
                bodyHtml:
                    `<p style="${P}">Hi${data.firstName ? ' ' + data.firstName : ''},</p>` +
                    `<p style="${P}">Your Pro subscription has been canceled as requested.</p>` +
                    `<p style="${P}"><strong>What's next?</strong></p>` +
                    `<ul style="${LIST}">` +
                    `<li>You've been moved to the Free plan</li>` +
                    `<li>Your data is safe and secure</li>` +
                    `<li>You can reactivate anytime from Account Settings in the app</li>` +
                    `</ul>` +
                    `<p style="${P}">We're sorry to see you go! If there's anything we could have done better, please let us know by replying to this email.</p>` +
                    `<p style="${MUTED}">Want to come back? Open Survey and go to Account Settings → Manage Subscription to reactivate.</p>`,
            }),

            'payment-succeeded': (data: any) => renderEmailLayout({
                heading: 'Payment received',
                bodyHtml:
                    `<p style="${P}">Hi${data.firstName ? ' ' + data.firstName : ''},</p>` +
                    `<p style="${P}">Thank you! Your payment of <strong>$${data.amount}</strong> has been received.</p>` +
                    `<p style="${P}"><strong>Subscription details:</strong></p>` +
                    `<ul style="${LIST}">` +
                    `<li>Plan: ${data.planName}</li>` +
                    `<li>Amount: $${data.amount}</li>` +
                    `<li>Next billing date: ${data.nextBillingDate}</li>` +
                    `</ul>` +
                    emailButton('View receipt', data.portalUrl) +
                    `<p style="${MUTED}">Questions about your billing? Contact us at support@yourcompany.com</p>`,
            }),

            // ==============================================================
            // KAL-31 sharing templates.
            // ==============================================================

            'document-invite': (data: any) => renderEmailLayout({
                heading: `You're invited to ${data.documentName || 'a document'}`,
                bodyHtml:
                    `<p style="${P}">Hi,</p>` +
                    `<p style="${P}"><strong>${data.inviterName || 'A Survey user'}</strong> invited you to join <strong>${data.documentName || 'a document'}</strong> as <strong>${data.role || 'Viewer'}</strong> on Survey.</p>` +
                    emailButton('Open invite', data.inviteUrl) +
                    `<p style="${MUTED}">This invite expires on ${data.expiresAt || '7 days from now'}.</p>` +
                    `<p style="${MUTED}">If the button doesn't work, copy and paste this link:<br/><span style="font-family: monospace; word-break: break-all;">${data.inviteUrl}</span></p>` +
                    `<p style="${FINE}">If you weren't expecting this invite, you can safely ignore this email.</p>`,
            }),

            'document-shared': (data: any) => renderEmailLayout({
                heading: `${data.documentName || 'A document'} was shared with you`,
                bodyHtml:
                    `<p style="${P}">Hi,</p>` +
                    `<p style="${P}"><strong>${data.sharedByName || 'A Survey user'}</strong> shared <strong>${data.documentName || 'a document'}</strong> with you on Survey.</p>` +
                    `<p style="${P}">Your role is: <strong>${data.role || 'Viewer'}</strong>.</p>` +
                    emailButton(`Open ${data.documentName || 'document'}`, data.documentUrl || data.appUrl || '#') +
                    `<p style="${MUTED}">Access is already active; no invitation acceptance is required.</p>`,
            }),

            'permission-changed': (data: any) => renderEmailLayout({
                heading: `Your access changed on ${data.documentName || 'a document'}`,
                bodyHtml:
                    `<p style="${P}">Hi,</p>` +
                    `<p style="${P}"><strong>${data.changedByName || 'An owner'}</strong> changed your access to <strong>${data.documentName || 'a document'}</strong>.</p>` +
                    `<p style="${P}">Your new role is: <strong>${data.newRole || 'Viewer'}</strong>${data.oldRole ? ' (was <strong>' + data.oldRole + '</strong>)' : ''}.</p>` +
                    emailButton(`Open ${data.documentName || 'document'}`, data.documentUrl || data.appUrl || '#') +
                    `<p style="${MUTED}">Permission changes apply immediately. If you have unsaved changes, they may be blocked from saving after a downgrade.</p>`,
            }),

            'access-removed': (data: any) => renderEmailLayout({
                heading: `Your access to ${data.documentName || 'a document'} was removed`,
                headingColor: EMAIL_DANGER,
                bodyHtml:
                    `<p style="${P}">Hi,</p>` +
                    `<p style="${P}"><strong>${data.removedByName || 'An owner'}</strong> removed your access to <strong>${data.documentName || 'a document'}</strong> on Survey.</p>` +
                    `<p style="${P}">You can no longer open, view, or edit this item. If you believe this was a mistake, contact the owner directly.</p>` +
                    `<p style="${FINE}">This is an automated notification. Please do not reply.</p>`,
            }),
        };

        const getTemplate = templates[template as keyof typeof templates];
        if (!getTemplate) {
            return new Response(
                JSON.stringify({ error: `Unknown template: ${template}` }),
                {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            );
        }

        // SECURITY: user-controlled fields (display names, document/project/
        // template titles) are interpolated into the HTML email body, so escape
        // every string value before building the template to prevent HTML/link
        // injection in recipients' inboxes. URL fields must be http(s) or are
        // dropped to '#'.
        const escapeHtml = (v: unknown) => String(v ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const URL_FIELDS = new Set(['inviteUrl', 'documentUrl', 'portalUrl', 'appUrl']);
        const safeData: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(data || {})) {
            if (typeof val !== 'string') { safeData[k] = val; continue; }
            safeData[k] = URL_FIELDS.has(k)
                ? (/^https?:\/\//i.test(val) ? escapeHtml(val) : '#')
                : escapeHtml(val);
        }
        const html = getTemplate(safeData);

        console.log(`Sending ${template} email to ${to}`);

        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': BREVO_API_KEY,
                'content-type': 'application/json',
                'accept': 'application/json',
            },
            body: JSON.stringify({
                sender: EMAIL_SENDER,
                to: [{ email: to }],
                subject,
                htmlContent: html,
            }),
        });

        if (!brevoRes.ok) {
            const errText = await brevoRes.text();
            console.error('Brevo API error:', brevoRes.status, errText);
            throw new Error(`Brevo send failed (${brevoRes.status})`);
        }
        const result = await brevoRes.json();

        console.log('Email sent successfully!');
        console.log('Brevo messageId:', result.messageId);
        console.log('To:', to);
        console.log('Subject:', subject);

        return new Response(
            JSON.stringify({ success: true, id: result.messageId }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        );
    } catch (error) {
        console.error('Error sending email:', error);
        const message = error instanceof Error ? error.message : String(error);
        return new Response(
            JSON.stringify({ error: message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            }
        );
    }
});
