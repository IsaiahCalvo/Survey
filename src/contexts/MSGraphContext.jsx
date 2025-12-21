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
        if (!user || !isSupabaseAvailable()) return;

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

            const { error } = await supabase
                .from('connected_services')
                .upsert(serviceData, { onConflict: 'user_id,service_name' });

            if (error) {
                console.log('Could not persist connection (table not ready), will retry later');
            } else {
                console.log('Microsoft connection persisted to Supabase');
            }
        } catch (err) {
            console.log('Could not persist connection, will retry later');
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
                .single();

            if (error && error.code !== 'PGRST116') {
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
                        account: account
                    });
                    done(null, response.accessToken);
                } catch (error) {
                    console.error("Silent token acquisition failed, trying popup", error);
                    try {
                        const response = await pca.acquireTokenPopup({
                            ...loginRequest,
                            account: account
                        });
                        done(null, response.accessToken);
                    } catch (err) {
                        console.error("Popup token acquisition failed", err);
                        done(err, null);
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
                                console.log('Could not persist connection on init, will retry later');
                            }
                        } catch (err) {
                            console.log('Could not persist connection on init, will retry later');
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
                            .single();

                        // Silently ignore errors (schema cache not ready or no rows)
                        // PGRST116 = no rows found, 406 = schema not ready
                        if (error) {
                            if (isSchemaError(error)) {
                                // Mark table as unavailable to prevent repeated requests
                                setConnectedServicesAvailable(false);
                                return;
                            }
                            if (error.code !== 'PGRST116') {
                                console.log('Connected services query error, skipping restore check');
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
