import { loadEnv } from 'vite';

const PROCESS_ENV_OVERRIDES = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

export function resolveViteConfigEnv(mode, root, processEnv = process.env) {
  const env = loadEnv(mode, root, '');
  for (const name of PROCESS_ENV_OVERRIDES) {
    if (processEnv[name]) env[name] = processEnv[name];
  }
  return env;
}
