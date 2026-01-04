import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Client } from '@microsoft/microsoft-graph-client';
import { useAuth } from './AuthContext';
import { supabase, isSupabaseAvailable } from '../supabaseClient';

const MSGraphContext = createContext({});

// Microsoft Graph API scopes needed for OneDrive
const MICROSOFT_SCOPES = [
    'email',
    'offline_access', // Required to get refresh token
    'https://graph.microsoft.com/User.Read',
    'https://graph.microsoft.com/Files.ReadWrite.All',
    'https://graph.microsoft.com/Sites.ReadWrite.All',
];

export const useMSGraph = () => {
    const context = useContext(MSGraphContext);
    if (!context) {
        throw new Error('useMSGraph must be used within a MSGraphProvider');
    }
    return context;
};

export const MSGraphProvider = ({ children }) => {
    const { user, session } = useAuth();
    const [account, setAccount] = useState(null);
    const [graphClient, setGraphClient] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [connectionRestored, setConnectionRestored] = useState(false);
    const [needsReconnect, setNeedsReconnect] = useState(false);

    // Initialize Graph client with the provider token from Supabase session
    const initializeGraphClient = useCallback((accessToken) => {
        const client = Client.init({
            authProvider: (done) => {
                done(null, accessToken);
            }
        });
        setGraphClient(client);
        return client;
    }, []);

    // Check if user is connected to Microsoft via Supabase
    useEffect(() => {
        const checkMicrosoftConnection = async () => {
            setIsLoading(true);

            try {
                if (!session) {
                    setIsAuthenticated(false);
                    setAccount(null);
                    setGraphClient(null);
                    setConnectionRestored(true);
                    setIsLoading(false);
                    return;
                }

                // Check if the user authenticated with Azure/Microsoft
                const provider = session.user?.app_metadata?.provider;
                const providers = session.user?.app_metadata?.providers || [];

                // Check if Microsoft/Azure is one of the linked providers
                const isMicrosoftLinked = provider === 'azure' || providers.includes('azure');

                if (isMicrosoftLinked && session.provider_token) {
                    // User has Microsoft linked and we have a valid token
                    setAccount({
                        username: session.user.email,
                        name: session.user.user_metadata?.full_name || session.user.email,
                        homeAccountId: session.user.id,
                    });
                    setIsAuthenticated(true);
                    setNeedsReconnect(false);
                    initializeGraphClient(session.provider_token);
                } else if (isMicrosoftLinked && !session.provider_token) {
                    // Microsoft was linked but token expired - need to reconnect
                    setAccount({
                        username: session.user.email,
                        name: session.user.user_metadata?.full_name || session.user.email,
                        homeAccountId: session.user.id,
                    });
                    setIsAuthenticated(false);
                    setNeedsReconnect(true);
                } else {
                    // Microsoft not linked
                    setIsAuthenticated(false);
                    setAccount(null);
                }

                setConnectionRestored(true);
            } catch (err) {
                console.error('[Microsoft] Error checking connection:', err);
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        checkMicrosoftConnection();
    }, [session, initializeGraphClient]);

    // Listen for auth state changes to update Microsoft connection
    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                if (newSession?.provider_token) {
                    const provider = newSession.user?.app_metadata?.provider;
                    const providers = newSession.user?.app_metadata?.providers || [];

                    if (provider === 'azure' || providers.includes('azure')) {
                        setAccount({
                            username: newSession.user.email,
                            name: newSession.user.user_metadata?.full_name || newSession.user.email,
                            homeAccountId: newSession.user.id,
                        });
                        setIsAuthenticated(true);
                        setNeedsReconnect(false);
                        initializeGraphClient(newSession.provider_token);
                    }
                }
            } else if (event === 'SIGNED_OUT') {
                setAccount(null);
                setIsAuthenticated(false);
                setGraphClient(null);
            }
        });

        return () => subscription.unsubscribe();
    }, [initializeGraphClient]);

    // Persist connection metadata to Supabase (for UI purposes)
    const persistConnection = useCallback(async (accountInfo) => {
        if (!user || !isSupabaseAvailable()) return;

        try {
            const { error } = await supabase
                .from('connected_services')
                .upsert({
                    user_id: user.id,
                    service_name: 'microsoft',
                    is_connected: true,
                    account_id: accountInfo.homeAccountId,
                    account_email: accountInfo.username,
                    account_name: accountInfo.name,
                    connected_at: new Date().toISOString(),
                    last_used_at: new Date().toISOString(),
                }, { onConflict: 'user_id,service_name' });

            if (error) {
                console.error('[Microsoft] Failed to persist connection:', error.message);
            }
        } catch (err) {
            console.error('[Microsoft] Exception during persist:', err.message);
        }
    }, [user]);

    // Remove connection from Supabase
    const removeConnection = useCallback(async () => {
        if (!user || !isSupabaseAvailable()) return;

        try {
            await supabase
                .from('connected_services')
                .delete()
                .eq('user_id', user.id)
                .eq('service_name', 'microsoft');
        } catch (err) {
            // Silently fail
        }
    }, [user]);

    // Update last_used timestamp
    const updateLastUsed = useCallback(async () => {
        if (!user || !isSupabaseAvailable()) return;

        try {
            await supabase
                .from('connected_services')
                .update({ last_used_at: new Date().toISOString() })
                .eq('user_id', user.id)
                .eq('service_name', 'microsoft');
        } catch (err) {
            // Silently fail
        }
    }, [user]);

    const login = async () => {
        try {
            setError(null);

            // Determine redirect URL based on environment
            const isElectron = window.electronAPI?.openOAuthWindow !== undefined;
            const redirectTo = isElectron
                ? 'http://localhost:5173'
                : window.location.origin;

            // Use Supabase's linkIdentity to add Microsoft to existing account
            // Or signInWithOAuth if user wants to sign in with Microsoft
            const { data, error } = await supabase.auth.linkIdentity({
                provider: 'azure',
                options: {
                    redirectTo,
                    scopes: MICROSOFT_SCOPES.join(' '),
                    queryParams: {
                        prompt: 'select_account', // Always show account picker
                    },
                },
            });

            if (error) {
                // If linking fails (e.g., no existing session), try regular sign in
                if (error.message.includes('session')) {
                    const { data: signInData, error: signInError } = await supabase.auth.signInWithOAuth({
                        provider: 'azure',
                        options: {
                            redirectTo,
                            scopes: MICROSOFT_SCOPES.join(' '),
                            queryParams: {
                                prompt: 'select_account',
                            },
                        },
                    });

                    if (signInError) throw signInError;
                    return signInData;
                }
                throw error;
            }

            return data;
        } catch (err) {
            console.error('[Microsoft] Login failed:', err.message);
            setError(err.message);
            throw err;
        }
    };

    const logout = async () => {
        try {
            // Remove from connected_services table
            await removeConnection();

            // Unlink Microsoft identity from Supabase account
            // Note: This doesn't sign out from Supabase, just removes Microsoft link
            const { data: identities } = await supabase.auth.getUserIdentities();
            const azureIdentity = identities?.identities?.find(i => i.provider === 'azure');

            if (azureIdentity) {
                await supabase.auth.unlinkIdentity(azureIdentity);
            }

            // Clear state
            setAccount(null);
            setIsAuthenticated(false);
            setGraphClient(null);
            setNeedsReconnect(false);
        } catch (err) {
            console.error('[Microsoft] Logout failed:', err.message);
            setError(err.message);
        }
    };

    const value = {
        msalInstance: null, // Kept for backward compatibility
        account,
        graphClient,
        isAuthenticated,
        isLoading,
        error,
        login,
        logout,
        updateLastUsed,
        connectionRestored,
        needsReconnect,
    };

    return <MSGraphContext.Provider value={value}>{children}</MSGraphContext.Provider>;
};
