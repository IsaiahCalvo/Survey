import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

const StripeCheckout = (props) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubscribe = async () => {
        setLoading(true);
        setError(null);
        try {
            // Pass tier and billing period to checkout session
            const { data, error } = await supabase.functions.invoke('create-checkout-session', {
                body: {
                    tier: props.tier || 'pro',
                    billingPeriod: props.billingPeriod || 'monthly'
                }
            });

            if (error) {
                throw error;
            }

            if (data?.error) {
                throw new Error(data.error);
            }

            if (data?.url) {
                // Use Electron API if available, otherwise open in new tab (for web browser testing)
                if (window.electronAPI?.openExternal) {
                    await window.electronAPI.openExternal(data.url);
                } else {
                    // Fallback for web browser (non-Electron environment)
                    window.open(data.url, '_blank');
                }
            } else {
                throw new Error('No checkout URL returned');
            }
        } catch (err) {
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
                {loading ? 'Processing...' : (props.children || 'Subscribe Now')}
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
