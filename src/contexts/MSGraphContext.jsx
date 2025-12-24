import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { PublicClientApplication } from '@azure/msal-browser';
import { Client } from '@microsoft/microsoft-graph-client';
import { msalConfig, loginRequest } from '../authConfig';
import { useAuth } from './AuthContext';
import { supabase, isSupabaseAvailable, isSchemaError, isConnectedServicesAvailable, setConnectedServicesAvailable } from '../supabaseClient';

const MSGraphContext = createContext({});

// Create singleton MSAL instance to prevent multiple initialization warnings
let msalInstanceSingleton = null;
const getMsalInstance = async () => {
    if (!msalInstanceSingleton) {
        msalInstanceSingleton = new PublicClientApplication(msalConfig);
        await msalInstanceSingleton.initialize();
    }
    return msalInstanceSingleton;
};

export const useMSGraph = () => {
    const context = useContext(MSGraphContext);
    if (!context) {
        throw new Error('useMSGraph must be used within a MSGraphProvider');
    }
    return context;
};

export const MSGraphProvider = ({ children }) => {
    const { user } = useAuth();
    const [msalInstance, setMsalInstance] = useState(null);
    const [account, setAccount] = useState(null);
    const [graphClient, setGraphClient] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [connectionRestored, setConnectionRestored] = useState(false);
    const [needsReconnect, setNeedsReconnect] = useState(false); // True when persisted but silent auth failed

    // Persist connection to Supabase
    const persistConnection = useCallback(async (msalAccount) => {
        if (!user) {
            console.warn('[Microsoft Persist] No user authenticated, skipping persist');
            return;
        }

        if (!isSupabaseAvailable()) {
            console.warn('[Microsoft Persist] Supabase not available, skipping persist');
            return;
        }

        try {
            const serviceData = {
                user_id: user.id,
                service_name: 'microsoft',
                is_connected: true,
                account_id: msalAccount.homeAccountId,
                account_email: msalAccount.username,
                account_name: msalAccount.name,
                metadata: {
                    tenantId: msalAccount.tenantId,
                    localAccountId: msalAccount.localAccountId,
                },
                connected_at: new Date().toISOString(),
                last_used_at: new Date().toISOString(),
            };

            console.log('[Microsoft Persist] Attempting to persist connection for:', msalAccount.username);

            const { data, error } = await supabase
                .from('connected_services')
                .upsert(serviceData, { onConflict: 'user_id,service_name' });

            if (error) {
                console.error('[Microsoft Persist] ❌ Failed to persist connection');
                console.error('[Microsoft Persist] Error code:', error.code);
                console.error('[Microsoft Persist] Error message:', error.message);
                console.error('[Microsoft Persist] Error details:', error.details);
                console.error('[Microsoft Persist] Full error:', error);
            } else {
                console.log('[Microsoft Persist] ✅ Successfully persisted to Supabase');
                console.log('[Microsoft Persist] Data:', data);
            }
        } catch (err) {
            console.error('[Microsoft Persist] ❌ Exception during persist:', err.message);
            console.error('[Microsoft Persist] Stack:', err.stack);
        }
    }, [user]);

    // Remove connection from Supabase
    const removeConnection = useCallback(async () => {
        if (!user || !isSupabaseAvailable()) return;

        try {
            const { error } = await supabase
                .from('connected_services')
                .delete()
                .eq('user_id', user.id)
                .eq('service_name', 'microsoft');

            if (error) {
                console.log('Could not remove connection (table not ready)');
            } else {
                console.log('Microsoft connection removed from Supabase');
            }
        } catch (err) {
            console.log('Could not remove connection');
        }
    }, [user]);

    // Fetch persisted connection from Supabase
    const fetchPersistedConnection = useCallback(async () => {
        if (!user || !isSupabaseAvailable()) return null;

        try {
            const { data, error } = await supabase
                .from('connected_services')
                .select('*')
                .eq('user_id', user.id)
                .eq('service_name', 'microsoft')
                .maybeSingle();

            if (error) {
                // Silently fail - table might not be ready
                return null;
            }

            return data;
        } catch (err) {
            // Silently fail - table might not be ready
            return null;
        }
    }, [user]);

    const initializeGraphClient = useCallback((pca, account) => {
        const client = Client.init({
            authProvider: async (done) => {
                try {
                    const response = await pca.acquireTokenSilent({
                        ...loginRequest,
                        account: account,
                        forceRefresh: false, // Use cached token if still valid
                    });
                    done(null, response.accessToken);
                } catch (error) {
                    console.error("[Microsoft Auth] Token acquisition failed for API call:", error.message);

                    // Try SSO silent before giving up (no popup)
                    try {
                        const ssoResponse = await pca.ssoSilent({
                            ...loginRequest,
                            loginHint: account.username,
                        });
                        done(null, ssoResponse.accessToken);
                    } catch (ssoError) {
                        console.error("[Microsoft Auth] SSO silent also failed:", ssoError.message);
                        // Don't show popup - set reconnect flag instead
                        setNeedsReconnect(true);
                        done(new Error("Authentication required. Please reconnect Microsoft account."), null);
                    }
                }
            }
        });
        setGraphClient(client);
    }, []);

    // Initialize MSAL and restore connection if persisted
    useEffect(() => {
        let isMounted = true;

        const initializeMsal = async () => {
            try {
                const pca = await getMsalInstance();

                if (!isMounted) return;
                setMsalInstance(pca);

                // Check for existing accounts in MSAL cache
                const accounts = pca.getAllAccounts();

                if (accounts.length > 0) {
                    // User has cached accounts, use the first one
                    if (!isMounted) return;
                    setAccount(accounts[0]);
                    setIsAuthenticated(true);
                    initializeGraphClient(pca, accounts[0]);

                    // Persist the connection if user is logged in
                    if (user) {
                        // Use direct Supabase call to avoid dependency on persistConnection
                        console.log('[Microsoft Init] User authenticated, persisting connection...');
                        try {
                            const { data, error } = await supabase
                                .from('connected_services')
                                .upsert({
                                    user_id: user.id,
                                    service_name: 'microsoft',
                                    is_connected: true,
                                    account_id: accounts[0].homeAccountId,
                                    account_email: accounts[0].username,
                                    account_name: accounts[0].name,
                                    metadata: {
                                        tenantId: accounts[0].tenantId,
                                        localAccountId: accounts[0].localAccountId,
                                    },
                                    last_used_at: new Date().toISOString(),
                                }, { onConflict: 'user_id,service_name' });

                            if (error) {
                                console.error('[Microsoft Init] ❌ Failed to persist on init');
                                console.error('[Microsoft Init] Error:', error);
                            } else {
                                console.log('[Microsoft Init] ✅ Successfully persisted on init');
                                console.log('[Microsoft Init] Data:', data);
                            }
                        } catch (err) {
                            console.error('[Microsoft Init] ❌ Exception during persist on init:', err.message);
                            console.error('[Microsoft Init] Stack:', err.stack);
                        }
                    } else {
                        console.warn('[Microsoft Init] No user authenticated, skipping persist on init');
                    }
                } else if (user && isSupabaseAvailable()) {
                    // No cached accounts, but user is logged in - check if we should restore
                    // Skip if we already know the table isn't available
                    if (isConnectedServicesAvailable() === false) {
                        return;
                    }

                    try {
                        const { data: persistedConnection, error } = await supabase
                            .from('connected_services')
                            .select('*')
                            .eq('user_id', user.id)
                            .eq('service_name', 'microsoft')
                            .maybeSingle();

                        // Silently ignore errors
                        if (error) {
                            if (isSchemaError(error)) {
                                // Mark table as unavailable to prevent repeated requests
                                setConnectedServicesAvailable(false);
                            }
                            return;
                        }

                        // Table is available
                        setConnectedServicesAvailable(true);

                        if (persistedConnection && persistedConnection.is_connected) {
                            console.log('Found persisted Microsoft connection, attempting SSO silent auth...');

                            // Try SSO silent first (no popup)
                            try {
                                const response = await pca.ssoSilent({
                                    ...loginRequest,
                                    loginHint: persistedConnection.account_email,
                                });

                                if (response && response.account && isMounted) {
                                    setAccount(response.account);
                                    setIsAuthenticated(true);
                                    initializeGraphClient(pca, response.account);
                                    console.log('Microsoft connection restored via SSO silent');
                                }
                            } catch (ssoErr) {
                                console.log('SSO silent failed, will require manual reconnect:', ssoErr.message);
                                // Don't remove the persisted connection - the user can manually reconnect
                                // Set flag so UI can show reconnect prompt
                                if (isMounted) {
                                    setNeedsReconnect(true);
                                }
                            }
                        }
                    } catch (err) {
                        // Silently handle errors - table might not be ready
                        console.log('Could not check for persisted connection, will retry on next load');
                    }
                }

                if (isMounted) {
                    setConnectionRestored(true);
                }
            } catch (err) {
                console.error("MSAL Initialization Error:", err);
                if (isMounted) {
                    setError(err.message);
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        initializeMsal();

        return () => {
            isMounted = false;
        };
    }, [user, initializeGraphClient]);

    // Update last_used timestamp when graph client is used
    const updateLastUsed = useCallback(async () => {
        if (!user || !isSupabaseAvailable()) return;

        try {
            const { error } = await supabase
                .from('connected_services')
                .update({ last_used_at: new Date().toISOString() })
                .eq('user_id', user.id)
                .eq('service_name', 'microsoft');

            if (error) {
                // Silently fail - not critical
            }
        } catch (err) {
            // Silently fail - not critical
        }
    }, [user]);

    // Automatic token refresh to prevent session expiration
    useEffect(() => {
        if (!isAuthenticated || !msalInstance || !account) return;

        let refreshInterval;
        let retryTimeout;
        let retryCount = 0;
        const MAX_RETRIES = 3;

        const refreshToken = async (isRetry = false) => {
            try {
                if (!isRetry) {
                    console.log('[Microsoft Auth] Proactively refreshing token...');
                } else {
                    console.log(`[Microsoft Auth] Retry attempt ${retryCount}/${MAX_RETRIES}...`);
                }

                const response = await msalInstance.acquireTokenSilent({
                    ...loginRequest,
                    account: account,
                    forceRefresh: false, // Let MSAL decide if refresh is needed
                });

                if (response) {
                    console.log('[Microsoft Auth] Token refreshed successfully, expires at:', response.expiresOn);
                    // Clear reconnect flag if it was set
                    setNeedsReconnect(false);
                    // Reset retry count on success
                    retryCount = 0;
                }
            } catch (error) {
                console.warn('[Microsoft Auth] Silent token refresh failed:', error.message);

                // Try SSO silent as fallback
                try {
                    console.log('[Microsoft Auth] Attempting SSO silent fallback...');
                    const ssoResponse = await msalInstance.ssoSilent({
                        ...loginRequest,
                        loginHint: account.username,
                    });

                    if (ssoResponse) {
                        console.log('[Microsoft Auth] Token refreshed via SSO silent');
                        setNeedsReconnect(false);
                        retryCount = 0;
                    }
                } catch (ssoError) {
                    console.error('[Microsoft Auth] SSO silent also failed:', ssoError.message);

                    // Check if this might be a temporary network error
                    const isNetworkError = error.message?.includes('network') ||
                                          error.message?.includes('timeout') ||
                                          ssoError.message?.includes('network') ||
                                          ssoError.message?.includes('timeout');

                    if (isNetworkError && retryCount < MAX_RETRIES) {
                        // Retry with exponential backoff: 5s, 10s, 20s
                        const retryDelay = 5000 * Math.pow(2, retryCount);
                        retryCount++;
                        console.log(`[Microsoft Auth] Network error detected, retrying in ${retryDelay/1000}s...`);
                        retryTimeout = setTimeout(() => refreshToken(true), retryDelay);
                    } else {
                        // Both methods failed and no more retries - user needs to reconnect
                        console.error('[Microsoft Auth] All refresh attempts exhausted, manual reconnect required');
                        setNeedsReconnect(true);
                        retryCount = 0;
                    }
                }
            }
        };

        // Initial refresh attempt to establish baseline
        refreshToken();

        // Set up periodic refresh every 30 minutes
        // This ensures tokens stay fresh well before the typical 1-hour expiration
        refreshInterval = setInterval(() => refreshToken(false), 30 * 60 * 1000);

        return () => {
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
            if (retryTimeout) {
                clearTimeout(retryTimeout);
            }
        };
    }, [isAuthenticated, msalInstance, account]);

    const login = async () => {
        if (!msalInstance) return;
        try {
            const response = await msalInstance.loginPopup(loginRequest);
            if (response && response.account) {
                setAccount(response.account);
                setIsAuthenticated(true);
                setNeedsReconnect(false); // Clear reconnect flag on successful login
                initializeGraphClient(msalInstance, response.account);

                // Persist the connection to Supabase
                await persistConnection(response.account);
            }
        } catch (err) {
            console.error("Login failed", err);
            setError(err.message);
        }
    };

    const logout = async () => {
        if (!msalInstance) return;
        try {
            // Remove from Supabase first
            await removeConnection();

            await msalInstance.logoutPopup({
                postLogoutRedirectUri: window.location.origin
            });
            setAccount(null);
            setIsAuthenticated(false);
            setGraphClient(null);
        } catch (err) {
            console.error("Logout failed", err);
            setError(err.message);
        }
    };

    const value = {
        msalInstance,
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
