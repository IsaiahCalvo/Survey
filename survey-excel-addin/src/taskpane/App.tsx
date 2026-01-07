/**
 * Survey Sync Add-in App
 * Main application component
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  initSupabase,
  isSupabaseInitialized,
  loadSupabaseConfig,
  saveSupabaseConfig,
  signIn,
  signOut,
  getCurrentUser,
  onAuthStateChange,
  getSupabase,
} from '../services/supabaseClient';
import { getSyncEngine, resetSyncEngine, SyncEngineCallbacks } from '../services/syncEngine';
import { SyncStatus, SurveySession } from '../types/survey';
import ConnectionStatus from './components/ConnectionStatus';
import SessionPicker from './components/SessionPicker';
import SyncControls from './components/SyncControls';
import UserPresence from './components/UserPresence';

type AppState = 'setup' | 'login' | 'session' | 'syncing';

interface User {
  id: string;
  email?: string;
}

const App: React.FC = () => {
  // App state
  const [appState, setAppState] = useState<AppState>('setup');
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<SurveySession | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  // Setup form state
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      console.log('[SurveyAddin] App initialization starting...');
      try {
        // Try to load saved config
        let config = { url: null as string | null, anonKey: null as string | null };
        try {
          config = loadSupabaseConfig();
          console.log('[SurveyAddin] Loaded config:', { hasUrl: !!config.url, hasKey: !!config.anonKey });
        } catch (configError) {
          console.error('[SurveyAddin] Failed to load config:', configError);
        }

        if (config.url && config.anonKey) {
          try {
            console.log('[SurveyAddin] Initializing Supabase client...');
            initSupabase(config.url, config.anonKey);
            setSupabaseUrl(config.url);
            setSupabaseKey(config.anonKey);

            // Check for existing user
            console.log('[SurveyAddin] Checking for existing user...');
            const user = await getCurrentUser();
            if (user) {
              console.log('[SurveyAddin] Found existing user:', user.email);
              setUser({ id: user.id, email: user.email });
              setAppState('session');
            } else {
              console.log('[SurveyAddin] No existing user, showing login');
              setAppState('login');
            }
          } catch (e) {
            console.error('[SurveyAddin] Failed to initialize Supabase:', e);
            setAppState('setup');
          }
        } else {
          console.log('[SurveyAddin] No saved config, showing setup');
          setAppState('setup');
        }
      } catch (e) {
        console.error('[SurveyAddin] Initialization error:', e);
        setError('Failed to initialize add-in');
        setAppState('setup');
      }
    };

    init();

    // Listen for auth changes
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      subscription = onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          setUser(null);
          setAppState('login');
          handleDisconnect();
        }
      });
    } catch (e) {
      console.error('Failed to set up auth listener:', e);
    }

    return () => {
      try {
        subscription?.unsubscribe();
      } catch (e) {
        console.error('Failed to unsubscribe:', e);
      }
    };
  }, []);

  // Handle Supabase setup
  const handleSetup = useCallback(() => {
    if (!supabaseUrl || !supabaseKey) {
      setError('Please enter both Supabase URL and anon key');
      return;
    }

    try {
      initSupabase(supabaseUrl, supabaseKey);
      saveSupabaseConfig(supabaseUrl, supabaseKey);
      setError(null);
      setAppState('login');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [supabaseUrl, supabaseKey]);

  // Handle login
  const handleLogin = useCallback(async () => {
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }

    setLoginLoading(true);
    setError(null);

    try {
      const { user } = await signIn(email, password);
      if (user) {
        setUser({ id: user.id, email: user.email });
        setAppState('session');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoginLoading(false);
    }
  }, [email, password]);

  // Handle logout
  const handleLogout = useCallback(async () => {
    await handleDisconnect();
    await signOut();
    setUser(null);
    setAppState('login');
  }, []);

  // Handle session selection
  const handleSessionSelect = useCallback(async (selectedSession: SurveySession) => {
    setSession(selectedSession);
    setAppState('syncing');

    // Connect sync engine
    const syncEngine = getSyncEngine({
      onStatusChange: setSyncStatus,
      onError: (err) => setError(err.message),
    });

    try {
      await syncEngine.connect(selectedSession.id, user!.id);
    } catch (e) {
      setError((e as Error).message);
      setAppState('session');
    }
  }, [user]);

  // Handle disconnect
  const handleDisconnect = useCallback(async () => {
    resetSyncEngine();
    setSyncStatus('disconnected');
    setSession(null);
    if (appState === 'syncing') {
      setAppState('session');
    }
  }, [appState]);

  // Render setup screen
  if (appState === 'setup') {
    return (
      <div className="app-container">
        <header className="app-header">
          <h1>Survey Sync</h1>
          <p>Connect to your Survey App</p>
        </header>

        <main className="app-content">
          <div className="setup-form">
            <p className="setup-instructions">
              Enter your Supabase credentials to connect to your Survey App.
              You can find these in your Supabase project settings.
            </p>

            <div className="form-group">
              <label htmlFor="supabaseUrl">Supabase URL</label>
              <input
                type="url"
                id="supabaseUrl"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://your-project.supabase.co"
              />
            </div>

            <div className="form-group">
              <label htmlFor="supabaseKey">Anon Key</label>
              <input
                type="password"
                id="supabaseKey"
                value={supabaseKey}
                onChange={(e) => setSupabaseKey(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIs..."
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button className="btn-primary" onClick={handleSetup}>
              Connect
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Render login screen
  if (appState === 'login') {
    return (
      <div className="app-container">
        <header className="app-header">
          <h1>Survey Sync</h1>
          <p>Sign in to continue</p>
        </header>

        <main className="app-content">
          <div className="login-form">
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button
              className="btn-primary"
              onClick={handleLogin}
              disabled={loginLoading}
            >
              {loginLoading ? 'Signing in...' : 'Sign In'}
            </button>

            <button
              className="btn-secondary"
              onClick={() => setAppState('setup')}
            >
              Change Supabase Config
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Render session selection
  if (appState === 'session') {
    return (
      <div className="app-container">
        <header className="app-header">
          <h1>Survey Sync</h1>
          <div className="user-info">
            <span>{user?.email}</span>
            <button className="btn-link" onClick={handleLogout}>
              Sign Out
            </button>
          </div>
        </header>

        <main className="app-content">
          <SessionPicker
            userId={user!.id}
            onSelect={handleSessionSelect}
          />

          {error && <div className="error-message">{error}</div>}
        </main>
      </div>
    );
  }

  // Render syncing screen
  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Survey Sync</h1>
        <div className="user-info">
          <span>{user?.email}</span>
          <button className="btn-link" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="app-content">
        <ConnectionStatus status={syncStatus} />

        <SyncControls
          session={session!}
          status={syncStatus}
          onDisconnect={handleDisconnect}
        />

        <UserPresence sessionId={session!.id} />

        {error && <div className="error-message">{error}</div>}
      </main>
    </div>
  );
};

export default App;
