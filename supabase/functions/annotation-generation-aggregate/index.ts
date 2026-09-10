import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { handleAnnotationGenerationAggregate } from './handler.js';
import { createAnnotationGenerationAggregateSupabaseAdapter } from './supabaseAdapter.js';

// Default off. This value means the operator has proved a suitable isolated
// worker runtime; migration success or an ordinary Edge deploy is not enough.
const runtimeVerified = Deno.env.get('SURVEY_ANNOTATION_AGGREGATE_RUNTIME') === 'verified-worker-v1';
const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function client(key: string, signal: AbortSignal, token?: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) => fetch(input, { ...init, signal }) },
  });
}

const adapter = createAnnotationGenerationAggregateSupabaseAdapter({
  caller: (token: string, signal: AbortSignal) => client(anonKey, signal, token),
  service: (signal: AbortSignal) => client(serviceKey, signal),
});

Deno.serve((request: Request) => handleAnnotationGenerationAggregate(request, {
  runtimeVerified: runtimeVerified && !!url && !!anonKey && !!serviceKey,
  ...adapter,
}));
