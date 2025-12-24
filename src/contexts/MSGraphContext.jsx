import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { PublicClientApplication } from '@azure/msal-browser';
import { Client } from '@microsoft/microsoft-graph-client';
import { msalConfig, loginRequest } from '../authConfig';
import { useAuth } from './AuthContext';
import { supabase, isSupabaseAvailable, isSchemaError, isConnectedServicesAvailable, setConnectedServicesAvailable } from '../supabaseClient';

const MSGraphContext = createContext({});

// Create singleton MSAL instance to prevent multiple initialization warnings
let msalInstanceSingleton = null;
let msalInitPromise = null;

const getMsalInstance = async () => {
    if (msalInstanceSingleton) {
        return msalInstanceSingleton;
    }

    if (!msalInitPromise) {
        msalInitPromise = (async () => {
            const instance = new PublicClientApplication(msalConfig);
            await instance.initialize();
            msalInstanceSingleton = instance;
            return instance;
        })();
    }

    return msalInitPromise;
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
    const persistConnection = useCallback(async (msalAccount, tokenExpiresAt = null) => {
        if (!user) {
            return;
        }

        if (!isSupabaseAvailable()) {
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
                    ...(tokenExpiresAt && { token_expires_at: tokenExpiresAt }),
                    last_refresh_attempt: new Date().toISOString(),
                },
                connected_at: new Date().toISOString(),
                last_used_at: new Date().toISOString(),
            };

            const { data, error } = await supabase
                .from('connected_services')
                .upsert(serviceData, { onConflict: 'user_id,service_name' });

            if (error) {
                console.error('[Microsoft Persist] Failed to persist connection:', error.message);
            }
        } catch (err) {
            console.error('[Microsoft Persist] Exception during persist:', err.message);
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
                    // Try SSO silent before giving up (no popup)
                    try {
                        const ssoResponse = await pca.ssoSilent({
                            ...loginRequest,
                            loginHint: account.username,
                        });
                        done(null, ssoResponse.accessToken);
                    } catch (ssoError) {
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
                        try {
                            const { error } = await supabase
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
                                console.error('[Microsoft Init] Failed to persist on init:', error.message);
                            }
                        } catch (err) {
                            console.error('[Microsoft Init] Exception during persist on init:', err.message);
                        }
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
                                }
                            } catch (ssoErr) {
                                // Don't remove the persisted connection - the user can manually reconnect
                                // Set flag so UI can show reconnect prompt
                                if (isMounted) {
                                    setNeedsReconnect(true);
                                }
                            }
                        }
                    } catch (err) {
                        // Silently handle errors - table might not be ready
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
                const response = await msalInstance.acquireTokenSilent({
                    ...loginRequest,
                    account: account,
                    forceRefresh: false, // Let MSAL decide if refresh is needed
                });

                if (response) {
                    // Clear reconnect flag if it was set
                    setNeedsReconnect(false);
                    // Reset retry count on success
                    retryCount = 0;
                }
            } catch (error) {
                // Try SSO silent as fallback
                try {
                    const ssoResponse = await msalInstance.ssoSilent({
                        ...loginRequest,
                        loginHint: account.username,
                    });

                    if (ssoResponse) {
                        setNeedsReconnect(false);
                        retryCount = 0;
                    }
                } catch (ssoError) {
                    // Check if this might be a temporary network error
                    const isNetworkError = error.message?.includes('network') ||
                                          error.message?.includes('timeout') ||
                                          ssoError.message?.includes('network') ||
                                          ssoError.message?.includes('timeout');

                    if (isNetworkError && retryCount < MAX_RETRIES) {
                        // Retry with exponential backoff: 5s, 10s, 20s
                        const retryDelay = 5000 * Math.pow(2, retryCount);
                        retryCount++;
                        retryTimeout = setTimeout(() => refreshToken(true), retryDelay);
                    } else {
                        // Both methods failed and no more retries - user needs to reconnect
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
            console.error("Microsoft login failed:", err.message);
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
            console.error("Microsoft logout failed:", err.message);
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
