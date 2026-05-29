import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Client } from '@microsoft/microsoft-graph-client';
import { useAuth } from './AuthContext';
import { supabase, isSupabaseAvailable } from '../supabaseClient';

export const MSGraphContext = createContext({});

// Microsoft Graph API scopes needed for OneDrive
const GRAPH_SCOPES = ['User.Read', 'Files.ReadWrite.All', 'Sites.ReadWrite.All'];

// Azure app client ID
const AZURE_CLIENT_ID = '0da81a9e-2b05-46ee-b826-5efc5114c765';
const AZURE_REDIRECT_URI = 'http://localhost:5173';
const MS_REFRESH_COOLDOWN_MS = 60 * 1000;
const MS_HARD_REFRESH_BLOCK_MS = 30 * 60 * 1000;
const MS_REFRESH_BLOCK_UNTIL_KEY = 'ms_refresh_block_until';

const readRefreshBlockUntil = () => {
    if (typeof window === 'undefined') return 0;
    try {
        const value = Number(window.sessionStorage.getItem(MS_REFRESH_BLOCK_UNTIL_KEY) || 0);
        return Number.isFinite(value) ? value : 0;
    } catch {
        return 0;
    }
};

const writeRefreshBlockUntil = (value) => {
    if (typeof window === 'undefined') return;
    try {
        if (!value || value <= 0) {
            window.sessionStorage.removeItem(MS_REFRESH_BLOCK_UNTIL_KEY);
            return;
        }
        window.sessionStorage.setItem(MS_REFRESH_BLOCK_UNTIL_KEY, String(value));
    } catch {
        // Ignore storage errors
    }
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
    const [account, setAccount] = useState(null);
    const [graphClient, setGraphClient] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [connectionRestored, setConnectionRestored] = useState(false);
    const [needsReconnect, setNeedsReconnect] = useState(false);
    const tokenRef = useRef(null);
    const oauthProcessing = useRef(false); // Prevent duplicate OAuth callback processing
    const refreshStateRef = useRef({
        inFlight: null,
        cooldownUntil: 0,
        hardBlockedUntil: 0,
        lastErrorCode: null
    });

    // Initialize Graph client
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

    // Store tokens in Supabase database
    const storeTokens = useCallback(async (tokens, accountInfo) => {
        if (!user || !isSupabaseAvailable()) return false;

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
                    metadata: {
                        access_token: tokens.access_token,
                        refresh_token: tokens.refresh_token,
                        id_token: tokens.id_token,
                        expires_at: tokens.expires_at,
                        tenant_id: accountInfo.tenantId,
                    },
                    connected_at: new Date().toISOString(),
                    last_used_at: new Date().toISOString(),
                }, { onConflict: 'user_id,service_name' });

            return !error;
        } catch (err) {
            return false;
        }
    }, [user]);

    // Fetch stored tokens from database
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
            return null;
        }
    }, [user]);

    // Refresh access token using refresh token
    const refreshAccessToken = useCallback(async (refreshToken, options = {}) => {
        if (!refreshToken) return null;

        const state = refreshStateRef.current;
        const nowMs = Date.now();
        const persistedBlockedUntil = readRefreshBlockUntil();
        if (persistedBlockedUntil > state.hardBlockedUntil) {
            state.hardBlockedUntil = persistedBlockedUntil;
        }

        if (state.hardBlockedUntil > nowMs || state.cooldownUntil > nowMs) {
            return null;
        }

        if (state.inFlight) {
            return state.inFlight;
        }

        const runRefresh = async () => {
            try {
                const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
                const response = await fetch(tokenUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: AZURE_CLIENT_ID,
                        scope: [...GRAPH_SCOPES, 'openid', 'profile', 'offline_access'].join(' '),
                        refresh_token: refreshToken,
                        grant_type: 'refresh_token',
                    }).toString(),
                });

                if (!response.ok) {
                    let errorPayload = null;
                    try {
                        errorPayload = await response.json();
                    } catch {
                        errorPayload = null;
                    }

                    const errorCode = String(errorPayload?.error || '').toLowerCase();
                    const errorDescription = String(errorPayload?.error_description || '').toLowerCase();
                    const hardFailure =
                        errorCode === 'invalid_grant' ||
                        errorCode === 'invalid_client' ||
                        errorCode === 'unauthorized_client' ||
                        errorCode === 'interaction_required' ||
                        errorDescription.includes('invalid_grant') ||
                        errorDescription.includes('invalid_client') ||
                        errorDescription.includes('unauthorized_client') ||
                        errorDescription.includes('interaction_required') ||
                        errorDescription.includes('revoked') ||
                        errorDescription.includes('expired');

                    state.lastErrorCode = errorCode || `http_${response.status}`;
                    if (hardFailure) {
                        const blockUntil = Date.now() + MS_HARD_REFRESH_BLOCK_MS;
                        state.hardBlockedUntil = blockUntil;
                        state.cooldownUntil = blockUntil;
                        writeRefreshBlockUntil(blockUntil);
                        setNeedsReconnect(true);
                        setIsAuthenticated(false);
                        setGraphClient(null);
                        tokenRef.current = null;

                        if (user && isSupabaseAvailable()) {
                            try {
                                await supabase
                                    .from('connected_services')
                                    .update({
                                        is_connected: false,
                                        metadata: {}
                                    })
                                    .eq('user_id', user.id)
                                    .eq('service_name', 'microsoft');
                            } catch {
                                // Best-effort cleanup; reconnect UI state is still enforced above.
                            }
                        }
                    } else {
                        state.cooldownUntil = Date.now() + MS_REFRESH_COOLDOWN_MS;
                    }
                    return null;
                }

                const tokens = await response.json();
                state.cooldownUntil = 0;
                state.hardBlockedUntil = 0;
                state.lastErrorCode = null;
                writeRefreshBlockUntil(0);

                return {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token || refreshToken,
                    id_token: tokens.id_token,
                    expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
                    refresh_reason: options.reason || 'unspecified'
                };
            } catch {
                state.cooldownUntil = Date.now() + MS_REFRESH_COOLDOWN_MS;
                return null;
            } finally {
                state.inFlight = null;
            }
        };

        state.inFlight = runRefresh();
        return state.inFlight;
    }, [setGraphClient, setIsAuthenticated, setNeedsReconnect, user]);

    // Remove connection
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

    // Restore connection on mount
    useEffect(() => {
        let isMounted = true;

        const restoreConnection = async () => {
            if (!user) {
                setIsLoading(false);
                setConnectionRestored(true);
                return;
            }

            setIsLoading(true);

            try {
                const storedData = await fetchStoredTokens();

                if (!storedData?.is_connected || !storedData?.metadata?.refresh_token) {
                    if (isMounted) {
                        setIsAuthenticated(false);
                        setGraphClient(null);
                        setAccount(null);
                        setNeedsReconnect(storedData?.is_connected && !storedData?.metadata?.refresh_token);
                    }
                    setIsLoading(false);
                    setConnectionRestored(true);
                    return;
                }

                const { metadata, account_email, account_name, account_id } = storedData;
                const { access_token, refresh_token, expires_at } = metadata;
                const refreshState = refreshStateRef.current;
                const nowMs = Date.now();
                const persistedBlockedUntil = readRefreshBlockUntil();
                if (persistedBlockedUntil > refreshState.hardBlockedUntil) {
                    refreshState.hardBlockedUntil = persistedBlockedUntil;
                }
                const isRefreshBlocked = refreshState.hardBlockedUntil > nowMs;

                if (isRefreshBlocked) {
                    if (isMounted) {
                        setNeedsReconnect(true);
                        setIsAuthenticated(false);
                        setGraphClient(null);
                        setAccount({ username: account_email, name: account_name, homeAccountId: account_id });
                    }
                    setIsLoading(false);
                    setConnectionRestored(true);
                    return;
                }

                // Check if token needs refresh
                const now = Math.floor(Date.now() / 1000);
                let currentAccessToken = access_token;

                if (!expires_at || expires_at < now + 300) {
                    const newTokens = await refreshAccessToken(refresh_token, { reason: 'restore' });

                    if (!newTokens) {
                        if (isMounted) {
                            setNeedsReconnect(true);
                            setIsAuthenticated(false);
                            setGraphClient(null);
                            setAccount({ username: account_email, name: account_name, homeAccountId: account_id });
                        }
                        setIsLoading(false);
                        setConnectionRestored(true);
                        return;
                    }

                    currentAccessToken = newTokens.access_token;
                    await storeTokens(newTokens, {
                        homeAccountId: account_id,
                        username: account_email,
                        name: account_name,
                        tenantId: metadata.tenant_id,
                    });
                }

                if (isMounted) {
                    setAccount({ username: account_email, name: account_name, homeAccountId: account_id });
                    setIsAuthenticated(true);
                    setNeedsReconnect(false);
                    initializeGraphClient(currentAccessToken);
                }
            } catch (err) {
                if (isMounted) setError(err.message);
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                    setConnectionRestored(true);
                }
            }
        };

        restoreConnection();
        return () => { isMounted = false; };
    }, [user, fetchStoredTokens, storeTokens, refreshAccessToken, initializeGraphClient]);

    // Periodic token refresh - refresh every 10 minutes to stay ahead of expiry
    // Microsoft access tokens typically last 60-90 minutes, but can be revoked anytime
    useEffect(() => {
        if (!isAuthenticated || !user || needsReconnect) return;

        const refreshInterval = setInterval(async () => {
            const state = refreshStateRef.current;
            const nowMs = Date.now();
            const persistedBlockedUntil = readRefreshBlockUntil();
            if (persistedBlockedUntil > state.hardBlockedUntil) {
                state.hardBlockedUntil = persistedBlockedUntil;
            }
            if (state.hardBlockedUntil > nowMs || state.cooldownUntil > nowMs) {
                return;
            }

            const storedData = await fetchStoredTokens();
            if (storedData?.metadata?.refresh_token) {
                const newTokens = await refreshAccessToken(storedData.metadata.refresh_token, { reason: 'interval' });
                if (newTokens) {
                    tokenRef.current = newTokens.access_token;
                    await storeTokens(newTokens, {
                        homeAccountId: storedData.account_id,
                        username: storedData.account_email,
                        name: storedData.account_name,
                        tenantId: storedData.metadata.tenant_id,
                    });
                } else {
                    const latestState = refreshStateRef.current;
                    if (latestState.hardBlockedUntil > Date.now()) {
                        setNeedsReconnect(true);
                        setIsAuthenticated(false);
                        setGraphClient(null);
                        tokenRef.current = null;
                    }
                }
            }
        }, 10 * 60 * 1000); // Refresh every 10 minutes

        return () => clearInterval(refreshInterval);
    }, [isAuthenticated, user, needsReconnect, fetchStoredTokens, refreshAccessToken, storeTokens]);

    // Ensure fresh token before API operations - call this before making Graph API calls
    const ensureFreshToken = useCallback(async () => {
        if (!user || needsReconnect) return false;

        const state = refreshStateRef.current;
        const nowMs = Date.now();
        const persistedBlockedUntil = readRefreshBlockUntil();
        if (persistedBlockedUntil > state.hardBlockedUntil) {
            state.hardBlockedUntil = persistedBlockedUntil;
        }
        if (state.hardBlockedUntil > nowMs || state.cooldownUntil > nowMs) {
            return false;
        }

        const storedData = await fetchStoredTokens();
        if (!storedData?.metadata?.refresh_token) {
            setNeedsReconnect(true);
            setIsAuthenticated(false);
            setGraphClient(null);
            tokenRef.current = null;
            return false;
        }

        const { metadata } = storedData;
        const now = Math.floor(Date.now() / 1000);

        // Refresh if token expires within 10 minutes
        if (!metadata.expires_at || metadata.expires_at < now + 600) {
            const newTokens = await refreshAccessToken(metadata.refresh_token, { reason: 'ensure_fresh' });
            if (newTokens) {
                tokenRef.current = newTokens.access_token;
                await storeTokens(newTokens, {
                    homeAccountId: storedData.account_id,
                    username: storedData.account_email,
                    name: storedData.account_name,
                    tenantId: metadata.tenant_id,
                });
                setNeedsReconnect(false);
                return true;
            } else {
                const latestState = refreshStateRef.current;
                if (latestState.hardBlockedUntil > Date.now()) {
                    setNeedsReconnect(true);
                    setIsAuthenticated(false);
                    setGraphClient(null);
                    tokenRef.current = null;
                }
                return false;
            }
        }

        if (!tokenRef.current && metadata.access_token) {
            tokenRef.current = metadata.access_token;
        }
        return true;
    }, [user, needsReconnect, fetchStoredTokens, refreshAccessToken, storeTokens]);

    const clearOAuthSession = useCallback(() => {
        sessionStorage.removeItem('ms_pkce_verifier');
        sessionStorage.removeItem('ms_oauth_state');
    }, []);

    const completeOAuthLogin = useCallback(async (code, returnedState) => {
        const storedState = sessionStorage.getItem('ms_oauth_state');
        const codeVerifier = sessionStorage.getItem('ms_pkce_verifier');

        if (returnedState !== storedState) {
            throw new Error('OAuth state mismatch - possible CSRF attack');
        }

        if (!codeVerifier) {
            throw new Error('OAuth session expired - please try again');
        }

        // Exchange code for tokens
        const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: AZURE_CLIENT_ID,
                scope: [...GRAPH_SCOPES, 'openid', 'profile', 'offline_access'].join(' '),
                code,
                redirect_uri: AZURE_REDIRECT_URI,
                grant_type: 'authorization_code',
                code_verifier: codeVerifier,
            }).toString(),
        });

        if (!tokenResponse.ok) {
            let errorMessage = 'Token exchange failed';
            try {
                const errorData = await tokenResponse.json();
                errorMessage = errorData.error_description || errorData.error || errorMessage;
            } catch {
                // Ignore parse errors and keep fallback message
            }
            throw new Error(errorMessage);
        }

        const tokens = await tokenResponse.json();

        // Decode ID token to get user info
        const idTokenParts = tokens.id_token.split('.');
        const idTokenPayload = JSON.parse(atob(idTokenParts[1]));

        const accountInfo = {
            homeAccountId: `${idTokenPayload.oid}.${idTokenPayload.tid}`,
            tenantId: idTokenPayload.tid,
            username: idTokenPayload.preferred_username || idTokenPayload.email,
            name: idTokenPayload.name,
        };

        const tokenData = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            id_token: tokens.id_token,
            expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
        };

        // Store tokens in database
        const stored = await storeTokens(tokenData, accountInfo);
        if (!stored) {
            throw new Error('Failed to store Microsoft authentication tokens');
        }

        setAccount({
            username: accountInfo.username,
            name: accountInfo.name,
            homeAccountId: accountInfo.homeAccountId,
        });
        setIsAuthenticated(true);
        setNeedsReconnect(false);
        initializeGraphClient(tokens.access_token);
        refreshStateRef.current.cooldownUntil = 0;
        refreshStateRef.current.hardBlockedUntil = 0;
        refreshStateRef.current.lastErrorCode = null;
        writeRefreshBlockUntil(0);

        return true;
    }, [storeTokens, initializeGraphClient]);

    // Login using direct OAuth flow (not Supabase linkIdentity)
    const login = useCallback(async () => {
        try {
            setError(null);

            // Generate PKCE code verifier and challenge
            const generatePKCE = () => {
                const array = new Uint8Array(32);
                crypto.getRandomValues(array);
                return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
            };

            const codeVerifier = generatePKCE();
            const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
            const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            const state = crypto.randomUUID();

            // Store PKCE verifier for later use
            sessionStorage.setItem('ms_pkce_verifier', codeVerifier);
            sessionStorage.setItem('ms_oauth_state', state);

            // Build authorization URL
            const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
            authUrl.searchParams.set('client_id', AZURE_CLIENT_ID);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('redirect_uri', AZURE_REDIRECT_URI);
            authUrl.searchParams.set('scope', [...GRAPH_SCOPES, 'openid', 'profile', 'offline_access'].join(' '));
            authUrl.searchParams.set('response_mode', 'query');
            authUrl.searchParams.set('state', state);
            authUrl.searchParams.set('code_challenge', codeChallenge);
            authUrl.searchParams.set('code_challenge_method', 'S256');
            authUrl.searchParams.set('prompt', 'select_account');

            // In Electron, use a dedicated OAuth window so app state (open PDF/export flow) is preserved.
            if (window?.electronAPI?.openOAuthWindow) {
                const oauthResult = await window.electronAPI.openOAuthWindow(authUrl.toString(), AZURE_REDIRECT_URI);
                if (!oauthResult?.success || !oauthResult?.url) {
                    throw new Error(oauthResult?.error || 'Microsoft sign-in was cancelled');
                }

                const callbackUrl = new URL(oauthResult.url);
                const callbackError = callbackUrl.searchParams.get('error');
                if (callbackError) {
                    throw new Error(callbackUrl.searchParams.get('error_description') || callbackError);
                }

                const code = callbackUrl.searchParams.get('code');
                const callbackState = callbackUrl.searchParams.get('state');
                if (!code) {
                    throw new Error('Microsoft authentication did not return an authorization code');
                }

                const success = await completeOAuthLogin(code, callbackState);
                clearOAuthSession();
                return success;
            }

            // Browser fallback: full-page redirect flow.
            window.location.href = authUrl.toString();
            return true;
        } catch (err) {
            clearOAuthSession();
            setError(err.message);
            throw err;
        }
    }, [clearOAuthSession, completeOAuthLogin]);

    // Handle OAuth callback (call this from App.jsx on mount)
    const handleOAuthCallback = useCallback(async () => {
        // Prevent duplicate processing
        if (oauthProcessing.current) return false;

        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const errorParam = urlParams.get('error');

        if (errorParam) {
            setError(urlParams.get('error_description') || errorParam);
            clearOAuthSession();
            window.history.replaceState({}, document.title, window.location.pathname);
            return false;
        }

        if (!code) return false;

        oauthProcessing.current = true;

        try {
            const success = await completeOAuthLogin(code, state);
            return success;
        } catch (err) {
            setError(err.message);
            return false;
        } finally {
            clearOAuthSession();
            window.history.replaceState({}, document.title, window.location.pathname);
            oauthProcessing.current = false;
        }
    }, [clearOAuthSession, completeOAuthLogin]);

    // Check for OAuth callback on mount
    useEffect(() => {
        if (user && window.location.search.includes('code=')) {
            handleOAuthCallback();
        }
    }, [user, handleOAuthCallback]);

    const logout = async () => {
        try {
            await removeConnection();
            setAccount(null);
            setIsAuthenticated(false);
            setGraphClient(null);
            setNeedsReconnect(false);
            tokenRef.current = null;
            refreshStateRef.current.cooldownUntil = 0;
            refreshStateRef.current.hardBlockedUntil = 0;
            refreshStateRef.current.lastErrorCode = null;
            writeRefreshBlockUntil(0);
        } catch (err) {
            setError(err.message);
        }
    };

    const value = {
        msalInstance: null,
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
        handleOAuthCallback,
        ensureFreshToken, // Call this before Graph API operations to ensure valid token
    };

    return <MSGraphContext.Provider value={value}>{children}</MSGraphContext.Provider>;
};
