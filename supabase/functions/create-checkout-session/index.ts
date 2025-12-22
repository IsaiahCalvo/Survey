
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { Stripe } from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
        if (!secretKey) {
            throw new Error('STRIPE_SECRET_KEY is not set in environment variables.');
        }

        const stripe = new Stripe(secretKey, {
            apiVersion: '2023-10-16',
            httpClient: Stripe.createFetchHttpClient(),
        })

        // Parse request body if needed, but we seem to be using hardcoded price for now.
        // If we wanted to accept price from client: const { priceId } = await req.json();

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: 'price_1SRsPPJrmRKkLZPfiAwkHYT6',
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: 'https://example.com/success', // In future, use req.headers.get('origin') + '/success'
            cancel_url: 'https://example.com/cancel',
        })

        return new Response(
            JSON.stringify({ url: session.url }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        )
    } catch (error) {
        console.error('Error creating checkout session:', error);
        // Return 200 with error field so client can read the message without catching HTTP exception
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        )
    }
})
