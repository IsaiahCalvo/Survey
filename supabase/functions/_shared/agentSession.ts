// An outside AI agent signs in through Survey's consent screen (Supabase
// OAuth server) and gets a token carrying a `client_id` claim. People's own
// sign-ins never carry one. Agents act with their person's role and plan, but
// never pay, change the plan, or delete the account: functions that do those
// call this after getUser() has checked the token, and refuse when it's true.
export function agentClientId(authHeader: string | null): string | null {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '');
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return typeof claims?.client_id === 'string' && claims.client_id.length > 0 ? claims.client_id : null;
  } catch {
    return null;
  }
}

export function isAgentSession(authHeader: string | null): boolean {
  return agentClientId(authHeader) !== null;
}

export const AGENT_REFUSED_MESSAGE = 'AI agents cannot do this. The account owner must do it themselves in Survey.';

// Calls per agent per hour, per function. People are not limited here.
export const AGENT_HOURLY_LIMITS: Record<string, number> = {
  'send-email': 10,
  'send-invite-email': 10,
  'send-profile-change-notification': 5,
  'excel-apply-changeset': 60,
};

export const AGENT_RATE_LIMITED_MESSAGE = 'This AI agent has used this too often. Try again within the hour.';

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

// Counts the call and says whether an agent is over its limit. `client` must
// carry the caller's own Authorization header: the database reads the agent
// from the token, so an agent can't spend another agent's allowance. Fails
// closed for agents when the counter can't be reached.
export async function agentOverLimit(authHeader: string | null, fn: string, client: RpcClient): Promise<boolean> {
  if (!isAgentSession(authHeader)) return false;
  const limit = AGENT_HOURLY_LIMITS[fn];
  if (!limit) return false;
  const { data, error } = await client.rpc('agent_rate_hit', { p_fn: fn, p_limit: limit });
  return Boolean(error) || data !== true;
}
