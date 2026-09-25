/**
 * MSGraphContext.jsx — React context for Microsoft Graph / OneDrive authentication.
 *
 * Exports MSGraphProvider + useMSGraph(). Runs a direct PKCE OAuth flow against
 * Azure (login/logout, refresh-token rotation with cooldown/hard-block state),
 * persists tokens in the Supabase `connected_services` table, and exposes
 * graphClient + ensureFreshToken() for callers making Graph API calls.
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { supabase, isSupabaseAvailable } from '../supabaseClient';
import { buildConnectionMarkerRow, buildMainAuthAccount } from '../services/microsoftConnectionMarker';
import {
    cleanMicrosoftReturnUrl,
    microsoftRedirectUriFor,
    microsoftReturnUrlFor,
} from '../utils/microsoftOAuthRouting';

export { microsoftRedirectUriFor, microsoftReturnUrlFor } from '../utils/microsoftOAuthRouting';

// Main-process token custody (PLAN.md Amendment 2026-06-08(b) #5): in Electron,
// sign-in runs in the SYSTEM browser via msal-node in the main process — the only
// surface where Microsoft renders passkeys / Windows Hello / phone sign-in — and
// the MSAL cache there owns all refresh tokens. The renderer only ever holds a
// short-lived access token. The legacy embedded PKCE flow below remains the
// fallback for the web build and for legacy rows not yet migrated.
const isMainAuthAvailable = () =>
    typeof window !== 'undefined' && Boolean(window.electronAPI?.microsoftSignIn);

export const MSGraphContext = createContext({});

// Microsoft Graph API scopes needed for OneDrive
const GRAPH_SCOPES = ['User.Read', 'Files.ReadWrite.All', 'Sites.ReadWrite.All'];

// Azure app client ID
const AZURE_CLIENT_ID = '0da81a9e-2b05-46ee-b826-5efc5114c765';
const MS_OAUTH_REDIRECT_URI_KEY = 'ms_oauth_redirect_uri';
const MS_OAUTH_RETURN_URL_KEY = 'ms_oauth_return_url';
const MS_OAUTH_SURVEY_USER_KEY = 'ms_oauth_survey_user_id';
const MS_REFRESH_COOLDOWN_MS = 60 * 1000;
const MS_HARD_REFRESH_BLOCK_MS = 30 * 60 * 1000;
const MS_REFRESH_BLOCK_UNTIL_KEY = 'ms_refresh_block_until';

const restoreMicrosoftReturnUrl = (returnUrl) => {
    try {
        window.history.replaceState(
            {},
            document.title,
            cleanMicrosoftReturnUrl(returnUrl, window.location.origin),
        );
    } catch {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
};

const readRefreshBlockUntil = (userId) => {
    if (typeof window === 'undefined') return 0;
    try {
        const value = Number(window.sessionStorage.getItem(`${MS_REFRESH_BLOCK_UNTIL_KEY}:${userId}`) || 0);
        return Number.isFinite(value) ? value : 0;
    } catch {
        return 0;
    }
};

const writeRefreshBlockUntil = (value, userId) => {
    if (typeof window === 'undefined') return;
    try {
        if (!value || value <= 0) {
            window.sessionStorage.removeItem(`${MS_REFRESH_BLOCK_UNTIL_KEY}:${userId}`);
            return;
        }
        window.sessionStorage.setItem(`${MS_REFRESH_BLOCK_UNTIL_KEY}:${userId}`, String(value));
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
    const [stateUserId, setStateUserId] = useState(user?.id ?? null);
    const [account, setAccount] = useState(null);
    const [graphClient, setGraphClient] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [connectionRestored, setConnectionRestored] = useState(false);
    const [needsReconnect, setNeedsReconnect] = useState(false);
    const tokenRef = useRef(null);
    // In-memory cache of the connected_services token metadata + account fields.
    // Populated once on restore (and on each refresh/store success) so that
    // ensureFreshToken() — called before every Graph operation, including during
    // 5s live-sync polling — does NOT re-read connected_services from the DB on
    // every invocation. Shape mirrors the fetchStoredTokens() row subset we use:
    //   { refresh_token, access_token, expires_at, tenant_id, account_id,
    //     account_email, account_name }
    const tokenMetadataRef = useRef(null);
    const oauthProcessing = useRef(false); // Prevent duplicate OAuth callback processing
    // Which path owns the tokens this session: 'main' (msal-node in the Electron
    // main process — source of truth) or null/legacy (renderer-managed refresh).
    const custodyRef = useRef(null);
    const refreshStateRef = useRef({
        inFlight: null,
        cooldownUntil: 0,
        hardBlockedUntil: 0,
        lastErrorCode: null
    });
    const authUserId = user?.id ?? null;
    const authScopeRef = useRef({ userId: authUserId, active: true });
    if (authScopeRef.current.userId !== authUserId) {
        authScopeRef.current.active = false;
        authScopeRef.current = { userId: authUserId, active: true };
        tokenRef.current = null;
        tokenMetadataRef.current = null;
        custodyRef.current = null;
    }
    const isCurrentAuthScope = useCallback((scope) => Boolean(
        scope?.active && scope === authScopeRef.current && scope.userId === authUserId
    ), [authUserId]);

    useEffect(() => {
        const scope = { userId: authUserId, active: true };
        authScopeRef.current = scope;
        tokenRef.current = null;
        tokenMetadataRef.current = null;
        custodyRef.current = null;
        refreshStateRef.current = { inFlight: null, cooldownUntil: 0, hardBlockedUntil: 0, lastErrorCode: null };
        oauthProcessing.current = false;
        setAccount(null);
        setGraphClient(null);
        setIsAuthenticated(false);
        setNeedsReconnect(false);
        setError(null);
        setConnectionRestored(false);
        setStateUserId(authUserId);
        return () => {
            scope.active = false;
            if (authScopeRef.current.userId === scope.userId) {
                authScopeRef.current.active = false;
                tokenRef.current = null;
                tokenMetadataRef.current = null;
                custodyRef.current = null;
            }
        };
    }, [authUserId]);

    // Initialize Graph client
    const initializeGraphClient = useCallback(async (accessToken) => {
        const scope = authScopeRef.current;
        if (!scope.userId || !isCurrentAuthScope(scope)) return null;
        tokenRef.current = accessToken;
        const { Client } = await import('@microsoft/microsoft-graph-client');
        if (!isCurrentAuthScope(scope)) return null;
        const client = Client.init({
            authProvider: (done) => {
                if (isCurrentAuthScope(scope) && tokenRef.current) {
                    done(null, tokenRef.current);
                } else {
                    done(new Error('No access token available'), null);
                }
            }
        });
        setGraphClient(client);
        return client;
    }, [isCurrentAuthScope]);

    // Populate the in-memory token metadata cache from a freshly read/written
    // token + account snapshot. Always called alongside a DB read or write so
    // the cache stays the source of truth for ensureFreshToken().
    const setTokenMetadataCache = useCallback((tokens, accountFields) => {
        if (!tokens?.refresh_token) {
            tokenMetadataRef.current = null;
            return;
        }
        tokenMetadataRef.current = {
            refresh_token: tokens.refresh_token,
            access_token: tokens.access_token,
            expires_at: tokens.expires_at,
            tenant_id: accountFields?.tenant_id ?? null,
            account_id: accountFields?.account_id ?? null,
            account_email: accountFields?.account_email ?? null,
            account_name: accountFields?.account_name ?? null,
        };
    }, []);

    // Adopt a main-process auth result (sign-in or silent restore): the MSAL cache
    // in the Electron main process is now the source of truth; the renderer keeps
    // only the access token, and connected_services is reduced to a NO-TOKEN marker.
    const adoptMainAuthResult = useCallback(async (authResult) => {
        const scope = authScopeRef.current;
        if (!scope.userId || !isCurrentAuthScope(scope)) return false;
        const acct = buildMainAuthAccount(authResult.account || {});
        custodyRef.current = 'main';
        tokenMetadataRef.current = {
            custody: 'main',
            refresh_token: null, // never present in the renderer on this path
            access_token: authResult.accessToken,
            expires_at: authResult.expiresAt,
            tenant_id: acct.tenantId,
            account_id: acct.homeAccountId,
            account_email: acct.username,
            account_name: acct.name,
        };
        setAccount({ username: acct.username, name: acct.name, homeAccountId: acct.homeAccountId });
        setIsAuthenticated(true);
        setNeedsReconnect(false);
        await initializeGraphClient(authResult.accessToken);
        if (!isCurrentAuthScope(scope)) return false;
        refreshStateRef.current.cooldownUntil = 0;
        refreshStateRef.current.hardBlockedUntil = 0;
        refreshStateRef.current.lastErrorCode = null;
        writeRefreshBlockUntil(0, authUserId);
        if (user && isSupabaseAvailable()) {
            try {
                await supabase
                    .from('connected_services')
                    .upsert(buildConnectionMarkerRow({ userId: user.id, account: acct }), { onConflict: 'user_id,service_name' });
            } catch {
                // Marker is best-effort; token custody lives in the main process.
            }
        }
        return true;
    }, [user, initializeGraphClient, isCurrentAuthScope]);

    // Store tokens in Supabase database
    const storeTokens = useCallback(async (tokens, accountInfo) => {
        if (!user || !isSupabaseAvailable()) return false;
        const scope = authScopeRef.current;
        if (!isCurrentAuthScope(scope)) return false;

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

            if (!isCurrentAuthScope(scope)) return false;
            if (!error) {
                // Keep the in-memory cache in lockstep with the persisted row so
                // ensureFreshToken() can read it without another DB round-trip.
                setTokenMetadataCache(tokens, {
                    tenant_id: accountInfo.tenantId,
                    account_id: accountInfo.homeAccountId,
                    account_email: accountInfo.username,
                    account_name: accountInfo.name,
                });
            }
            return !error;
        } catch (err) {
            return false;
        }
    }, [user, setTokenMetadataCache, isCurrentAuthScope]);

    // Fetch stored tokens from database
    const fetchStoredTokens = useCallback(async () => {
        if (!user || !isSupabaseAvailable()) return null;
        const scope = authScopeRef.current;
        if (!isCurrentAuthScope(scope)) return null;

        try {
            const { data, error } = await supabase
                .from('connected_services')
                .select('*')
                .eq('user_id', user.id)
                .eq('service_name', 'microsoft')
                .maybeSingle();

            if (!isCurrentAuthScope(scope) || error || !data) return null;
            return data;
        } catch (err) {
            return null;
        }
    }, [user, isCurrentAuthScope]);

    // Refresh access token using refresh token
    const refreshAccessToken = useCallback(async (refreshToken, options = {}) => {
        if (!refreshToken) return null;
        const scope = authScopeRef.current;
        if (!isCurrentAuthScope(scope)) return null;

        const state = refreshStateRef.current;
        const nowMs = Date.now();
        const persistedBlockedUntil = readRefreshBlockUntil(authUserId);
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
                if (!isCurrentAuthScope(scope)) return null;

                if (!response.ok) {
                    let errorPayload = null;
                    try {
                        errorPayload = await response.json();
                    } catch {
                        errorPayload = null;
                    }
                    if (!isCurrentAuthScope(scope)) return null;

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
                        writeRefreshBlockUntil(blockUntil, authUserId);
                        setNeedsReconnect(true);
                        setIsAuthenticated(false);
                        setGraphClient(null);
                        tokenRef.current = null;
                        tokenMetadataRef.current = null;

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
                if (!isCurrentAuthScope(scope)) return null;
                state.cooldownUntil = 0;
                state.hardBlockedUntil = 0;
                state.lastErrorCode = null;
                writeRefreshBlockUntil(0, authUserId);

                return {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token || refreshToken,
                    id_token: tokens.id_token,
                    expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
                    refresh_reason: options.reason || 'unspecified'
                };
            } catch {
                if (!isCurrentAuthScope(scope)) return null;
                state.cooldownUntil = Date.now() + MS_REFRESH_COOLDOWN_MS;
                return null;
            } finally {
                state.inFlight = null;
            }
        };

        state.inFlight = runRefresh();
        return state.inFlight;
    }, [setGraphClient, setIsAuthenticated, setNeedsReconnect, user, isCurrentAuthScope]);

    // Remove connection
    const removeConnection = useCallback(async () => {
        if (!user || !isSupabaseAvailable()) return;
        if (!isCurrentAuthScope(authScopeRef.current)) return;

        try {
            await supabase
                .from('connected_services')
                .delete()
                .eq('user_id', user.id)
                .eq('service_name', 'microsoft');
        } catch (err) {
            // Silently fail
        }
    }, [user, isCurrentAuthScope]);

    // Update last_used timestamp
    const updateLastUsed = useCallback(async () => {
        if (!user || !isSupabaseAvailable()) return;
        if (!isCurrentAuthScope(authScopeRef.current)) return;

        try {
            await supabase
                .from('connected_services')
                .update({ last_used_at: new Date().toISOString() })
                .eq('user_id', user.id)
                .eq('service_name', 'microsoft');
        } catch (err) {
            // Silently fail
        }
    }, [user, isCurrentAuthScope]);

    // Restore connection on mount
    useEffect(() => {
        let isMounted = true;
        const scope = authScopeRef.current;
        const isCurrent = () => isMounted && isCurrentAuthScope(scope);

        const restoreConnection = async () => {
            if (!user) {
                setIsLoading(false);
                setConnectionRestored(true);
                return;
            }

            setIsLoading(true);

            try {
                const storedData = await fetchStoredTokens();
                if (!isCurrent()) return;
                // Main-process custody first: if the MSAL cache (system-browser
                // sign-in) already holds an account, restore from it and ignore
                // any legacy renderer-managed tokens. Legacy rows keep working
                // below until the first system-browser sign-in migrates them.
                if (isMainAuthAvailable()) {
                    try {
                        const status = await window.electronAPI.microsoftAuthStatus();
                        if (!isCurrent()) return;
                        // The device-wide MSAL cache is not evidence that THIS
                        // Survey account linked it. Only restore its exact link.
                        if (status?.signedIn && storedData?.is_connected && storedData.account_id
                            && storedData.account_id === status.account?.homeAccountId) {
                            let res = await window.electronAPI.microsoftGetAccessToken();
                            if (!isCurrent()) return;
                            if (!res?.success && !res?.needsInteraction) {
                                // One retry for transient failures (network blip) before
                                // surfacing reconnect — never lock out on a single miss.
                                res = await window.electronAPI.microsoftGetAccessToken();
                                if (!isCurrent()) return;
                            }
                            if (res?.success && res.accessToken
                                && res.account?.homeAccountId === storedData.account_id) {
                                if (isCurrent()) await adoptMainAuthResult(res);
                                if (!isCurrent()) return;
                                setIsLoading(false);
                                setConnectionRestored(true);
                                return;
                            }
                            // The MSAL cache HAS this account but no token could be
                            // acquired. Surface reconnect against the cached account
                            // here — do NOT fall through, where the no-token marker
                            // row would be misread as a missing legacy connection.
                            if (isCurrent()) {
                                custodyRef.current = 'main';
                                const acct = buildMainAuthAccount(status.account || {});
                                setAccount({ username: acct.username, name: acct.name, homeAccountId: acct.homeAccountId });
                                setNeedsReconnect(true);
                                setIsAuthenticated(false);
                                setGraphClient(null);
                            }
                            setIsLoading(false);
                            setConnectionRestored(true);
                            return;
                        }
                    } catch {
                        // Fall through to the legacy restore path.
                    }
                }
                if (!isCurrent()) return;

                if (!storedData?.is_connected || !storedData?.metadata?.refresh_token) {
                    if (isCurrent()) {
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
                // Seed the in-memory cache from this one restore read so subsequent
                // ensureFreshToken() calls don't have to re-read connected_services.
                setTokenMetadataCache(metadata, {
                    tenant_id: metadata.tenant_id,
                    account_id,
                    account_email,
                    account_name,
                });
                const refreshState = refreshStateRef.current;
                const nowMs = Date.now();
                const persistedBlockedUntil = readRefreshBlockUntil(authUserId);
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
                    if (!isCurrent()) return;

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
                    if (!isCurrent()) return;
                }

                if (isCurrent()) {
                    setAccount({ username: account_email, name: account_name, homeAccountId: account_id });
                    setIsAuthenticated(true);
                    setNeedsReconnect(false);
                    await initializeGraphClient(currentAccessToken);
                }
            } catch (err) {
                if (isCurrent()) setError(err.message);
            } finally {
                if (isCurrent()) {
                    setIsLoading(false);
                    setConnectionRestored(true);
                }
            }
        };

        restoreConnection();
        return () => { isMounted = false; };
    }, [user, fetchStoredTokens, storeTokens, refreshAccessToken, initializeGraphClient, setTokenMetadataCache, adoptMainAuthResult, isCurrentAuthScope]);

    // Periodic token refresh - refresh every 10 minutes to stay ahead of expiry
    // Microsoft access tokens typically last 60-90 minutes, but can be revoked anytime
    useEffect(() => {
        if (!isAuthenticated || !user || needsReconnect) return;
        // Main custody: silent refresh happens on demand in the main process
        // (ensureFreshToken → msauth:getAccessToken); no renderer interval needed.
        if (custodyRef.current === 'main') return;

        const refreshInterval = setInterval(async () => {
            const scope = authScopeRef.current;
            if (!isCurrentAuthScope(scope)) return;
            const state = refreshStateRef.current;
            const nowMs = Date.now();
            const persistedBlockedUntil = readRefreshBlockUntil(authUserId);
            if (persistedBlockedUntil > state.hardBlockedUntil) {
                state.hardBlockedUntil = persistedBlockedUntil;
            }
            if (state.hardBlockedUntil > nowMs || state.cooldownUntil > nowMs) {
                return;
            }

            const storedData = await fetchStoredTokens();
            if (!isCurrentAuthScope(scope)) return;
            if (storedData?.metadata?.refresh_token) {
                const newTokens = await refreshAccessToken(storedData.metadata.refresh_token, { reason: 'interval' });
                if (!isCurrentAuthScope(scope)) return;
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
    }, [isAuthenticated, user, needsReconnect, fetchStoredTokens, refreshAccessToken, storeTokens, isCurrentAuthScope]);

    // Ensure fresh token before API operations - call this before making Graph API calls
    const ensureFreshToken = useCallback(async () => {
        if (!user || needsReconnect) return false;
        const scope = authScopeRef.current;
        if (!isCurrentAuthScope(scope)) return false;

        // Main-process custody: the MSAL cache in the Electron main process owns
        // refresh; ask it for a valid access token. Short-circuit while the current
        // one is comfortably fresh (same 10-minute buffer as the legacy path).
        if (custodyRef.current === 'main' && isMainAuthAvailable()) {
            const meta = tokenMetadataRef.current;
            const nowSec = Math.floor(Date.now() / 1000);
            if (tokenRef.current && meta?.expires_at && meta.expires_at > nowSec + 600) {
                return true;
            }
            const res = await window.electronAPI.microsoftGetAccessToken();
            if (!isCurrentAuthScope(scope)) return false;
            if (res?.success && res.account?.homeAccountId !== meta?.account_id) {
                setNeedsReconnect(true);
                setIsAuthenticated(false);
                setGraphClient(null);
                tokenRef.current = null;
                return false;
            }
            if (res?.success && res.accessToken) {
                tokenRef.current = res.accessToken;
                if (tokenMetadataRef.current) {
                    tokenMetadataRef.current = {
                        ...tokenMetadataRef.current,
                        access_token: res.accessToken,
                        expires_at: res.expiresAt,
                    };
                }
                return true;
            }
            if (res?.needsInteraction) {
                setNeedsReconnect(true);
                setIsAuthenticated(false);
                setGraphClient(null);
                tokenRef.current = null;
            }
            return false;
        }

        const state = refreshStateRef.current;
        const nowMs = Date.now();
        const persistedBlockedUntil = readRefreshBlockUntil(authUserId);
        if (persistedBlockedUntil > state.hardBlockedUntil) {
            state.hardBlockedUntil = persistedBlockedUntil;
        }
        if (state.hardBlockedUntil > nowMs || state.cooldownUntil > nowMs) {
            return false;
        }

        // Read token metadata from the in-memory cache. Only fall back to a DB
        // read when the cache is cold (never populated this session) — this
        // eliminates the per-operation connected_services read that otherwise
        // fired on every ensureFreshToken() call (~12/min during live-sync).
        let metadata = tokenMetadataRef.current;
        if (!metadata) {
            const storedData = await fetchStoredTokens();
            if (!isCurrentAuthScope(scope)) return false;
            if (storedData?.metadata) {
                setTokenMetadataCache(storedData.metadata, {
                    tenant_id: storedData.metadata.tenant_id,
                    account_id: storedData.account_id,
                    account_email: storedData.account_email,
                    account_name: storedData.account_name,
                });
                metadata = tokenMetadataRef.current;
            }
        }

        if (!metadata?.refresh_token) {
            setNeedsReconnect(true);
            setIsAuthenticated(false);
            setGraphClient(null);
            tokenRef.current = null;
            return false;
        }

        const now = Math.floor(Date.now() / 1000);

        // Refresh if token expires within 10 minutes
        if (!metadata.expires_at || metadata.expires_at < now + 600) {
            const newTokens = await refreshAccessToken(metadata.refresh_token, { reason: 'ensure_fresh' });
            if (!isCurrentAuthScope(scope)) return false;
            if (newTokens) {
                tokenRef.current = newTokens.access_token;
                await storeTokens(newTokens, {
                    homeAccountId: metadata.account_id,
                    username: metadata.account_email,
                    name: metadata.account_name,
                    tenantId: metadata.tenant_id,
                });
                if (!isCurrentAuthScope(scope)) return false;
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
    }, [user, needsReconnect, fetchStoredTokens, refreshAccessToken, storeTokens, setTokenMetadataCache, isCurrentAuthScope]);

    const clearOAuthSession = useCallback(() => {
        sessionStorage.removeItem('ms_pkce_verifier');
        sessionStorage.removeItem('ms_oauth_state');
        sessionStorage.removeItem(MS_OAUTH_REDIRECT_URI_KEY);
        sessionStorage.removeItem(MS_OAUTH_RETURN_URL_KEY);
        sessionStorage.removeItem(MS_OAUTH_SURVEY_USER_KEY);
    }, []);

    const completeOAuthLogin = useCallback(async (code, returnedState) => {
        const scope = authScopeRef.current;
        if (!scope.userId || !isCurrentAuthScope(scope)) return false;
        const storedState = sessionStorage.getItem('ms_oauth_state');
        const codeVerifier = sessionStorage.getItem('ms_pkce_verifier');
        if (sessionStorage.getItem(MS_OAUTH_SURVEY_USER_KEY) !== scope.userId) {
            throw new Error('The Survey account changed. Please start Microsoft sign-in again.');
        }

        if (returnedState !== storedState) {
            throw new Error('OAuth state mismatch - possible CSRF attack');
        }

        if (!codeVerifier) {
            throw new Error('OAuth session expired - please try again');
        }

        const redirectUri = sessionStorage.getItem(MS_OAUTH_REDIRECT_URI_KEY)
            || microsoftRedirectUriFor();

        // Exchange code for tokens using the exact redirect URI that started
        // this PKCE transaction. It can be production /mobile, web root, or a
        // registered local development origin — never a hardcoded localhost.
        const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: AZURE_CLIENT_ID,
                scope: [...GRAPH_SCOPES, 'openid', 'profile', 'offline_access'].join(' '),
                code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
                code_verifier: codeVerifier,
            }).toString(),
        });
        if (!isCurrentAuthScope(scope)) return false;

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
        if (!isCurrentAuthScope(scope)) return false;

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
        if (!isCurrentAuthScope(scope)) return false;
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
        await initializeGraphClient(tokens.access_token);
        if (!isCurrentAuthScope(scope)) return false;
        refreshStateRef.current.cooldownUntil = 0;
        refreshStateRef.current.hardBlockedUntil = 0;
        refreshStateRef.current.lastErrorCode = null;
        writeRefreshBlockUntil(0, authUserId);

        return true;
    }, [storeTokens, initializeGraphClient, isCurrentAuthScope]);

    // Login using direct OAuth flow (not Supabase linkIdentity)
    const login = useCallback(async () => {
        if (!authUserId || !isCurrentAuthScope(authScopeRef.current)) return false;
        authScopeRef.current.active = false;
        const scope = { userId: authUserId, active: true };
        authScopeRef.current = scope;
        tokenRef.current = null;
        tokenMetadataRef.current = null;
        custodyRef.current = null;
        oauthProcessing.current = false;
        refreshStateRef.current = { inFlight: null, cooldownUntil: 0, hardBlockedUntil: 0, lastErrorCode: null };
        setAccount(null);
        setGraphClient(null);
        setIsAuthenticated(false);
        try {
            setError(null);

            // Preferred (Electron): system-browser sign-in with main-process token
            // custody — the only surface where Microsoft offers passkeys, Windows
            // Hello / device PIN, and phone sign-in. The embedded flow below stays
            // as the web-build fallback.
            if (isMainAuthAvailable()) {
                const result = await window.electronAPI.microsoftSignIn();
                if (!isCurrentAuthScope(scope)) return false;
                if (!result?.success) {
                    throw new Error(result?.error || 'Microsoft sign-in was cancelled');
                }
                return await adoptMainAuthResult(result);
            }

            // Generate PKCE code verifier and challenge
            const generatePKCE = () => {
                const array = new Uint8Array(32);
                crypto.getRandomValues(array);
                return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
            };

            const codeVerifier = generatePKCE();
            const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
            if (!isCurrentAuthScope(scope)) return false;
            const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            const state = crypto.randomUUID();
            const redirectUri = microsoftRedirectUriFor();

            // Store PKCE verifier for later use
            sessionStorage.setItem('ms_pkce_verifier', codeVerifier);
            sessionStorage.setItem('ms_oauth_state', state);
            sessionStorage.setItem(MS_OAUTH_REDIRECT_URI_KEY, redirectUri);
            sessionStorage.setItem(MS_OAUTH_RETURN_URL_KEY, microsoftReturnUrlFor());
            sessionStorage.setItem(MS_OAUTH_SURVEY_USER_KEY, authUserId);

            // Build authorization URL
            const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
            authUrl.searchParams.set('client_id', AZURE_CLIENT_ID);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('redirect_uri', redirectUri);
            authUrl.searchParams.set('scope', [...GRAPH_SCOPES, 'openid', 'profile', 'offline_access'].join(' '));
            authUrl.searchParams.set('response_mode', 'query');
            authUrl.searchParams.set('state', state);
            authUrl.searchParams.set('code_challenge', codeChallenge);
            authUrl.searchParams.set('code_challenge_method', 'S256');
            authUrl.searchParams.set('prompt', 'select_account');

            // In Electron, use a dedicated OAuth window so app state (open PDF/export flow) is preserved.
            if (window?.electronAPI?.openOAuthWindow) {
                const oauthResult = await window.electronAPI.openOAuthWindow(authUrl.toString(), redirectUri);
                if (!isCurrentAuthScope(scope)) return false;
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
                if (!isCurrentAuthScope(scope)) return false;
                clearOAuthSession();
                return success;
            }

            // Browser fallback: full-page redirect flow.
            window.location.href = authUrl.toString();
            return true;
        } catch (err) {
            if (!isCurrentAuthScope(scope)) return false;
            clearOAuthSession();
            setError(err.message);
            throw err;
        }
    }, [clearOAuthSession, completeOAuthLogin, adoptMainAuthResult, isCurrentAuthScope]);

    // Handle OAuth callback (call this from App.jsx on mount)
    const handleOAuthCallback = useCallback(async () => {
        const scope = authScopeRef.current;
        if (!scope.userId || !isCurrentAuthScope(scope)) return false;
        // Prevent duplicate processing
        if (oauthProcessing.current) return false;

        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const errorParam = urlParams.get('error');
        const returnUrl = sessionStorage.getItem(MS_OAUTH_RETURN_URL_KEY) || microsoftReturnUrlFor();

        if (errorParam) {
            setError(urlParams.get('error_description') || errorParam);
            clearOAuthSession();
            restoreMicrosoftReturnUrl(returnUrl);
            return false;
        }

        if (!code) return false;

        oauthProcessing.current = true;

        try {
            const success = await completeOAuthLogin(code, state);
            return success;
        } catch (err) {
            if (isCurrentAuthScope(scope)) setError(err.message);
            return false;
        } finally {
            if (isCurrentAuthScope(scope)) {
                clearOAuthSession();
                restoreMicrosoftReturnUrl(returnUrl);
                oauthProcessing.current = false;
            }
        }
    }, [clearOAuthSession, completeOAuthLogin, isCurrentAuthScope]);

    // Check for OAuth callback on mount
    useEffect(() => {
        if (user && window.location.search.includes('code=')) {
            handleOAuthCallback();
        }
    }, [user, handleOAuthCallback]);

    const logout = async () => {
        if (!isCurrentAuthScope(authScopeRef.current)) return;
        authScopeRef.current.active = false;
        const scope = { userId: authUserId, active: true };
        authScopeRef.current = scope;
        tokenRef.current = null;
        tokenMetadataRef.current = null;
        custodyRef.current = null;
        setAccount(null);
        setIsAuthenticated(false);
        setGraphClient(null);
        setNeedsReconnect(false);
        try {
            if (isMainAuthAvailable()) {
                try {
                    await window.electronAPI.microsoftSignOut(); // clears the main-process MSAL cache
                } catch {
                    // Best-effort; the marker row below is removed regardless.
                }
            }
            if (!isCurrentAuthScope(scope)) return;
            custodyRef.current = null;
            await removeConnection();
            if (!isCurrentAuthScope(scope)) return;
            setAccount(null);
            setIsAuthenticated(false);
            setGraphClient(null);
            setNeedsReconnect(false);
            tokenRef.current = null;
            tokenMetadataRef.current = null;
            refreshStateRef.current.cooldownUntil = 0;
            refreshStateRef.current.hardBlockedUntil = 0;
            refreshStateRef.current.lastErrorCode = null;
            writeRefreshBlockUntil(0, authUserId);
        } catch (err) {
            if (isCurrentAuthScope(scope)) setError(err.message);
        }
    };

    // Capability-gating signals (Amendment 2026-06-08(b)): the signed-in
    // account's tenant id (id-token `tid`) and which path holds token custody —
    // 'main' (system-browser sign-in, main-process MSAL), 'legacy' (renderer
    // PKCE / web build) or null (signed out). Sampled from refs at call time so
    // lazy consumers (the Live Sync gate) read them on a click without a
    // re-render subscription. Both custody paths populate tokenMetadataRef
    // with tenant_id, so this works for main-custody AND legacy connections.
    const getAuthSignals = useCallback(() => ({
        tenantId: tokenMetadataRef.current?.tenant_id ?? null,
        custody: custodyRef.current === 'main'
            ? 'main'
            : (tokenMetadataRef.current ? 'legacy' : null),
    }), []);

    const stateIsCurrent = stateUserId === authUserId;
    const value = {
        msalInstance: null,
        account: stateIsCurrent ? account : null,
        graphClient: stateIsCurrent ? graphClient : null,
        isAuthenticated: stateIsCurrent && isAuthenticated,
        isLoading: stateIsCurrent ? isLoading : Boolean(authUserId),
        error: stateIsCurrent ? error : null,
        login,
        logout,
        updateLastUsed,
        connectionRestored: stateIsCurrent && connectionRestored,
        needsReconnect: stateIsCurrent && needsReconnect,
        handleOAuthCallback,
        ensureFreshToken, // Call this before Graph API operations to ensure valid token
        getAuthSignals, // tenant id + token custody, sampled at call time (capability gating)
    };

    return <MSGraphContext.Provider value={value}>{children}</MSGraphContext.Provider>;
};
