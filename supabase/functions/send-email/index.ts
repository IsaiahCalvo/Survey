import { Resend } from 'https://esm.sh/resend@2.0.0';

const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
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
            `
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

        const html = getTemplate(data || {});

        console.log(`Sending ${template} email to ${to}`);

        const result = await resend.emails.send({
            from: 'Survey <onboarding@resend.dev>',
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
