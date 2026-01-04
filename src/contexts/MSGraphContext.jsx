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
                // First, check for manually stored access token (from Electron OAuth flow)
                const isElectron = window.electronAPI?.openOAuthWindow !== undefined;
                if (isElectron && account.homeAccountId) {
                    try {
                        // Look for access token in localStorage (stored by Electron OAuth flow)
                        const accessTokenKey = `${account.homeAccountId}-login.microsoftonline.com-accesstoken-${msalConfig.auth.clientId}-${account.tenantId}-${loginRequest.scopes.join(' ')}`;
                        const storedToken = localStorage.getItem(accessTokenKey);

                        if (storedToken) {
                            const tokenData = JSON.parse(storedToken);
                            const now = Math.floor(Date.now() / 1000);

                            // Check if token is still valid (with 5 minute buffer)
                            if (tokenData.secret && parseInt(tokenData.expiresOn) > now + 300) {
                                done(null, tokenData.secret);
                                return;
                            }

                            // Token expired - try to refresh using refresh token
                            const refreshTokenKey = `${account.homeAccountId}-login.microsoftonline.com-refreshtoken-${msalConfig.auth.clientId}--`;
                            const storedRefreshToken = localStorage.getItem(refreshTokenKey);

                            if (storedRefreshToken) {
                                const refreshData = JSON.parse(storedRefreshToken);
                                if (refreshData.secret) {
                                    try {
                                        // Exchange refresh token for new access token
                                        const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
                                        const tokenResponse = await fetch(tokenUrl, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                            body: new URLSearchParams({
                                                client_id: msalConfig.auth.clientId,
                                                scope: [...loginRequest.scopes, 'openid', 'profile', 'offline_access'].join(' '),
                                                refresh_token: refreshData.secret,
                                                grant_type: 'refresh_token',
                                            }).toString(),
                                        });

                                        if (tokenResponse.ok) {
                                            const tokens = await tokenResponse.json();
                                            const newNow = Math.floor(Date.now() / 1000);

                                            // Update stored access token
                                            localStorage.setItem(accessTokenKey, JSON.stringify({
                                                ...tokenData,
                                                secret: tokens.access_token,
                                                cachedAt: newNow.toString(),
                                                expiresOn: (newNow + tokens.expires_in).toString(),
                                                extendedExpiresOn: (newNow + tokens.expires_in).toString(),
                                            }));

                                            // Update refresh token if a new one was issued
                                            if (tokens.refresh_token) {
                                                localStorage.setItem(refreshTokenKey, JSON.stringify({
                                                    ...refreshData,
                                                    secret: tokens.refresh_token,
                                                }));
                                            }

                                            done(null, tokens.access_token);
                                            return;
                                        }
                                    } catch (refreshError) {
                                        console.error('Token refresh failed:', refreshError);
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.error('Error reading stored token:', e);
                    }
                }

                // Fall back to MSAL methods
                try {
                    const response = await pca.acquireTokenSilent({
                        ...loginRequest,
                        account: account,
                        forceRefresh: false,
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

                // Handle redirect response (for Electron redirect flow)
                try {
                    const redirectResponse = await pca.handleRedirectPromise();
                    if (redirectResponse && redirectResponse.account && isMounted) {
                        setAccount(redirectResponse.account);
                        setIsAuthenticated(true);
                        setNeedsReconnect(false);
                        initializeGraphClient(pca, redirectResponse.account);
                        // Persist the connection
                        if (user) {
                            await persistConnection(redirectResponse.account);
                        }
                        setIsLoading(false);
                        setConnectionRestored(true);
                        return; // Early return - redirect auth completed
                    }
                } catch (redirectErr) {
                    console.error('[Microsoft Init] Redirect handling error:', redirectErr);
                }

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

        // Detect if running in Electron
        const isElectron = window.electronAPI?.openOAuthWindow !== undefined;

        try {
            if (isElectron) {
                // Use custom Electron OAuth window flow
                // This opens a separate window, handles auth, and returns without disrupting the main window

                // Build the authorization URL
                const authCodeUrlParameters = {
                    scopes: loginRequest.scopes,
                    redirectUri: msalConfig.auth.redirectUri,
                    responseMode: 'fragment', // Get response in URL hash
                };

                // Get the authorization URL from MSAL
                const authUrl = await msalInstance.acquireTokenByCode
                    ? null // MSAL Node has this, browser doesn't
                    : null;

                // For MSAL browser, we need to build the URL using the authorization endpoint
                // Use MSAL's internal URL builder by getting the auth URL from a redirect request
                const cryptoUtils = msalInstance.getCrypto ? msalInstance.getCrypto() : null;

                // Generate PKCE code verifier and challenge
                const generatePKCE = () => {
                    const array = new Uint8Array(32);
                    crypto.getRandomValues(array);
                    const verifier = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
                    return verifier;
                };

                const codeVerifier = generatePKCE();

                // SHA-256 hash for code challenge
                const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
                const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/, '');

                // Generate state for CSRF protection
                const state = crypto.randomUUID();

                // Build authorization URL manually
                const authorizationUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
                authorizationUrl.searchParams.set('client_id', msalConfig.auth.clientId);
                authorizationUrl.searchParams.set('response_type', 'code');
                authorizationUrl.searchParams.set('redirect_uri', msalConfig.auth.redirectUri);
                authorizationUrl.searchParams.set('scope', [...loginRequest.scopes, 'openid', 'profile', 'offline_access'].join(' '));
                authorizationUrl.searchParams.set('response_mode', 'fragment');
                authorizationUrl.searchParams.set('state', state);
                authorizationUrl.searchParams.set('code_challenge', codeChallenge);
                authorizationUrl.searchParams.set('code_challenge_method', 'S256');
                authorizationUrl.searchParams.set('prompt', 'select_account');

                // Open the Electron OAuth window
                const result = await window.electronAPI.openOAuthWindow(
                    authorizationUrl.toString(),
                    msalConfig.auth.redirectUri
                );

                if (!result.success) {
                    throw new Error(result.error || 'Authentication cancelled');
                }

                // Parse the redirect URL to get the authorization code
                const redirectUrl = new URL(result.url);
                const hashParams = new URLSearchParams(redirectUrl.hash.substring(1));
                const code = hashParams.get('code');
                const returnedState = hashParams.get('state');

                if (!code) {
                    const error = hashParams.get('error');
                    const errorDesc = hashParams.get('error_description');
                    throw new Error(errorDesc || error || 'No authorization code received');
                }

                if (returnedState !== state) {
                    throw new Error('State mismatch - possible CSRF attack');
                }

                // Exchange authorization code for tokens
                const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
                const tokenResponse = await fetch(tokenUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        client_id: msalConfig.auth.clientId,
                        scope: [...loginRequest.scopes, 'openid', 'profile', 'offline_access'].join(' '),
                        code: code,
                        redirect_uri: msalConfig.auth.redirectUri,
                        grant_type: 'authorization_code',
                        code_verifier: codeVerifier,
                    }).toString(),
                });

                if (!tokenResponse.ok) {
                    const errorData = await tokenResponse.json();
                    throw new Error(errorData.error_description || 'Token exchange failed');
                }

                const tokens = await tokenResponse.json();

                // Decode the ID token to get account info
                const idTokenParts = tokens.id_token.split('.');
                const idTokenPayload = JSON.parse(atob(idTokenParts[1]));

                // Create account object matching MSAL's format
                const msalAccount = {
                    homeAccountId: `${idTokenPayload.oid}.${idTokenPayload.tid}`,
                    localAccountId: idTokenPayload.oid,
                    tenantId: idTokenPayload.tid,
                    username: idTokenPayload.preferred_username || idTokenPayload.email,
                    name: idTokenPayload.name,
                    idToken: tokens.id_token,
                };

                // Store tokens in MSAL's cache for future silent requests
                // We need to use MSAL's internal cache to ensure acquireTokenSilent works
                const accountKey = `${msalAccount.homeAccountId}-login.microsoftonline.com-${msalAccount.tenantId}`;
                const now = Math.floor(Date.now() / 1000);

                // Store in localStorage (matching MSAL's cache format)
                const accessTokenKey = `${msalAccount.homeAccountId}-login.microsoftonline.com-accesstoken-${msalConfig.auth.clientId}-${msalAccount.tenantId}-${loginRequest.scopes.join(' ')}`;
                const idTokenKey = `${msalAccount.homeAccountId}-login.microsoftonline.com-idtoken-${msalConfig.auth.clientId}-${msalAccount.tenantId}-`;
                const accountCacheKey = `${msalAccount.homeAccountId}-login.microsoftonline.com-${msalAccount.tenantId}`;

                localStorage.setItem(accessTokenKey, JSON.stringify({
                    homeAccountId: msalAccount.homeAccountId,
                    credentialType: 'AccessToken',
                    secret: tokens.access_token,
                    cachedAt: now.toString(),
                    expiresOn: (now + tokens.expires_in).toString(),
                    extendedExpiresOn: (now + tokens.expires_in).toString(),
                    environment: 'login.microsoftonline.com',
                    clientId: msalConfig.auth.clientId,
                    realm: msalAccount.tenantId,
                    target: loginRequest.scopes.join(' '),
                }));

                localStorage.setItem(idTokenKey, JSON.stringify({
                    homeAccountId: msalAccount.homeAccountId,
                    credentialType: 'IdToken',
                    secret: tokens.id_token,
                    environment: 'login.microsoftonline.com',
                    clientId: msalConfig.auth.clientId,
                    realm: msalAccount.tenantId,
                }));

                localStorage.setItem(accountCacheKey, JSON.stringify({
                    homeAccountId: msalAccount.homeAccountId,
                    environment: 'login.microsoftonline.com',
                    tenantId: msalAccount.tenantId,
                    username: msalAccount.username,
                    localAccountId: msalAccount.localAccountId,
                    name: msalAccount.name,
                    authorityType: 'MSSTS',
                    clientInfo: btoa(JSON.stringify({ uid: idTokenPayload.oid, utid: idTokenPayload.tid })),
                }));

                if (tokens.refresh_token) {
                    const refreshTokenKey = `${msalAccount.homeAccountId}-login.microsoftonline.com-refreshtoken-${msalConfig.auth.clientId}--`;
                    localStorage.setItem(refreshTokenKey, JSON.stringify({
                        homeAccountId: msalAccount.homeAccountId,
                        credentialType: 'RefreshToken',
                        secret: tokens.refresh_token,
                        environment: 'login.microsoftonline.com',
                        clientId: msalConfig.auth.clientId,
                    }));
                }

                // Set state
                setAccount(msalAccount);
                setIsAuthenticated(true);
                setNeedsReconnect(false);
                initializeGraphClient(msalInstance, msalAccount);
                await persistConnection(msalAccount);

            } else {
                // Use popup for regular browser
                const popupRequest = {
                    ...loginRequest,
                    popupWindowAttributes: {
                        popupSize: { width: 483, height: 600 },
                        popupPosition: { top: 100, left: 100 }
                    }
                };
                const response = await msalInstance.loginPopup(popupRequest);
                if (response && response.account) {
                    setAccount(response.account);
                    setIsAuthenticated(true);
                    setNeedsReconnect(false);
                    initializeGraphClient(msalInstance, response.account);
                    await persistConnection(response.account);
                }
            }
        } catch (err) {
            console.error("Microsoft login failed:", err.message);
            setError(err.message);
        }
    };

    const logout = async () => {
        if (!msalInstance) return;

        // Detect if running in Electron
        const isElectron = window.electronAPI?.openOAuthWindow !== undefined;

        try {
            // Remove from Supabase first
            await removeConnection();

            if (isElectron) {
                // For Electron, clear local cache without redirecting
                // This avoids disrupting the main window

                // Clear MSAL cache entries from localStorage
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (
                        key.includes('login.microsoftonline.com') ||
                        key.includes('msal.') ||
                        key.includes(msalConfig.auth.clientId)
                    )) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(key => localStorage.removeItem(key));

                // Clear state
                setAccount(null);
                setIsAuthenticated(false);
                setGraphClient(null);
            } else {
                // Use popup for regular browser
                await msalInstance.logoutPopup({
                    postLogoutRedirectUri: window.location.origin,
                    popupWindowAttributes: {
                        popupSize: { width: 483, height: 600 },
                        popupPosition: { top: 100, left: 100 }
                    }
                });
                setAccount(null);
                setIsAuthenticated(false);
                setGraphClient(null);
            }
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
