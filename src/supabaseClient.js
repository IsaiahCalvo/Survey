import { createClient } from '@supabase/supabase-js';

const env = import.meta.env || {};
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not found. Running in offline mode.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Helper to check if Supabase is available
export const isSupabaseAvailable = () => supabase !== null;

// 2026-04-26 — Snapshot of the current Supabase auth session, used by the
// cloud-sync hook to diagnose whether an empty cloud read came back from a
// fully-authenticated request or from one that was racing the auth handshake
// (which under RLS would silently return zero rows). Cheap, async, safe to
// call before any DB query whose emptiness would be load-bearing.
export async function getAuthSnapshot() {
  if (!supabase) return { hasSupabase: false };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { hasSupabase: true, hasSession: false };
    const expiresAt = session.expires_at || null;
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      hasSupabase: true,
      hasSession: true,
      sessionUserId: session.user?.id || null,
      sessionEmail: session.user?.email || null,
      tokenExpiresAt: expiresAt,
      tokenSecondsRemaining: expiresAt ? expiresAt - nowSec : null,
      tokenLooksValid: expiresAt ? expiresAt > nowSec : false
    };
  } catch (err) {
    return { hasSupabase: true, authQueryError: err?.message || String(err) };
  }
}

// Helper to check if an error is a schema cache error (406)
// These errors should be silently ignored as the table will become available
export const isSchemaError = (error) => {
  if (!error) return false;
  return error.status === 406 || error.code === '406' || error.message?.includes('406');
};

// Flag to track if connected_services table is available
// This prevents repeated failed requests
let connectedServicesAvailable = null;

export const isConnectedServicesAvailable = () => connectedServicesAvailable;
export const setConnectedServicesAvailable = (available) => {
  connectedServicesAvailable = available;
};
