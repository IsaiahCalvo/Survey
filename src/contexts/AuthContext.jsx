/**
 * AuthContext.jsx — Supabase auth provider and the app-wide useAuth() hook.
 *
 * Exports AuthContext, the useAuth() hook, and the AuthProvider that owns
 * user/session/loading plus the subscription tier. Boots the initial session
 * (with corrupted-token recovery and a DEV-only auto-login), listens to
 * onAuthStateChange, polls/refetches the tier (focus + every 5 min), and
 * exposes signUp/signIn/signInWithGoogle/signInWithSSO/signOut/resetPassword/
 * resendConfirmation/updatePassword/updateProfile plus derived `tier`/
 * `features` gating flags.
 * Also pushes developer-mode state to the Electron main process.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  supabase,
  isSupabaseAvailable,
  getSupabaseSession,
  recoverSupabaseAuthSession,
} from '../supabaseClient';
import { requestAccountDeletion, unlinkOAuthProvider } from '../utils/accountPlatform';
import { startDocumentHistoryReplay } from '../services/documentHistoryReplay.js';

export const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

const authDebug = (...args) => {
  if (typeof window === 'undefined' || window.__AUTH_DEBUG !== true) return;
  try { console.debug(...args); } catch { /* ignore debug logging failures */ }
};

const DEV_AUTH_BOOTSTRAP_TOKEN = typeof __DEV_AUTH_BOOTSTRAP_TOKEN__ === 'string'
  ? __DEV_AUTH_BOOTSTRAP_TOKEN__
  : '';
const DEV_AUTH_RELAY_ENABLED = import.meta.env.DEV
  && typeof __DEV_AUTH_RELAY_ENABLED__ === 'boolean'
  && __DEV_AUTH_RELAY_ENABLED__;
const DEV_AUTH_RELAY_EMAIL = DEV_AUTH_RELAY_ENABLED
  && typeof __DEV_AUTH_RELAY_EMAIL__ === 'string'
  ? __DEV_AUTH_RELAY_EMAIL__.trim()
  : '';
const DEV_AUTH_AUTO_LOGIN_SUPPRESSED_KEY = 'survey:dev-auth:auto-login-suppressed';

const devAuthRelayAllows = (email) => DEV_AUTH_RELAY_ENABLED
  && Boolean(DEV_AUTH_RELAY_EMAIL)
  && String(email || '').trim().toLowerCase() === DEV_AUTH_RELAY_EMAIL.toLowerCase();

const isDevAuthAutoLoginSuppressed = () => {
  if (!DEV_AUTH_RELAY_ENABLED || typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(DEV_AUTH_AUTO_LOGIN_SUPPRESSED_KEY) === '1';
  } catch {
    return false;
  }
};

const setDevAuthAutoLoginSuppressed = (suppressed) => {
  if (!DEV_AUTH_RELAY_ENABLED || typeof window === 'undefined') return;
  try {
    if (suppressed) window.localStorage?.setItem(DEV_AUTH_AUTO_LOGIN_SUPPRESSED_KEY, '1');
    else window.localStorage?.removeItem(DEV_AUTH_AUTO_LOGIN_SUPPRESSED_KEY);
  } catch {
    console.warn('[dev-auth] could not persist owner auto-login preference');
  }
};

const isCaptchaBlockedAuthError = (error) => {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || error || '').toLowerCase();
  return code.includes('captcha')
    || message.includes('captcha')
    || message.includes('captcha_token')
    || message.includes('human');
};

const requestNativeGoogleIdToken = () => {
  if (typeof window === 'undefined' || typeof window.ReactNativeWebView?.postMessage !== 'function') {
    return null;
  }

  const requestId = typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `google-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    let timeoutId;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('survey-native-google-auth-result', handleResult);
    };
    const handleResult = (event) => {
      const result = event?.detail;
      if (!result || result.requestId !== requestId) return;
      cleanup();
      if (result.cancelled) {
        resolve({ cancelled: true });
      } else if (result.ok && typeof result.idToken === 'string' && result.idToken) {
        resolve({ idToken: result.idToken });
      } else {
        reject(new Error(result.error || 'Google sign-in failed.'));
      }
    };

    window.addEventListener('survey-native-google-auth-result', handleResult);
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Google sign-in timed out. Please try again.'));
    }, 120_000);
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'survey:google-sign-in',
      requestId,
    }));
  });
};

const runDevAuthBootstrap = async (email) => {
  if (!import.meta.env.DEV || !DEV_AUTH_BOOTSTRAP_TOKEN || !devAuthRelayAllows(email)) {
    return null;
  }
  try {
    const response = await fetch('/__dev-auth/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-Auth-Bootstrap': DEV_AUTH_BOOTSTRAP_TOKEN,
      },
      body: JSON.stringify({ email }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `dev auth bootstrap failed (${response.status})`);
    }
    if (!payload?.token_hash) {
      throw new Error('dev auth bootstrap response missing token_hash');
    }
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: payload.token_hash,
      type: payload.type || 'magiclink',
    });
    if (verifyError) throw verifyError;
    return data?.session || null;
  } catch (bootstrapError) {
    console.warn('[dev-auto-login] captcha fallback failed ' + JSON.stringify({
      message: bootstrapError?.message || String(bootstrapError),
    }));
    return null;
  }
};

const runDevAuthBootstrapIfCaptchaBlocked = async (error, email) => {
  if (!isCaptchaBlockedAuthError(error)) return null;
  return runDevAuthBootstrap(email);
};

// In-flight subscription-tier reads keyed by userId. The two BOOT paths
// (finishAuthBoot + onAuthStateChange) can fire fetchSubscriptionTier for the
// same user within ~2ms of each other — this collapses that pair into one
// network read. Deliberate refreshes (window focus, 5-min interval, manual
// refreshSubscriptionTier) do NOT coalesce, so a mid-session Stripe upgrade is
// always picked up. In-flight only: the entry is removed as soon as the read
// settles, so nothing stale is ever cached. See KAL-251.
const inFlightTierByUser = new Map();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionTier, setSubscriptionTier] = useState('free');
  const [loadingTier, setLoadingTier] = useState(true);

  // KAL-token-refresh: the live `user` object reference, kept in a ref so the
  // onAuthStateChange handler (created once, no deps) can compare an incoming
  // session's user against what's already in state WITHOUT re-subscribing.
  //
  // Why this exists: Supabase auto-refreshes the JWT roughly every hour and
  // fires TOKEN_REFRESHED with a brand-new session object whose `user` is a
  // fresh reference but identical in content (same id/email/metadata). If we
  // blindly setUser() on every such event, the context value gets a new `user`
  // reference, which propagates as a new prop to PDFViewer and re-runs the
  // document open/hydrate path on an already-open doc (re-resolve + re-paint +
  // "sync push count:0") — the user sees the viewer reload for no reason.
  // Adobe keeps the loaded PDF in memory across token refresh; so should we.
  // We only swap `user` when its identity actually changes; the JWT itself
  // lives on `session`, which we keep fresh below.
  const userRef = useRef(null);
  const replaySessionRef = useRef(session);
  const replayLoadingRef = useRef(loading);
  replaySessionRef.current = session;
  replayLoadingRef.current = loading;

  // Returns true when the incoming auth user differs from the one already in
  // state in any way a consumer keys on (id / email / user_metadata). A pure
  // JWT refresh leaves all three unchanged, so it returns false → no setUser.
  const userIdentityChanged = (prev, next) => {
    if (!prev || !next) return prev !== next; // null<->user transitions matter
    if (prev.id !== next.id) return true;
    if (prev.email !== next.email) return true;
    try {
      if (JSON.stringify(prev.user_metadata) !== JSON.stringify(next.user_metadata)) {
        return true;
      }
    } catch {
      return true; // if metadata can't be compared, be safe and update
    }
    return false;
  };

  const setUserIfIdentityChanged = (nextUser) => {
    if (userIdentityChanged(userRef.current, nextUser)) {
      userRef.current = nextUser ?? null;
      setUser(nextUser ?? null);
    }
    // else: pure token refresh — keep the stable `user` reference so an
    // already-open document does not re-resolve / re-download.
  };

  const getDevAutoLoginCredentials = () => {
    const devOverride = (() => {
      if (!import.meta.env.DEV || typeof window === 'undefined') return {};
      try {
        const raw = window.localStorage?.getItem('__fix20AuthOverride');
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.email && parsed?.password) {
          return { email: parsed.email, password: parsed.password };
        }
      } catch {
        // Ignore malformed dev-only harness state.
      }
      return {};
    })();
    return {
      email: DEV_AUTH_RELAY_ENABLED
        ? DEV_AUTH_RELAY_EMAIL
        : devOverride.email || import.meta.env.VITE_DEV_AUTO_LOGIN_EMAIL,
      password: devOverride.password || import.meta.env.VITE_DEV_AUTO_LOGIN_PASSWORD,
    };
  };

  const runDevAutoLoginIfNeeded = async (session) => {
    // A manual Sign out is authoritative. Keep both the signed-out state and
    // any subsequently chosen non-owner session until the user explicitly
    // signs in as the configured dev owner again.
    if (isDevAuthAutoLoginSuppressed()) {
      authDebug('[dev-auto-login] skipped after explicit sign-out');
      return session;
    }

    const { email: devEmail, password: devPassword } = getDevAutoLoginCredentials();
    authDebug('[dev-auto-login] boot ' + JSON.stringify({
      hasDevEmail: !!devEmail,
      devEmailHint: devEmail ? devEmail.slice(0, 4) + '***' : null,
      hasDevPassword: !!devPassword,
      hasCachedSession: !!session,
      cachedSessionEmail: session?.user?.email || null,
      cachedSessionExpiresAt: session?.expires_at || null
    }));

    let needsAutoLogin = !session;
    const hasConfiguredDevAuth = Boolean(devEmail && (devPassword || devAuthRelayAllows(devEmail)));
    if (session && hasConfiguredDevAuth) {
      const cachedEmail = session?.user?.email;
      if (cachedEmail && cachedEmail.toLowerCase() !== devEmail.toLowerCase()) {
        authDebug('[dev-auto-login] cached session is for a different user, overriding ' + JSON.stringify({
          cachedEmail, devEmail
        }));
        needsAutoLogin = true;
        try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
        session = null;
      } else {
        authDebug('[dev-auto-login] cached session matches dev email, keeping it');
      }
    }

    authDebug('[dev-auto-login] decision ' + JSON.stringify({
      needsAutoLogin,
      willAttemptSignIn: needsAutoLogin && hasConfiguredDevAuth
    }));
    if (!needsAutoLogin) return session;

    if (devAuthRelayAllows(devEmail)) {
      const bootstrapSession = await runDevAuthBootstrap(devEmail);
      if (bootstrapSession) {
        authDebug('[dev-auto-login] owner relay OK ' + JSON.stringify({
          userId: bootstrapSession?.user?.id || null,
          email: bootstrapSession?.user?.email || null
        }));
        return bootstrapSession;
      }
      console.warn('[dev-auto-login] owner relay failed; check ~/.config/survey/dev-auth.env and restart Vite.');
    } else if (devEmail && devPassword) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: devEmail,
          password: devPassword
        });
        if (error) {
          const bootstrapSession = await runDevAuthBootstrapIfCaptchaBlocked(error, devEmail);
          if (bootstrapSession) {
            authDebug('[dev-auto-login] captcha fallback OK ' + JSON.stringify({
              userId: bootstrapSession?.user?.id || null,
              email: bootstrapSession?.user?.email || null
            }));
            session = bootstrapSession;
          } else {
            console.warn('[dev-auto-login] sign-in FAILED ' + JSON.stringify({
              code: error.code || null,
              status: error.status || null,
              message: error.message || String(error)
            }));
          }
        } else {
          authDebug('[dev-auto-login] sign-in OK ' + JSON.stringify({
            userId: data?.user?.id || null,
            email: data?.user?.email || null
          }));
          session = data?.session ?? session;
        }
      } catch (err) {
        const bootstrapSession = await runDevAuthBootstrapIfCaptchaBlocked(err, devEmail);
        if (bootstrapSession) {
          authDebug('[dev-auto-login] captcha fallback OK ' + JSON.stringify({
            userId: bootstrapSession?.user?.id || null,
            email: bootstrapSession?.user?.email || null
          }));
          session = bootstrapSession;
        } else {
          console.warn('[dev-auto-login] sign-in THREW ' + JSON.stringify({
            message: err?.message || String(err)
          }));
        }
      }
    } else {
      console.warn('[dev-auto-login] needed sign-in but creds NOT loaded — skipped. Restart the dev server / Electron app to pick up .env.local.');
    }
    return session;
  };

  // Resolve the effective tier string for a user. Returns 'free' on no-row /
  // canceled / error; the active tier on active|trialing. Never throws on a
  // Supabase error (logs + returns 'free'); only an unexpected throw rejects.
  const resolveSubscriptionTier = async (userId) => {
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('tier, status')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching subscription tier:', error);
      return 'free';
    }
    if (data && ['active', 'trialing'].includes(data.status)) {
      // Only allow Pro/Enterprise if subscription is active or trialing.
      return data.tier;
    }
    // No subscription row (free tier — maybeSingle returns null with NO error,
    // unlike .single() which raised PGRST116 and used to log a false "Error
    // fetching subscription tier" on every free-tier boot/focus/5-min refresh),
    // or a canceled/past_due/incomplete subscription -> fall back to free.
    return 'free';
  };

  // Fetch subscription tier from database. `coalesce:true` (the two boot paths)
  // shares a single in-flight read per userId; the focus/interval/manual
  // refreshes call with the default (a fresh read) so Stripe upgrades land.
  const fetchSubscriptionTier = async (userId, { coalesce = false } = {}) => {
    if (!userId || !isSupabaseAvailable()) {
      setSubscriptionTier('free');
      setLoadingTier(false);
      return;
    }

    try {
      let tierPromise;
      if (coalesce && inFlightTierByUser.has(userId)) {
        // Join the boot read already in flight for this user.
        tierPromise = inFlightTierByUser.get(userId);
      } else {
        tierPromise = resolveSubscriptionTier(userId);
        if (coalesce) {
          inFlightTierByUser.set(userId, tierPromise);
          const done = () => {
            if (inFlightTierByUser.get(userId) === tierPromise) {
              inFlightTierByUser.delete(userId);
            }
          };
          tierPromise.then(done, done);
        }
      }
      setSubscriptionTier(await tierPromise);
    } catch (err) {
      console.error('Error:', err);
      setSubscriptionTier('free');
    } finally {
      setLoadingTier(false);
    }
  };

  useEffect(() => {
    if (!isSupabaseAvailable()) {
      setLoading(false);
      setLoadingTier(false);
      return;
    }

    const finishAuthBoot = async (session) => {
      // UX 2026-04-22 / updated 2026-04-25: Dev auto-login. Fires whenever
      // the local env vars are present (from gitignored .env.local). Runs
      // BEFORE we flip `loading` to false so the OptionalAuthPrompt doesn't
      // flash the sign-in modal during the split second between
      // session-check and auto-login.
      //
      // The 2026-04-25 update: previously this only ran when `!session`,
      // which meant a stale-but-truthy cached session would block the
      // auto-login forever — the user had to manually sign out before the
      // hook would re-sign them in. Now we also override when (a) the
      // cached session's user email doesn't match the dev creds, or
      // (b) `getUser()` rejects the cached token as expired/invalid.
      session = await runDevAutoLoginIfNeeded(session);

      setSession(session);
      setUserIfIdentityChanged(session?.user ?? null);
      setLoading(false);

      // Fetch subscription tier
      if (session?.user) {
        fetchSubscriptionTier(session.user.id, { coalesce: true });
      } else {
        setLoadingTier(false);
      }
    };

    // Get initial session. If the cached refresh token is corrupted, clear it
    // and continue boot instead of leaving the app stuck half-signed-out.
    getSupabaseSession('AuthProvider.getSession')
      .then(async (session) => {
        await finishAuthBoot(session);
      })
      .catch(async (error) => {
        const recovered = await recoverSupabaseAuthSession(error, 'AuthProvider.getSession');
        if (!recovered) {
          console.warn('[Auth] initial session read failed ' + JSON.stringify({
            message: error?.message || String(error),
          }));
        }
        await finishAuthBoot(null);
      });

    // Listen for auth changes. Supabase fires an INITIAL_SESSION event
    // during boot which can briefly hand us a null session BEFORE the dev
    // auto-login resolves — that window was letting OptionalAuthPrompt flash
    // the modal even though we were about to sign the user in. Keep loading
    // owned solely by the initial getSession/auto-login path above; ignore
    // INITIAL_SESSION here and only react to real state changes (sign-in,
    // sign-out, token refresh).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        return;
      }
      // Always keep `session` fresh so the latest JWT is available to anything
      // that reads it. But only swap the `user` reference when the user's
      // identity actually changed — a TOKEN_REFRESHED event carries a new
      // session object with an identical user, and churning `user` would
      // re-resolve / re-download an already-open document for no reason.
      setSession(session);
      setUserIfIdentityChanged(session?.user ?? null);
      setLoading(false);

      // Fetch subscription tier when user changes
      if (session?.user) {
        fetchSubscriptionTier(session.user.id, { coalesce: true });
      } else {
        setSubscriptionTier('free');
        setLoadingTier(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Pending account history is device-durable, but cloud replay belongs only
  // to the account whose session is current. Key this effect by actor ID, not
  // the session object: TOKEN_REFRESHED for the same account must not restart
  // a replay already in flight.
  useEffect(() => {
    const actorUserId = user?.id;
    if (loading || !actorUserId || session?.user?.id !== actorUserId) return undefined;
    let active = true;
    const stop = startDocumentHistoryReplay({
      actorUserId,
      isCurrent: () => active
        && replayLoadingRef.current === false
        && userRef.current?.id === actorUserId
        && replaySessionRef.current?.user?.id === actorUserId,
    });
    return () => {
      active = false;
      stop();
    };
  }, [loading, session?.user?.id, user?.id]);

  // 2026-04-26 — Tell the Electron main process whether to enable
  // developer mode (Reload + Toggle DevTools menu items, Cmd+R / Cmd+Shift+I
  // / F12 keyboard shortcuts). Only a developer-tier account flips it on
  // in shipped builds; free / Pro / Enterprise see a clean shipped app.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.setDeveloperMode) return;
    if (loadingTier) return;
    window.electronAPI.setDeveloperMode(subscriptionTier === 'developer').catch(() => {});
  }, [subscriptionTier, loadingTier]);

  // Refetch subscription tier when window regains focus (user returns from Stripe)
  useEffect(() => {
    const handleFocus = () => {
      if (user?.id) {
        fetchSubscriptionTier(user.id);
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [user]);

  // 2026-04-30 — Periodic subscription tier refresh (every 5 minutes).
  //
  // Why: user upgrades in Stripe mid-session would otherwise wait until next
  // focus to take effect. The window-focus listener above only fires when the
  // user returns to this tab; if they upgrade in another window/tab and keep
  // working in the app without refocusing, free-tier limits would keep
  // enforcing against a now-Pro account. Polling every 5 minutes guarantees
  // a hard upper bound on staleness without hammering the database.
  // Skip if no user. Clear the interval on cleanup.
  useEffect(() => {
    if (!user?.id) return;

    const intervalId = setInterval(() => {
      fetchSubscriptionTier(user.id);
    }, 300_000); // 5 minutes

    return () => clearInterval(intervalId);
  }, [user?.id]);

  // Sign up with email and password
  const signUp = async (email, password, metadata = {}, captchaToken) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        ...(captchaToken ? { captchaToken } : {}),
      },
    });

    if (error) throw error;
    return data;
  };

  // Sign in with email and password
  const signIn = async (email, password, captchaToken) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
      ...(captchaToken ? { options: { captchaToken } } : {}),
    });

    if (error) {
      const bootstrapSession = await runDevAuthBootstrapIfCaptchaBlocked(error, email);
      if (bootstrapSession) {
        setDevAuthAutoLoginSuppressed(false);
        return { session: bootstrapSession, user: bootstrapSession.user };
      }
      throw error;
    }
    if (devAuthRelayAllows(email)) setDevAuthAutoLoginSuppressed(false);
    return data;
  };

  // Sign in with Google OAuth
  const signInWithGoogle = async () => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    const nativeCredential = requestNativeGoogleIdToken();
    if (nativeCredential) {
      const result = await nativeCredential;
      if (result.cancelled) return result;

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: result.idToken,
      });
      if (error) throw error;
      return data;
    }

    // For Electron, use a proper redirect URL
    // In Electron, window.location.origin might be file:// which doesn't work for OAuth
    // Use the current window location or a custom protocol
    let redirectTo = window.location.origin;
    if (/^\/mobile(?:\/|$)/.test(window.location.pathname)) {
      redirectTo = `${window.location.origin}/mobile`;
    }
    
    // If we're in Electron (detected by checking for electronAPI)
    if (window.electronAPI) {
      // Use the current location - Electron will handle the redirect
      redirectTo = window.location.href.split('#')[0]; // Remove any existing hash
    }

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectTo,
          skipBrowserRedirect: false, // Let the browser/Electron handle the redirect
          // UX (2026-08-19, owner request): ALWAYS show Google's account chooser.
          // Without this, Google silently reuses the browser's signed-in account
          // (or a remembered choice), so a user with several Google accounts
          // cannot pick which one to sign in with. `select_account` forces the
          // picker on every click; it does not affect users with one account
          // beyond a single extra confirmation click.
          queryParams: { prompt: 'select_account' },
        },
      });

      if (error) throw error;
      return data;
    } catch (err) {
      console.error('OAuth error:', err);
      throw err;
    }
  };

  // Sign in with SSO
  const signInWithSSO = async (domain) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    const { data, error } = await supabase.auth.signInWithSSO({
      domain,
    });

    if (error) throw error;
    return data;
  };

  // Sign out
  const signOut = async () => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    // Persist before the network call and reload. Otherwise the dev relay sees
    // an empty session on the next boot and immediately signs the owner back in.
    setDevAuthAutoLoginSuppressed(true);

    try {
      // Try to sign out on the server
      await supabase.auth.signOut();
    } catch (error) {
      // If sign out fails (e.g., session already expired), log it but continue
      // We'll still clear the local session and reload
      console.warn('Sign out API call failed, clearing local session anyway:', error);
    }

    // Always clear local state and refresh, even if API call failed
    userRef.current = null;
    setUser(null);
    setSession(null);

    // Refresh the page to clear cached user documents, projects, and templates
    window.location.reload();
  };

  // Disconnect an optional OAuth identity without signing the Survey account
  // out. Supabase deliberately refuses to unlink the final identity because
  // that would leave the user with no way back into the account.
  const unlinkProvider = async (provider) => {
    if (!isSupabaseAvailable()) throw new Error('Supabase is not configured');
    const nextUser = await unlinkOAuthProvider({
      auth: supabase.auth,
      user: userRef.current,
      provider,
    });
    userRef.current = nextUser;
    setUser(nextUser);
    return nextUser;
  };

  const deleteAccount = async () => {
    if (!isSupabaseAvailable()) throw new Error('Supabase is not configured');
    setDevAuthAutoLoginSuppressed(true);
    const data = await requestAccountDeletion(supabase.functions);

    // The server has removed the Auth user. Clear the local refresh token even
    // when GoTrue can no longer accept a normal sign-out for that deleted user.
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* local state below is authoritative */ }
    userRef.current = null;
    setUser(null);
    setSession(null);
    window.location.reload();
    return data;
  };

  // Resend the signup confirmation email (rate-limited server-side; the
  // AuthModal also applies a client cooldown so users can't hammer it)
  const resendConfirmation = async (email) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    const { data, error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });

    if (error) throw error;
    return data;
  };

  // Reset password
  const resetPassword = async (email, captchaToken) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
      ...(captchaToken ? { captchaToken } : {}),
    });

    if (error) throw error;
    return data;
  };

  // Update password
  const updatePassword = async (newPassword) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) throw error;
    return data;
  };

  // Update user metadata
  const updateProfile = async (metadata) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    const { data, error } = await supabase.auth.updateUser({
      data: metadata,
    });

    if (error) throw error;
    return data;
  };

  // Refresh subscription tier — call after Stripe checkout, on document open,
  // or any other moment where a stale tier could mis-gate features. No-op when
  // not logged in. Already exposed below; the new 5-minute poller + the
  // existing window.focus listener are the automatic triggers.
  const refreshSubscriptionTier = async () => {
    if (user?.id) {
      await fetchSubscriptionTier(user.id);
    }
  };

  const value = {
    user,
    session,
    // db-sync #8: first paint gates on auth readiness ONLY, never the
    // subscription-tier SELECT. `subscriptionTier` initializes to the safe
    // 'free' default (above) and the tier SELECT resolves asynchronously,
    // upgrading gated features when it lands. This removes one round-trip from
    // the critical boot path on cold connections. Consumers that read `tier`
    // (useSubscriptionLimits, useDatabase) already fall back to 'free' until
    // resolved; the developer-mode effect still waits on `loadingTier`.
    loading,
    loadingTier,
    signUp,
    signIn,
    signInWithGoogle,
    signInWithSSO,
    signOut,
    unlinkProvider,
    deleteAccount,
    resendConfirmation,
    resetPassword,
    updatePassword,
    updateProfile,
    refreshSubscriptionTier,
    isAuthenticated: !!user,
    isSupabaseAvailable: isSupabaseAvailable(),
    plan: subscriptionTier,
    tier: subscriptionTier,
    isDeveloper: subscriptionTier === 'developer',
    features: {
      // 2026-04-26 — Cloud sync available to ALL tiers, including free.
      // Free users get cross-device sync of their own work; multi-user
      // edit-on-the-same-PDF (the `multiUserEdit` flag below) stays
      // gated to Pro/Enterprise/Developer. This means a free user
      // signed in on Mac and Windows sees the same PDFs and the same
      // marks; they just can't share an editable PDF with another user.
      cloudSync: true,
      multiUserEdit: ['pro', 'enterprise', 'developer'].includes(subscriptionTier),
      advancedSurvey: ['pro', 'enterprise', 'developer'].includes(subscriptionTier),
      excelExport: ['pro', 'enterprise', 'developer'].includes(subscriptionTier),
      sso: ['enterprise', 'developer'].includes(subscriptionTier),
    }
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
