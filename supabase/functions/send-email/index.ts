import { Resend } from 'https://esm.sh/resend@2.0.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

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

        // Email templates
        const templates = {
            'trial-ending': (data: any) => `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #3b82f6;">Your Trial is Ending Soon</h2>
                    <p>Hi${data.firstName ? ' ' + data.firstName : ''},</p>
                    <p>Your Pro trial will end in <strong>${data.daysLeft} days</strong> on ${data.trialEndDate}.</p>
                    <p>To continue enjoying all Pro features, no action is needed - your subscription will automatically start at $9.99/month.</p>
                    <p><strong>Want to cancel?</strong> You can do so anytime before ${data.trialEndDate} with no charge.</p>
                    <div style="margin: 30px 0;">
                        <a href="${data.portalUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                            Manage Subscription
                        </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">
                        Questions? Reply to this email for support.
                    </p>
                </div>
            `,

            'payment-failed': (data: any) => `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #ef4444;">Payment Failed</h2>
                    <p>Hi${data.firstName ? ' ' + data.firstName : ''},</p>
                    <p>We were unable to process your payment for your Pro subscription ($9.99/month).</p>
                    <p><strong>What happens now?</strong></p>
                    <ul>
                        <li>Your subscription is currently <strong>past due</strong></li>
                        <li>We'll retry the payment in a few days</li>
                        <li>If payment fails again, your subscription may be canceled</li>
                    </ul>
                    <div style="margin: 30px 0;">
                        <a href="${data.portalUrl}" style="background: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                            Update Payment Method
                        </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">
                        Questions? Reply to this email for support.
                    </p>
                </div>
            `,

            'subscription-canceled': (data: any) => `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #666;">Subscription Canceled</h2>
                    <p>Hi${data.firstName ? ' ' + data.firstName : ''},</p>
                    <p>Your Pro subscription has been canceled as requested.</p>
                    <p><strong>What's next?</strong></p>
                    <ul>
                        <li>You've been moved to the Free plan</li>
                        <li>Your data is safe and secure</li>
                        <li>You can reactivate anytime from Account Settings in the app</li>
                    </ul>
                    <p>We're sorry to see you go! If there's anything we could have done better, please let us know by replying to this email.</p>
                    <p style="color: #666; font-size: 14px; margin-top: 30px;">
                        Want to come back? Open Survey and go to Account Settings → Manage Subscription to reactivate.
                    </p>
                </div>
            `,

            'payment-succeeded': (data: any) => `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #22c55e;">Payment Received</h2>
                    <p>Hi${data.firstName ? ' ' + data.firstName : ''},</p>
                    <p>Thank you! Your payment of <strong>$${data.amount}</strong> has been received.</p>
                    <p><strong>Subscription Details:</strong></p>
                    <ul>
                        <li>Plan: ${data.planName}</li>
                        <li>Amount: $${data.amount}</li>
                        <li>Next billing date: ${data.nextBillingDate}</li>
                    </ul>
                    <div style="margin: 30px 0;">
                        <a href="${data.portalUrl}" style="background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                            View Receipt
                        </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">
                        Questions about your billing? Contact us at support@yourcompany.com
                    </p>
                </div>
            `,

            // ==============================================================
            // KAL-31 sharing templates.
            // ==============================================================

            'document-invite': (data: any) => `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #d8a84e;">You're invited to ${data.documentName || 'a document'}</h2>
                    <p>Hi,</p>
                    <p><strong>${data.inviterName || 'A Survey user'}</strong> invited you to join <strong>${data.documentName || 'a document'}</strong> as <strong>${data.role || 'Viewer'}</strong> on Survey.</p>
                    <div style="margin: 30px 0;">
                        <a href="${data.inviteUrl}" style="background: #d8a84e; color: #15110a; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
                            Open invite
                        </a>
                    </div>
                    <p style="color: #666; font-size: 13px;">This invite expires on ${data.expiresAt || '7 days from now'}.</p>
                    <p style="color: #666; font-size: 13px;">If the button doesn't work, copy and paste this link:<br/><span style="font-family: monospace; word-break: break-all;">${data.inviteUrl}</span></p>
                    <p style="color: #999; font-size: 12px; margin-top: 30px;">If you weren't expecting this invite, you can safely ignore this email.</p>
                </div>
            `,

            'permission-changed': (data: any) => `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #3b82f6;">Your access changed on ${data.documentName || 'a document'}</h2>
                    <p>Hi,</p>
                    <p><strong>${data.changedByName || 'An owner'}</strong> changed your access to <strong>${data.documentName || 'a document'}</strong>.</p>
                    <p>Your new role is: <strong>${data.newRole || 'Viewer'}</strong>${data.oldRole ? ' (was <strong>' + data.oldRole + '</strong>)' : ''}.</p>
                    <div style="margin: 30px 0;">
                        <a href="${data.documentUrl || data.appUrl || '#'}" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
                            Open ${data.documentName || 'document'}
                        </a>
                    </div>
                    <p style="color: #666; font-size: 13px;">Permission changes apply immediately. If you have unsaved changes, they may be blocked from saving after a downgrade.</p>
                </div>
            `,

            'access-removed': (data: any) => `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #cf6f6f;">Your access to ${data.documentName || 'a document'} was removed</h2>
                    <p>Hi,</p>
                    <p><strong>${data.removedByName || 'An owner'}</strong> removed your access to <strong>${data.documentName || 'a document'}</strong> on Survey.</p>
                    <p>You can no longer open, view, or edit this item. If you believe this was a mistake, contact the owner directly.</p>
                    <p style="color: #666; font-size: 12px; margin-top: 30px;">This is an automated notification. Please do not reply.</p>
                </div>
            `,
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

        const result = await resend.emails.send({
            // SEND_EMAIL_FROM must be on a Resend-verified domain for real
            // recipients; the sandbox default only delivers to the account owner.
            from: Deno.env.get('SEND_EMAIL_FROM') || 'Survey <onboarding@resend.dev>',
            to: [to],
            subject: subject,
            html: html,
        });

        console.log('Email sent successfully!');
        console.log('Resend Response:', JSON.stringify(result, null, 2));
        console.log('Email ID:', result.data?.id);
        console.log('To:', to);
        console.log('Subject:', subject);

        return new Response(
            JSON.stringify({ success: true, id: result.data?.id }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        );
    } catch (error) {
        console.error('Error sending email:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            }
        );
    }
});
