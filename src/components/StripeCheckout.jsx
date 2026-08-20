/**
 * StripeCheckout.jsx — subscription checkout button.
 *
 * Default export StripeCheckout: a button that invokes the Supabase
 * `create-checkout-session` edge function with the requested tier/billingPeriod,
 * then opens the returned Stripe URL via window.electronAPI.openExternal (or
 * window.open as a web fallback). Tracks loading/error state inline.
 */
import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { buildBillingReturnUrl, openDeferredExternalDestination } from '../utils/accountPlatform';

const StripeCheckout = (props) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubscribe = async () => {
        setLoading(true);
        setError(null);
        // Claim the tab inside the click gesture — a tab opened after the
        // await gets popup-blocked. See openDeferredExternalDestination.
        const tab = openDeferredExternalDestination();
        try {
            // Pass tier and billing period to checkout session
            const { data, error } = await supabase.functions.invoke('create-checkout-session', {
                body: {
                    tier: props.tier || 'pro',
                    billingPeriod: props.billingPeriod || 'monthly',
                    returnUrl: buildBillingReturnUrl(),
                }
            });

            if (error) {
                throw error;
            }

            if (data?.error) {
                throw new Error(data.error);
            }

            if (data?.url) {
                await tab.navigate(data.url);
            } else {
                throw new Error('No checkout URL returned');
            }
        } catch (err) {
            tab.cancel();
            console.error('Payment Error:', err);
            setError(err.message || 'An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <button
                onClick={handleSubscribe}
                disabled={loading}
                className={props.className || 'px-4 py-2 bg-blue-600 text-white rounded'}
            >
                {loading ? 'Processing...' : (props.children || 'Subscribe now')}
            </button>
            {error && (
                <div style={{ color: 'red', marginTop: '8px', fontSize: '13px' }}>
                    Error: {error}
                </div>
            )}
        </>
    );
};

export default StripeCheckout;
