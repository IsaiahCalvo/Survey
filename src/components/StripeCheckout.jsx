import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

const StripeCheckout = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubscribe = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error } = await supabase.functions.invoke('create-checkout-session');

            if (error) {
                throw error;
            }

            if (data?.url) {
                // Use the exposed IPC handler to open the URL in the default browser
                await window.electronAPI.openExternal(data.url);
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
        <div className="p-4 border rounded shadow-sm bg-white">
            <h3 className="text-lg font-semibold mb-2">Upgrade to Pro</h3>
            <p className="text-gray-600 mb-4">Unlock all premium features.</p>

            {error && (
                <div className="text-red-500 text-sm mb-3">
                    Error: {error}
                </div>
            )}

            <button
                onClick={handleSubscribe}
                disabled={loading}
                className={`px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors ${loading ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
            >
                {loading ? 'Processing...' : 'Subscribe Now'}
            </button>
        </div>
    );
};

export default StripeCheckout;
