import { createClient } from '@supabase/supabase-js';

// `import.meta.env` is provided by Vite in the browser/dev/build pipeline.
// Under Node's --test runner, `import.meta.env` is undefined; guard so test
// imports of modules that depend on this file don't crash at module-load.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
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
