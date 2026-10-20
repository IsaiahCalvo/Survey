// An outside AI agent signs in through Survey's consent screen (Supabase
// OAuth server) and gets a token carrying a `client_id` claim. People's own
// sign-ins never carry one. Agents act with their person's role and plan, but
// never pay, change the plan, or delete the account: functions that do those
// call this after getUser() has checked the token, and refuse when it's true.
export function isAgentSession(authHeader: string | null): boolean {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '');
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return typeof claims?.client_id === 'string' && claims.client_id.length > 0;
  } catch {
    return false;
  }
}

export const AGENT_REFUSED_MESSAGE = 'AI agents cannot do this. The account owner must do it themselves in Survey.';
