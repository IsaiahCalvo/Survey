import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not found. Running in offline mode.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Helper to check if Supabase is available
export const isSupabaseAvailable = () => supabase !== null;

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
