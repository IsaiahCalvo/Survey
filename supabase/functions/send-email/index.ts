import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import {
    renderEmailLayout,
    emailButton,
    emailFileCard,
    emailDetailRows,
    EMAIL_DANGER,
    EMAIL_P_STYLE as P,
    EMAIL_MUTED_STYLE as MUTED,
    EMAIL_FINE_STYLE as FINE,
    EMAIL_LIST_STYLE as LIST,
} from '../_shared/emailLayout.ts';
import { resolveBrevoApiKey } from './config.ts';
import {
    authorizeUserSend,
    escapeLikePattern,
    pickBindingInviteRow,
    sanitizeSubject,
} from './policy.js';

// Transactional email via Brevo. Consolidated 2026-07-05 so the whole app uses
// ONE email service — Brevo also sends the Supabase Auth login/reset emails.
const BREVO_API_KEY = resolveBrevoApiKey(Deno.env.get('BREVO_API_KEY'));
const EMAIL_SENDER = { name: 'Survey', email: 'no-reply@surveytool.app' };
const BILLING_DELIVERY_TEMPLATES = new Set([
    'trial-ending', 'payment-failed', 'payment-succeeded',
    'subscription-canceled', 'subscription-cancel-scheduled',
]);
const DELIVERY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DELIVERY_DEADLINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

type CallerContext =
    | { type: 'service' }
    | { type: 'user'; authHeader: string }
    | null;

// Classify the caller before sending anything. Two legitimate callers exist:
//   1. The stripe-webhook function, which calls us with the service-role key
//      (trusted infrastructure — recipient/template are server-derived there).
//   2. The app / send-invite-email, calling with the signed-in user's JWT.
//      These go through the KAL-439 policy (template allowlist + recipient
//      binding + rate limit + free-tier invite gate) in ./policy.js.
// Anyone else (e.g. an anonymous request bearing only the public anon key) is
// rejected, so this function can't be driven as an open phishing/spam relay.
async function classifyCaller(req: Request): Promise<CallerContext> {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return null;

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return null;

    // Trusted server-to-server caller (stripe-webhook).
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (serviceKey && token === serviceKey) return { type: 'service' };

    // Otherwise require a real, signed-in user (not the anonymous public key).
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) return null;
    if (token === anonKey) return null;

    try {
        const supabase = createClient(supabaseUrl, anonKey);
        const { data: { user }, error } = await supabase.auth.getUser(token);
        return !error && user ? { type: 'user', authHeader } : null;
    } catch {
        return null;
    }
}

// Caller-scoped client: every binding lookup runs under the CALLER's own RLS
// authority (owner-select policies on *_invites, owner-visible rows on
// *_collaborators) — never the service role.
function callerScopedClient(authHeader: string) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    return createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

const INVITE_TABLES = ['document_invites', 'project_invites', 'template_invites'];
const COLLABORATOR_TABLES = ['document_collaborators', 'project_collaborators', 'template_collaborators'];

function policyDeps(authHeader: string) {
    const caller = callerScopedClient(authHeader);
    return {
        findInviteRowForRecipient: async (email: string) => {
            const pattern = escapeLikePattern(email);
            // Gather recent rows from ALL invite tables, then let the policy's
            // picker choose: a fresh (pending) row outranks stale ones no
            // matter which table or how old, so a stale revoked document
            // invite can never shadow a live project/template invite.
            const candidates: Array<{
                revokedAt: string | null;
                acceptedAt: string | null;
                expiresAt: string | null;
                createdAt: string | null;
            }> = [];
            for (const table of INVITE_TABLES) {
                const { data, error } = await caller
                    .from(table)
                    .select('revoked_at, accepted_at, expires_at, created_at')
                    .ilike('target_email', pattern)
                    .order('created_at', { ascending: false })
                    .limit(5);
                if (error || !data) continue;
                for (const row of data) {
                    candidates.push({
                        revokedAt: row.revoked_at ?? null,
                        acceptedAt: row.accepted_at ?? null,
                        expiresAt: row.expires_at ?? null,
                        createdAt: row.created_at ?? null,
                    });
                }
            }
            return pickBindingInviteRow(candidates);
        },
        findActiveCollaboratorForRecipient: async (email: string) => {
            const pattern = escapeLikePattern(email);
            for (const table of COLLABORATOR_TABLES) {
                const { data, error } = await caller
                    .from(table)
                    .select('id')
                    .ilike('email', pattern)
                    .eq('status', 'active')
                    .limit(1)
                    .maybeSingle();
                if (!error && data) return data;
            }
            return null;
        },
        claimSendBudget: async (template: string, recipient: string, isInvite: boolean) => {
            const { data, error } = await caller.rpc('claim_email_send', {
                p_template: template,
                p_recipient: recipient,
                p_is_invite: isInvite,
            });
            if (error) {
                console.error('[send-email] claim_email_send RPC failed:', error.message);
                return 'error';
            }
            return data;
        },
    };
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
    const caller = await classifyCaller(req);
    if (!caller) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        );
    }

    // Fail closed before parsing or attempting delivery. Never coerce a missing
    // secret into an invalid header and never log the secret value.
    if (!BREVO_API_KEY) {
        console.error('[send-email] BREVO_API_KEY is not configured');
        return new Response(
            JSON.stringify({ error: 'Email delivery is temporarily unavailable' }),
            {
                status: 503,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        );
    }

    try {
        const { to, subject, template, data, billingDeliveryKey, billingSendBefore } = await req.json();
        let billingDeadline = NaN;

        // Only the trusted billing outbox may supply a provider delivery key.
        // User sends retain their existing recipient and rate-limit policy.
        if (billingDeliveryKey !== undefined || billingSendBefore !== undefined) {
            billingDeadline = typeof billingSendBefore === 'string' ? Date.parse(billingSendBefore) : NaN;
            const allowed = caller.type === 'service' && BILLING_DELIVERY_TEMPLATES.has(template)
                && typeof billingDeliveryKey === 'string' && DELIVERY_KEY.test(billingDeliveryKey)
                && typeof billingSendBefore === 'string' && DELIVERY_DEADLINE.test(billingSendBefore)
                && Number.isFinite(billingDeadline);
            if (!allowed) {
                return new Response(JSON.stringify({ error: 'Invalid billing delivery key' }), {
                    status: caller.type === 'service' ? 400 : 403,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }
        }

        if (!to || !subject || !template) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: to, subject, template' }),
                {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            );
        }

        // KAL-439: user-JWT callers go through the full policy — template
        // allowlist, recipient binding (caller-scoped RLS), free-tier invite
        // gate, and the per-user rate limit. Service-role callers
        // (stripe-webhook) are trusted infrastructure and skip this.
        let recipient = String(to);
        if (caller.type === 'user') {
            const verdict = await authorizeUserSend(
                { template: String(template), to: String(to) },
                policyDeps(caller.authHeader),
            );
            if (!verdict.ok) {
                console.warn(`[send-email] rejected ${template} send: ${verdict.error}`);
                return new Response(
                    JSON.stringify({ error: verdict.error }),
                    {
                        status: verdict.status,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    }
                );
            }
            recipient = verdict.recipient;
        }
        const safeSubject = sanitizeSubject(subject, 'Notification from Survey');

        // Email templates. Every template renders through the shared branded
        // frame (supabase/functions/_shared/emailLayout.ts) — see
        // docs/design/email-style-guide.md. Reskins preserve each message's
        // information and links; copy is sentence case per the copy style guide.
        // Templates receive safeData below, so this record time is HTML-escaped
        // just like other billing text. Queued records are not live plan status.
        const billingRecord = (data: any) => typeof data.recordedAt === 'string' && data.recordedAt
            ? `<p style="${MUTED}" class="em-mut">Billing record from ${data.recordedAt}. Your current plan and payment status are in Survey.</p>`
            : '';
        const templates = {
            'trial-ending': (data: any) => renderEmailLayout({
                heading: data.recordedAt ? 'Trial ending notice' : 'Your trial is ending soon',
                preheader: `Your Survey trial ${data.recordedAt ? 'was due to end' : 'ends'} on ${data.trialEndDate}.`,
                footerReason: `You're receiving this because you have a Survey trial.`,
                bodyHtml:
                    billingRecord(data) +
                    `<p style="${P}">Hi${data.firstName ? ' ' + data.firstName : ''},</p>` +
                    `<p style="${P}">Your trial ${data.recordedAt ? 'was due to end' : 'will end'} in <strong>${data.daysLeft} days</strong> on ${data.trialEndDate}.</p>` +
                    `<p style="${P}">After the trial, your selected plan and its billing terms apply. Check your subscription settings for pricing and renewal details.</p>` +
                    `<p style="${P}"><strong>Want to make a change?</strong> ${data.recordedAt ? 'Review your current subscription settings.' : `Review or cancel your subscription before ${data.trialEndDate}.`}</p>` +
                    emailButton('Manage subscription', data.portalUrl) +
                    `<p style="${MUTED}" class="em-mut">Questions? Reply to this email for support.</p>`,
            }),

            'payment-failed': (data: any) => renderEmailLayout({
                heading: 'Payment failed',
                headingColor: EMAIL_DANGER,
                preheader: `We couldn't process your Survey subscription payment.`,
                footerReason: `You're receiving this because a payment on your Survey subscription failed.`,
                bodyHtml:
                    billingRecord(data) +
                    `<p style="${P}">Hi${data.firstName ? ' ' + data.firstName : ''},</p>` +
                    `<p style="${P}">We were unable to process a payment for your Survey subscription.</p>` +
                    `<p style="${P}"><strong>What happens now?</strong></p>` +
                    `<ul style="${LIST}">` +
                    `<li>Check your payment method and subscription status in Survey</li>` +
                    `<li>Your billing settings show any payment action needed</li>` +
                    `<li>Unresolved payment issues may affect your subscription</li>` +
                    `</ul>` +
                    emailButton('Update payment method', data.portalUrl) +
                    `<p style="${MUTED}" class="em-mut">Questions? Reply to this email for support.</p>`,
            }),

            // Sent the moment a user schedules a cancellation (owner-reported
            // 2026-08-30: cancelling produced no confirmation at all until the
            // plan actually lapsed weeks later). Distinct from
            // 'subscription-canceled', which fires when the plan really ends.
            'subscription-cancel-scheduled': (data: any) => renderEmailLayout({
                heading: 'Cancellation confirmed',
                preheader: `Your Survey subscription ${data.recordedAt ? 'was' : 'is'} scheduled to end on ${data.endDate || 'the end of your billing period'}.`,
                footerReason: `You're receiving this because you canceled your Survey subscription.`,
                bodyHtml:
                    billingRecord(data) +
                    `<p style="${P}">Hi${data.firstName ? ' ' + data.firstName : ''},</p>` +
                    `<p style="${P}">${data.recordedAt ? 'A cancellation was recorded. Automatic renewal was scheduled to stop.' : 'Your cancellation is scheduled. This subscription will not renew automatically.'}</p>` +
                    `<ul style="${LIST}">` +
                    `<li>Your subscription ${data.recordedAt ? 'was' : 'is'} scheduled to end on <strong>${data.endDate || 'the end of your current billing period'}</strong></li>` +
                    `<li>${data.recordedAt ? 'The record shows a planned move to the Free plan' : 'After that you move to the Free plan automatically'}</li>` +
                    `<li>Your stored files are retained; Free-plan limits may archive items</li>` +
                    `</ul>` +
                    emailButton('Manage subscription', data.portalUrl) +
                    `<p style="${MUTED}" class="em-mut">${data.recordedAt ? 'Check Account Settings for your current plan and available changes.' : `Changed your mind? You can resume your plan any time before ${data.endDate || 'it ends'} from Account Settings.`}</p>`,
            }),

            'subscription-canceled': (data: any) => renderEmailLayout({
                heading: 'Subscription canceled',
                preheader: data.recordedAt ? 'Your account moved to the Free plan at the time of this record.' : `You've been moved to the Free plan.`,
                footerReason: `You're receiving this because your Survey subscription changed.`,
                bodyHtml:
                    billingRecord(data) +
                    `<p style="${P}">Hi${data.firstName ? ' ' + data.firstName : ''},</p>` +
                    `<p style="${P}">Your Survey subscription has ended.</p>` +
                    `<p style="${P}"><strong>What's next?</strong></p>` +
                    `<ul style="${LIST}">` +
                    `<li>${data.recordedAt ? 'Your account moved to the Free plan at the time of this record' : "You've been moved to the Free plan"}</li>` +
                    `<li>Your data is safe and secure</li>` +
                    `<li>You can reactivate anytime from Account Settings in the app</li>` +
                    `</ul>` +
                    `<p style="${P}">We're sorry to see you go! If there's anything we could have done better, please let us know by replying to this email.</p>` +
                    `<p style="${MUTED}">Want to come back? Open Survey and go to Account Settings → Manage Subscription to reactivate.</p>`,
            }),

            'payment-succeeded': (data: any) => renderEmailLayout({
                heading: 'Thanks — payment received',
                preheader: `Your Survey payment was received.`,
                footerReason: `You're receiving this because a payment was made on your Survey subscription.`,
                bodyHtml:
                    billingRecord(data) +
                    `<p style="${P}">Hi${data.firstName ? ' ' + data.firstName : ''},</p>` +
                    `<p style="${P}">We received your payment. Here's your receipt.</p>` +
                    emailDetailRows([
                        ['Plan', String(data.planName || 'Survey subscription')],
                        ['Amount', `$${data.amount}`],
                        ['Invoice period end', String(data.periodEnd || data.nextBillingDate || '—')],
                    ]) +
                    emailButton('View billing', data.portalUrl) +
                    `<p style="${MUTED}" class="em-mut">Questions about your billing? Reply to this email for support.</p>`,
            }),

            // ==============================================================
            // KAL-31 sharing templates.
            // ==============================================================

            'document-invite': (data: any) => renderEmailLayout({
                heading: `${data.inviterName || 'A Survey user'} invited you to Survey`,
                preheader: 'Accept the invitation to see what has been shared with you.',
                footerReason: `You're receiving this because ${data.inviterName || 'a Survey user'} invited you to Survey.`,
                bodyHtml:
                    `<p style="${P}"><strong>${data.inviterName || 'A Survey user'}</strong> invited you to join <strong>${data.documentName || 'a document'}</strong> as <strong>${data.role || 'Viewer'}</strong> on Survey.</p>` +
                    emailFileCard(data.documentName || 'Shared document', `Invited by ${data.inviterName || 'a Survey user'}`) +
                    emailButton('Accept invitation', data.inviteUrl) +
                    `<p style="${MUTED}" class="em-mut">This invite expires on ${data.expiresAt || '7 days from now'}.</p>` +
                    `<p style="${FINE}" class="em-mut">If you weren't expecting this invite, you can safely ignore this email.</p>`,
            }),

            'document-shared': (data: any) => renderEmailLayout({
                heading: `${data.sharedByName || 'A Survey user'} shared a document with you`,
                preheader: 'Open it in Survey to see pages, markups, and survey data.',
                footerReason: `You're receiving this because ${data.sharedByName || 'a Survey user'} shared a document with this address.`,
                bodyHtml:
                    `<p style="${P}">You now have access to this document in Survey as <strong>${data.role || 'Viewer'}</strong>. Open it to view pages, markups, and the latest survey data.</p>` +
                    emailFileCard(data.documentName || 'Shared document', `Shared by ${data.sharedByName || 'a Survey user'}`) +
                    emailButton('Open document', data.documentUrl || data.appUrl || '#') +
                    `<p style="${MUTED}" class="em-mut">Access is already active; no invitation acceptance is required.</p>`,
            }),

            'permission-changed': (data: any) => renderEmailLayout({
                heading: 'Your access level changed',
                preheader: `${data.changedByName || 'An owner'} updated your access level.`,
                footerReason: `You're receiving this because your access on a shared document changed.`,
                bodyHtml:
                    `<p style="${P}"><strong>${data.changedByName || 'An owner'}</strong> changed your role on this document to <strong>${data.newRole || 'Viewer'}</strong>${data.oldRole ? ' (was <strong>' + data.oldRole + '</strong>)' : ''}.</p>` +
                    emailFileCard(data.documentName || 'Shared document', `Updated by ${data.changedByName || 'an owner'}`) +
                    emailButton('Open document', data.documentUrl || data.appUrl || '#') +
                    `<p style="${MUTED}" class="em-mut">Permission changes apply immediately. If you have unsaved changes, they may be blocked from saving after a downgrade.</p>`,
            }),

            'access-removed': (data: any) => renderEmailLayout({
                heading: 'Your access was removed',
                headingColor: EMAIL_DANGER,
                preheader: 'You no longer have access to this document.',
                footerReason: `You're receiving this because your access on a shared document changed.`,
                bodyHtml:
                    `<p style="${P}"><strong>${data.removedByName || 'An owner'}</strong> removed your access to the document below. If you think this is a mistake, ask them to share it with you again.</p>` +
                    emailFileCard(data.documentName || 'Shared document', `Access removed by ${data.removedByName || 'an owner'}`) +
                    `<p style="${FINE}" class="em-mut">This is an automated notification. Please do not reply.</p>`,
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

        console.log(`Sending ${template} email to ${recipient}`);

        const providerController = new AbortController();
        let providerTimer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          (async () => {
            // A delayed claim or edge request must not start a fresh send after
            // its lease/key window. Leave room for the whole provider deadline.
            if (billingDeliveryKey && Date.now() + 30_000 > billingDeadline) {
                throw Object.assign(new Error('Billing delivery window expired; request a fresh claim'), {
                    code: 'BILLING_SEND_WINDOW_EXPIRED',
                });
            }
            const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                signal: providerController.signal,
                headers: {
                    'api-key': BREVO_API_KEY,
                    'content-type': 'application/json',
                    'accept': 'application/json',
                },
                body: JSON.stringify({
                    sender: EMAIL_SENDER,
                    to: [{ email: recipient }],
                    subject: safeSubject,
                    htmlContent: html,
                    ...(billingDeliveryKey ? { headers: { idempotencyKey: billingDeliveryKey } } : {}),
                }),
            });

            if (!brevoRes.ok) {
                const errText = await brevoRes.text();
                if (providerController.signal.aborted) throw new Error('Brevo request timed out; delivery is unknown');
                let providerError;
                try { providerError = JSON.parse(errText); } catch { /* Not a confirmed duplicate. */ }
                // A generic duplicate_parameter can describe unrelated input.
                // Acknowledge only the explicit processed-key response for our
                // service-scoped key. This is not proof of inbox delivery.
                if (billingDeliveryKey && brevoRes.status === 400
                    && providerError?.code === 'duplicate_parameter'
                    && providerError?.message === 'Email for the idempotency key has already been processed') {
                    return { messageId: `duplicate:${billingDeliveryKey}` };
                }
                console.error('Brevo API error:', brevoRes.status, errText);
                throw new Error(`Brevo send failed (${brevoRes.status})`);
            }
            const providerResult = await brevoRes.json();
            if (providerController.signal.aborted) throw new Error('Brevo request timed out; delivery is unknown');
            if (typeof providerResult?.messageId !== 'string' || !providerResult.messageId.trim()) {
                throw new Error('Brevo did not return a message receipt; delivery is unknown');
            }
            return providerResult;
          })(),
          new Promise<never>((_resolve, reject) => {
            providerTimer = setTimeout(() => {
                providerController.abort();
                reject(new Error('Brevo request timed out; delivery is unknown'));
            }, 30_000);
          }),
        ]).finally(() => clearTimeout(providerTimer));

        console.log('Email sent successfully!');
        console.log('Brevo messageId:', result.messageId);
        console.log('To:', recipient);
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
        const expiredClaim = error && typeof error === 'object' && 'code' in error
            && error.code === 'BILLING_SEND_WINDOW_EXPIRED';
        return new Response(
            JSON.stringify({ error: message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: expiredClaim ? 503 : 500,
            }
        );
    }
});
