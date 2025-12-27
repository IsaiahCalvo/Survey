import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseAvailable } from '../supabaseClient';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionTier, setSubscriptionTier] = useState('free');
  const [loadingTier, setLoadingTier] = useState(true);

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

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // Fetch subscription tier
      if (session?.user) {
        fetchSubscriptionTier(session.user.id);
      } else {
        setLoadingTier(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
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

  // Refetch subscription tier when window regains focus (user returns from Stripe)
  useEffect(() => {
    const handleFocus = () => {
      if (user?.id) {
        console.log('Window focused, refetching subscription tier...');
        fetchSubscriptionTier(user.id);
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
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

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) throw error;
    return data;
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

  // Refresh subscription tier (call after user returns from Stripe checkout)
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
    features: {
      cloudSync: ['pro', 'enterprise', 'developer'].includes(subscriptionTier),
      advancedSurvey: ['pro', 'enterprise', 'developer'].includes(subscriptionTier),
      excelExport: ['pro', 'enterprise', 'developer'].includes(subscriptionTier),
      sso: ['enterprise', 'developer'].includes(subscriptionTier),
    }
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
