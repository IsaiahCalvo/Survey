// Which Kal Voe plans does an email hold? (KAL-856)
//
// Called server-to-server by the other apps (Walkthru today), never from a
// browser: the caller proves itself with the shared key SUITE_ENTITLEMENT_KEY
// in the x-kalvoe-suite-key header, and passes the email of a signed-in user
// whose address its own sign-in has confirmed. Answers the apps that email
// holds. With action 'portal' it answers a Stripe billing page for that email
// instead, so the app can offer "Manage billing".
import Stripe from 'npm:stripe@20.4.1';
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { parseBody, s } from '../_shared/inputSchema.js';
import { ACTIVE_STATUSES, cleanEmail, sameSecret, suiteReturnUrl } from '../_shared/suitePlans.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

Deno.serve(async (req) => {
    // No browser calls this, so preflight gets no CORS headers; it answers
    // ok only so the release health check can see the function is up.
    if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
    if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

    const expected = Deno.env.get('SUITE_ENTITLEMENT_KEY') ?? '';
    if (!sameSecret(req.headers.get('x-kalvoe-suite-key') ?? '', expected)) {
        return json({ error: 'Not allowed.' }, 401);
    }

    try {
        const parsed = parseBody({
            email: s.string({ max: 254 }),
            action: s.enum(['status', 'portal'], { optional: true }),
            returnUrl: s.string({ max: 2048, optional: true }),
        }, await req.json().catch(() => ({})));
        if (!parsed.ok) return json({ error: parsed.error }, 400);
        const { email: rawEmail, action = 'status', returnUrl } = parsed.value as {
            email: string, action?: 'status' | 'portal', returnUrl?: string,
        };
        const email = cleanEmail(rawEmail);
        if (!email) return json({ error: 'Bad email.' }, 400);

        const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        });

        const { data: rows, error } = await supabase
            .from('suite_entitlements')
            .select('plan, status, current_period_end, cancel_at, stripe_customer_id')
            .eq('email', email)
            .order('current_period_end', { ascending: false, nullsFirst: false });
        if (error) throw error;

        const live = (rows ?? []).filter((r) => ACTIVE_STATUSES.includes(r.status));

        if (action === 'portal') {
            const customer = (live[0] ?? rows?.[0])?.stripe_customer_id;
            if (!customer) return json({ error: 'No plan for this email.' }, 404);
            const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
                apiVersion: '2026-02-25.clover',
                httpClient: Stripe.createFetchHttpClient(),
            });
            const portal = await stripe.billingPortal.sessions.create({
                customer,
                return_url: suiteReturnUrl(returnUrl),
            });
            return json({ url: portal.url });
        }

        const apps = new Set<string>();
        for (const r of live) {
            for (const app of r.plan === 'suite' ? ['survey', 'walkthru', 'plot'] : [r.plan]) apps.add(app);
        }
        return json({
            apps: [...apps].sort(),
            plans: live.map((r) => ({
                plan: r.plan,
                status: r.status,
                currentPeriodEnd: r.current_period_end,
                cancelAt: r.cancel_at,
            })),
        });
    } catch (error) {
        console.error('suite-entitlement failed:', error);
        return json({ error: 'Lookup failed.' }, 500);
    }
});
