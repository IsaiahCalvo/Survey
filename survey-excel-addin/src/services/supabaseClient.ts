/**
 * Supabase Client for Office.js Add-in
 * Connects to the same Supabase project as the main Survey App
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// These will be injected at build time or configured in the add-in
// For development, we use environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

let supabaseClient: SupabaseClient | null = null;

/**
 * Initialize the Supabase client
 * Can be called with custom credentials (e.g., from localStorage or user input)
 */
export function initSupabase(url?: string, anonKey?: string): SupabaseClient {
  const supabaseUrl = url || SUPABASE_URL;
  const supabaseAnonKey = anonKey || SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase credentials not configured. Please enter your Supabase URL and anon key.');
  }

  supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      storageKey: 'survey-addin-auth',
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

  return supabaseClient;
}

/**
 * Get the current Supabase client
 */
export function getSupabase(): SupabaseClient | null {
  return supabaseClient;
}

/**
 * Check if Supabase is initialized
 */
export function isSupabaseInitialized(): boolean {
  return supabaseClient !== null;
}

/**
 * Sign in with email and password
 */
export async function signIn(email: string, password: string) {
  if (!supabaseClient) {
    throw new Error('Supabase not initialized');
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

/**
 * Sign out
 */
export async function signOut() {
  if (!supabaseClient) return;

  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
}

/**
 * Get current user
 */
export async function getCurrentUser() {
  if (!supabaseClient) return null;

  const { data: { user } } = await supabaseClient.auth.getUser();
  return user;
}

/**
 * Listen for auth state changes
 */
export function onAuthStateChange(callback: (event: string, session: unknown) => void) {
  if (!supabaseClient) return { unsubscribe: () => {} };

  const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(callback);
  return subscription;
}

// Storage keys for persisting configuration
const STORAGE_KEYS = {
  SUPABASE_URL: 'survey-addin-supabase-url',
  SUPABASE_KEY: 'survey-addin-supabase-key',
};

/**
 * Save Supabase configuration to localStorage
 */
export function saveSupabaseConfig(url: string, anonKey: string) {
  localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, url);
  localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, anonKey);
}

/**
 * Load Supabase configuration from localStorage
 */
export function loadSupabaseConfig(): { url: string | null; anonKey: string | null } {
  return {
    url: localStorage.getItem(STORAGE_KEYS.SUPABASE_URL),
    anonKey: localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY),
  };
}

/**
 * Clear Supabase configuration
 */
export function clearSupabaseConfig() {
  localStorage.removeItem(STORAGE_KEYS.SUPABASE_URL);
  localStorage.removeItem(STORAGE_KEYS.SUPABASE_KEY);
}

export default supabaseClient;
