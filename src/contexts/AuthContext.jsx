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

  useEffect(() => {
    if (!isSupabaseAvailable()) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

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

  const value = {
    user,
    session,
    loading,
    signUp,
    signIn,
    signInWithGoogle,
    signInWithSSO,
    signOut,
    resetPassword,
    updatePassword,
    updateProfile,
    isAuthenticated: !!user,
    isSupabaseAvailable: isSupabaseAvailable(),
    plan: user?.app_metadata?.plan || 'free',
    features: {
      cloudSync: ['pro', 'enterprise'].includes(user?.app_metadata?.plan || 'free'),
      advancedSurvey: ['pro', 'enterprise'].includes(user?.app_metadata?.plan || 'free'),
      excelExport: ['pro', 'enterprise'].includes(user?.app_metadata?.plan || 'free'),
      sso: (user?.app_metadata?.plan || 'free') === 'enterprise',
    }
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
