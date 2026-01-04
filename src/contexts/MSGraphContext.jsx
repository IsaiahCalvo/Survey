import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
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

// Azure app client ID
const AZURE_CLIENT_ID = '0da81a9e-2b05-46ee-b826-5efc5114c765';

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
    const tokenRef = useRef(null); // Store current access token

    // Initialize Graph client with a dynamic auth provider that uses current token
    const initializeGraphClient = useCallback((accessToken) => {
        tokenRef.current = accessToken;
        const client = Client.init({
            authProvider: (done) => {
                if (tokenRef.current) {
                    done(null, tokenRef.current);
                } else {
                    done(new Error('No access token available'), null);
                }
            }
        });
        setGraphClient(client);
        return client;
    }, []);

    // Store Microsoft tokens in Supabase database
    const storeTokens = useCallback(async (tokens, accountInfo) => {
        console.log('[Microsoft] storeTokens called:', {
            hasAccessToken: !!tokens.access_token,
            hasRefreshToken: !!tokens.refresh_token,
            accountEmail: accountInfo.email || accountInfo.username,
        });

        if (!user || !isSupabaseAvailable()) {
            console.log('[Microsoft] Cannot store tokens - no user or Supabase');
            return;
        }

        try {
            const { error } = await supabase
                .from('connected_services')
                .upsert({
                    user_id: user.id,
                    service_name: 'microsoft',
                    is_connected: true,
                    account_id: accountInfo.id || accountInfo.homeAccountId,
                    account_email: accountInfo.email || accountInfo.username,
                    account_name: accountInfo.name,
                    metadata: {
                        access_token: tokens.access_token,
                        refresh_token: tokens.refresh_token,
                        expires_at: tokens.expires_at || (Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600)),
                    },
                    connected_at: new Date().toISOString(),
                    last_used_at: new Date().toISOString(),
                }, { onConflict: 'user_id,service_name' });

            if (error) {
                console.error('[Microsoft] Failed to store tokens:', error.message, error);
            } else {
                console.log('[Microsoft] Tokens stored successfully in database');
            }
        } catch (err) {
            console.error('[Microsoft] Exception storing tokens:', err.message, err);
        }
    }, [user]);

    // Fetch stored tokens from Supabase database
    const fetchStoredTokens = useCallback(async () => {
        if (!user || !isSupabaseAvailable()) return null;

        try {
            const { data, error } = await supabase
                .from('connected_services')
                .select('*')
                .eq('user_id', user.id)
                .eq('service_name', 'microsoft')
                .maybeSingle();

            if (error || !data) return null;
            return data;
        } catch (err) {
            console.error('[Microsoft] Error fetching stored tokens:', err.message);
            return null;
        }
    }, [user]);

    // Refresh access token using refresh token
    const refreshAccessToken = useCallback(async (refreshToken) => {
        try {
            const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: AZURE_CLIENT_ID,
                    scope: MICROSOFT_SCOPES.join(' '),
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token',
                }).toString(),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error_description || 'Token refresh failed');
            }

            const tokens = await response.json();
            return {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token || refreshToken, // Use new refresh token if provided
                expires_in: tokens.expires_in,
                expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
            };
        } catch (err) {
            console.error('[Microsoft] Token refresh failed:', err.message);
            return null;
        }
    }, []);

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

    // Check and restore Microsoft connection on mount
    useEffect(() => {
        let isMounted = true;

        const restoreConnection = async () => {
            console.log('[Microsoft] restoreConnection called, user:', !!user, 'session:', !!session);

            if (!user) {
                console.log('[Microsoft] No user, skipping restore');
                setIsLoading(false);
                setConnectionRestored(true);
                return;
            }

            setIsLoading(true);

            try {
                // First check if we just came back from OAuth (provider_token available)
                console.log('[Microsoft] Checking session tokens:', {
                    hasProviderToken: !!session?.provider_token,
                    hasProviderRefreshToken: !!session?.provider_refresh_token,
                    provider: session?.user?.app_metadata?.provider,
                    providers: session?.user?.app_metadata?.providers,
                });

                if (session?.provider_token) {
                    console.log('[Microsoft] Found provider_token in session');
                    const providers = session.user?.app_metadata?.providers || [];
                    const isAzure = providers.includes('azure') || session.user?.app_metadata?.provider === 'azure';
                    console.log('[Microsoft] Is Azure provider?', isAzure);

                    if (isAzure) {
                        // Just completed OAuth - store the tokens
                        const accountInfo = {
                            id: session.user.id,
                            email: session.user.email,
                            name: session.user.user_metadata?.full_name || session.user.email,
                        };

                        console.log('[Microsoft] Storing tokens from OAuth...');
                        await storeTokens({
                            access_token: session.provider_token,
                            refresh_token: session.provider_refresh_token,
                            expires_in: 3600, // Default 1 hour
                        }, accountInfo);
                        console.log('[Microsoft] Tokens stored successfully');

                        if (isMounted) {
                            setAccount({
                                username: accountInfo.email,
                                name: accountInfo.name,
                                homeAccountId: accountInfo.id,
                            });
                            setIsAuthenticated(true);
                            setNeedsReconnect(false);
                            initializeGraphClient(session.provider_token);
                        }

                        setIsLoading(false);
                        setConnectionRestored(true);
                        return;
                    }
                }

                // Check for stored tokens in database
                console.log('[Microsoft] Checking for stored tokens in database...');
                const storedData = await fetchStoredTokens();
                console.log('[Microsoft] Stored data:', storedData ? {
                    is_connected: storedData.is_connected,
                    hasMetadata: !!storedData.metadata,
                    hasRefreshToken: !!storedData.metadata?.refresh_token
                } : null);

                if (!storedData || !storedData.is_connected || !storedData.metadata) {
                    // No stored connection
                    console.log('[Microsoft] No valid stored connection found');
                    if (isMounted) {
                        setIsAuthenticated(false);
                        setAccount(null);
                        setConnectionRestored(true);
                    }
                    setIsLoading(false);
                    return;
                }

                const { metadata, account_email, account_name, account_id } = storedData;
                const { access_token, refresh_token, expires_at } = metadata;

                console.log('[Microsoft] Found stored tokens, refresh_token exists:', !!refresh_token);

                if (!refresh_token) {
                    // No refresh token - need to reconnect
                    console.log('[Microsoft] No refresh token, needs reconnect');
                    if (isMounted) {
                        setNeedsReconnect(true);
                        setAccount({
                            username: account_email,
                            name: account_name,
                            homeAccountId: account_id,
                        });
                    }
                    setIsLoading(false);
                    setConnectionRestored(true);
                    return;
                }

                // Check if access token is still valid (with 5 min buffer)
                const now = Math.floor(Date.now() / 1000);
                let currentAccessToken = access_token;

                console.log('[Microsoft] Token expires_at:', expires_at, 'now:', now, 'expired:', expires_at < now + 300);

                if (!expires_at || expires_at < now + 300) {
                    // Token expired or expiring soon - refresh it
                    console.log('[Microsoft] Token expired, refreshing...');
                    const newTokens = await refreshAccessToken(refresh_token);

                    if (!newTokens) {
                        // Refresh failed - need to reconnect
                        console.log('[Microsoft] Token refresh failed, needs reconnect');
                        if (isMounted) {
                            setNeedsReconnect(true);
                            setAccount({
                                username: account_email,
                                name: account_name,
                                homeAccountId: account_id,
                            });
                        }
                        setIsLoading(false);
                        setConnectionRestored(true);
                        return;
                    }

                    console.log('[Microsoft] Token refreshed successfully');
                    currentAccessToken = newTokens.access_token;

                    // Update stored tokens
                    await storeTokens(newTokens, {
                        id: account_id,
                        email: account_email,
                        name: account_name,
                    });
                }

                // Successfully restored connection
                console.log('[Microsoft] Connection restored successfully');
                if (isMounted) {
                    setAccount({
                        username: account_email,
                        name: account_name,
                        homeAccountId: account_id,
                    });
                    setIsAuthenticated(true);
                    setNeedsReconnect(false);
                    initializeGraphClient(currentAccessToken);
                }
            } catch (err) {
                console.error('[Microsoft] Error restoring connection:', err);
                if (isMounted) {
                    setError(err.message);
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                    setConnectionRestored(true);
                }
            }
        };

        restoreConnection();

        return () => {
            isMounted = false;
        };
    }, [user, session, fetchStoredTokens, storeTokens, refreshAccessToken, initializeGraphClient]);

    // Periodic token refresh (every 30 minutes)
    useEffect(() => {
        if (!isAuthenticated || !user) return;

        const refreshInterval = setInterval(async () => {
            const storedData = await fetchStoredTokens();
            if (storedData?.metadata?.refresh_token) {
                const newTokens = await refreshAccessToken(storedData.metadata.refresh_token);
                if (newTokens) {
                    tokenRef.current = newTokens.access_token;
                    await storeTokens(newTokens, {
                        id: storedData.account_id,
                        email: storedData.account_email,
                        name: storedData.account_name,
                    });
                } else {
                    setNeedsReconnect(true);
                }
            }
        }, 30 * 60 * 1000); // 30 minutes

        return () => clearInterval(refreshInterval);
    }, [isAuthenticated, user, fetchStoredTokens, refreshAccessToken, storeTokens]);

    const login = async () => {
        try {
            setError(null);

            // Determine redirect URL based on environment
            const isElectron = window.electronAPI?.openOAuthWindow !== undefined;
            const redirectTo = isElectron
                ? 'http://localhost:5173'
                : window.location.origin;

            // Use Supabase's linkIdentity to add Microsoft to existing account
            const { data, error } = await supabase.auth.linkIdentity({
                provider: 'azure',
                options: {
                    redirectTo,
                    scopes: MICROSOFT_SCOPES.join(' '),
                    queryParams: {
                        prompt: 'select_account',
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
            // Remove tokens from database
            await removeConnection();

            // Try to unlink Microsoft identity from Supabase
            try {
                const { data: identities } = await supabase.auth.getUserIdentities();
                const azureIdentity = identities?.identities?.find(i => i.provider === 'azure');
                if (azureIdentity) {
                    await supabase.auth.unlinkIdentity(azureIdentity);
                }
            } catch (unlinkErr) {
                // Ignore unlink errors - the important part is removing stored tokens
                console.warn('[Microsoft] Could not unlink identity:', unlinkErr.message);
            }

            // Clear state
            setAccount(null);
            setIsAuthenticated(false);
            setGraphClient(null);
            setNeedsReconnect(false);
            tokenRef.current = null;
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
