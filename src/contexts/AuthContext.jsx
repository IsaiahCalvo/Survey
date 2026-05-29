/**
 * AuthContext.jsx — Supabase auth provider and the app-wide useAuth() hook.
 *
 * Exports AuthContext, the useAuth() hook, and the AuthProvider that owns
 * user/session/loading plus the subscription tier. Boots the initial session
 * (with corrupted-token recovery and a DEV-only auto-login), listens to
 * onAuthStateChange, polls/refetches the tier (focus + every 5 min), and
 * exposes signUp/signIn/signInWithGoogle/signInWithSSO/signOut/resetPassword/
 * updatePassword/updateProfile plus derived `tier`/`features` gating flags.
 * Also pushes developer-mode state to the Electron main process.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import {
  supabase,
  isSupabaseAvailable,
  getSupabaseSession,
  recoverSupabaseAuthSession,
} from '../supabaseClient';

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

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionTier, setSubscriptionTier] = useState('free');
  const [loadingTier, setLoadingTier] = useState(true);

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
      email: devOverride.email || import.meta.env.VITE_DEV_AUTO_LOGIN_EMAIL,
      password: devOverride.password || import.meta.env.VITE_DEV_AUTO_LOGIN_PASSWORD,
    };
  };

  const runDevAutoLoginIfNeeded = async (session) => {
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
    if (session && devEmail && devPassword) {
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
      willAttemptSignIn: needsAutoLogin && !!devEmail && !!devPassword
    }));
    if (!needsAutoLogin) return session;

    if (devEmail && devPassword) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: devEmail,
          password: devPassword
        });
        if (error) {
          console.warn('[dev-auto-login] sign-in FAILED ' + JSON.stringify({
            code: error.code || null,
            status: error.status || null,
            message: error.message || String(error)
          }));
        } else {
          authDebug('[dev-auto-login] sign-in OK ' + JSON.stringify({
            userId: data?.user?.id || null,
            email: data?.user?.email || null
          }));
          session = data?.session ?? session;
        }
      } catch (err) {
        console.warn('[dev-auto-login] sign-in THREW ' + JSON.stringify({
          message: err?.message || String(err)
        }));
      }
    } else {
      console.warn('[dev-auto-login] needed sign-in but creds NOT loaded — skipped. Restart the dev server / Electron app to pick up .env.local.');
    }
    return session;
  };

  // Fetch subscription tier from database
  const fetchSubscriptionTier = async (userId) => {
    if (!userId || !isSupabaseAvailable()) {
      setSubscriptionTier('free');
      setLoadingTier(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('tier, status')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('Error fetching subscription tier:', error);
        setSubscriptionTier('free');
      } else {
        // Only allow Pro/Enterprise if subscription is active or trialing
        const activeStatuses = ['active', 'trialing'];
        if (activeStatuses.includes(data.status)) {
          setSubscriptionTier(data.tier);
        } else {
          // Canceled, past_due, incomplete -> fall back to free
          setSubscriptionTier('free');
        }
      }
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
      setUser(session?.user ?? null);
      setLoading(false);

      // Fetch subscription tier
      if (session?.user) {
        fetchSubscriptionTier(session.user.id);
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
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // Fetch subscription tier when user changes
      if (session?.user) {
        fetchSubscriptionTier(session.user.id);
      } else {
        setSubscriptionTier('free');
        setLoadingTier(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

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
  }, [user]);

  // Sign up with email and password
  const signUp = async (email, password, metadata = {}) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
      },
    });

    if (error) throw error;
    return data;
  };

  // Sign in with email and password
  const signIn = async (email, password) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return data;
  };

  // Sign in with Google OAuth
  const signInWithGoogle = async () => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    // For Electron, use a proper redirect URL
    // In Electron, window.location.origin might be file:// which doesn't work for OAuth
    // Use the current window location or a custom protocol
    let redirectTo = window.location.origin;
    
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

    try {
      // Try to sign out on the server
      await supabase.auth.signOut();
    } catch (error) {
      // If sign out fails (e.g., session already expired), log it but continue
      // We'll still clear the local session and reload
      console.warn('Sign out API call failed, clearing local session anyway:', error);
    }

    // Always clear local state and refresh, even if API call failed
    setUser(null);
    setSession(null);

    // Refresh the page to clear cached user documents, projects, and templates
    window.location.reload();
  };

  // Reset password
  const resetPassword = async (email) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase is not configured');
    }

    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
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
    loading: loading || loadingTier,
    signUp,
    signIn,
    signInWithGoogle,
    signInWithSSO,
    signOut,
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
