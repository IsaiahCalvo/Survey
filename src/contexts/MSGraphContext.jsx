import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Client } from '@microsoft/microsoft-graph-client';
import { useAuth } from './AuthContext';
import { supabase, isSupabaseAvailable } from '../supabaseClient';

const MSGraphContext = createContext({});

// Microsoft Graph API scopes needed for OneDrive
const GRAPH_SCOPES = ['User.Read', 'Files.ReadWrite.All', 'Sites.ReadWrite.All'];

// Azure app client ID
const AZURE_CLIENT_ID = '0da81a9e-2b05-46ee-b826-5efc5114c765';
const AZURE_REDIRECT_URI = 'http://localhost:5173';

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
    const refreshAccessToken = useCallback(async (refreshToken) => {
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

            if (!response.ok) return null;

            const tokens = await response.json();
            return {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token || refreshToken,
                id_token: tokens.id_token,
                expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
            };
        } catch (err) {
            return null;
        }
    }, []);

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
                        setAccount(null);
                        setNeedsReconnect(storedData?.is_connected && !storedData?.metadata?.refresh_token);
                    }
                    setIsLoading(false);
                    setConnectionRestored(true);
                    return;
                }

                const { metadata, account_email, account_name, account_id } = storedData;
                const { access_token, refresh_token, expires_at } = metadata;

                // Check if token needs refresh
                const now = Math.floor(Date.now() / 1000);
                let currentAccessToken = access_token;

                if (!expires_at || expires_at < now + 300) {
                    const newTokens = await refreshAccessToken(refresh_token);

                    if (!newTokens) {
                        if (isMounted) {
                            setNeedsReconnect(true);
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

    // Periodic token refresh
    useEffect(() => {
        if (!isAuthenticated || !user) return;

        const refreshInterval = setInterval(async () => {
            const storedData = await fetchStoredTokens();
            if (storedData?.metadata?.refresh_token) {
                const newTokens = await refreshAccessToken(storedData.metadata.refresh_token);
                if (newTokens) {
                    tokenRef.current = newTokens.access_token;
                    await storeTokens(newTokens, {
                        homeAccountId: storedData.account_id,
                        username: storedData.account_email,
                        name: storedData.account_name,
                        tenantId: storedData.metadata.tenant_id,
                    });
                } else {
                    setNeedsReconnect(true);
                }
            }
        }, 30 * 60 * 1000);

        return () => clearInterval(refreshInterval);
    }, [isAuthenticated, user, fetchStoredTokens, refreshAccessToken, storeTokens]);

    // Login using direct OAuth flow (not Supabase linkIdentity)
    const login = async () => {
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

            // Redirect to Microsoft login
            window.location.href = authUrl.toString();
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

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
            window.history.replaceState({}, document.title, window.location.pathname);
            return false;
        }

        if (!code) return false;

        oauthProcessing.current = true;

        const storedState = sessionStorage.getItem('ms_oauth_state');
        const codeVerifier = sessionStorage.getItem('ms_pkce_verifier');

        if (state !== storedState) {
            setError('OAuth state mismatch - possible CSRF attack');
            window.history.replaceState({}, document.title, window.location.pathname);
            oauthProcessing.current = false;
            return false;
        }

        if (!codeVerifier) {
            setError('OAuth session expired - please try again');
            window.history.replaceState({}, document.title, window.location.pathname);
            oauthProcessing.current = false;
            return false;
        }

        try {
            // Exchange code for tokens
            const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
            const tokenResponse = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: AZURE_CLIENT_ID,
                    scope: [...GRAPH_SCOPES, 'openid', 'profile', 'offline_access'].join(' '),
                    code: code,
                    redirect_uri: AZURE_REDIRECT_URI,
                    grant_type: 'authorization_code',
                    code_verifier: codeVerifier,
                }).toString(),
            });

            if (!tokenResponse.ok) {
                const errorData = await tokenResponse.json();
                throw new Error(errorData.error_description || 'Token exchange failed');
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

            if (stored) {
                setAccount({
                    username: accountInfo.username,
                    name: accountInfo.name,
                    homeAccountId: accountInfo.homeAccountId,
                });
                setIsAuthenticated(true);
                setNeedsReconnect(false);
                initializeGraphClient(tokens.access_token);
            }

            // Clean up
            sessionStorage.removeItem('ms_pkce_verifier');
            sessionStorage.removeItem('ms_oauth_state');
            window.history.replaceState({}, document.title, window.location.pathname);
            oauthProcessing.current = false;

            return true;
        } catch (err) {
            setError(err.message);
            sessionStorage.removeItem('ms_pkce_verifier');
            sessionStorage.removeItem('ms_oauth_state');
            window.history.replaceState({}, document.title, window.location.pathname);
            oauthProcessing.current = false;
            return false;
        }
    }, [storeTokens, initializeGraphClient]);

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
    };

    return <MSGraphContext.Provider value={value}>{children}</MSGraphContext.Provider>;
};
