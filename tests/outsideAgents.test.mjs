import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agentLinkResumeUrl, clearPendingConsent, isConsentId, readPendingConsent, savePendingConsent } from '../src/home/agentLinkPending.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('consent request is kept 10 minutes while the person signs up', () => {
  const s = memory();
  savePendingConsent(s, 'auth_abc123XYZ', 0);
  assert.equal(readPendingConsent(s, 9 * 60 * 1000), 'auth_abc123XYZ');
  assert.equal(readPendingConsent(s, 11 * 60 * 1000), '');
  clearPendingConsent(s);
  assert.equal(readPendingConsent(s, 0), '');
  assert.equal(isConsentId('<script>'), false);
  savePendingConsent(s, '../../evil', 0);
  assert.equal(readPendingConsent(s, 0), '');
});

test('back at the front page from sign-in, a waiting consent request resumes the consent screen', () => {
  const s = memory();
  savePendingConsent(s, 'auth_abc123XYZ', 0);
  const loc = { pathname: '/', search: '?code=supabase-pkce', hash: '' };
  assert.equal(agentLinkResumeUrl(loc, s, 1000), '/oauth/consent?code=supabase-pkce');
  assert.equal(agentLinkResumeUrl({ ...loc, search: '' }, s, 1000), null);
});

test('consent route and rules are wired', () => {
  assert.match(read('src/main.jsx'), /agent-link\|oauth\\\/consent/);
  const page = read('src/home/AgentLinkPage.jsx');
  assert.match(page, /approveAuthorization\(authorizationId, \{ skipBrowserRedirect: true \}\)/);
  assert.match(page, /where you can only view, it can only view/);
  assert.match(page, /revokeGrant\(\{ clientId \}\)/);
  // Only one flow is kept, nothing shows until sign-in is known, and an
  // already-allowed redirect drops the saved request.
  assert.match(page, /savePendingConsent\(window\.localStorage, consentId\);\s+clearPendingAgentCode/);
  assert.match(page, /savePendingAgentCode\(window\.localStorage, code\);\s+clearPendingConsent/);
  assert.match(page, /if \(auth\.loading\) return/);
  assert.match(page, /clearPendingConsent\(window\.localStorage\); \} catch \{ \/\* storage blocked \*\/ \}\s+window\.location\.assign\(data\.redirect_url\);\s+return;/);
  // An agent-code link starts that flow, never an older saved consent.
  assert.match(page, /if \(params\.get\('user_code'\) \|\| \/\^\\\/agent-link/);
});

test('database keeps outside agents to their person, minus money, linked accounts and other agents', () => {
  const sql = read('supabase/migrations/20261020230000_outside_agent_limits.sql');
  assert.match(sql, /coalesce\(auth\.jwt\(\) ->> 'client_id', ''\) <> ''/);
  for (const table of ['connected_services', 'agent_links']) {
    assert.match(sql, new RegExp(`on public\\.${table}\\s+as restrictive\\s+for all\\s+to authenticated\\s+using \\(not public\\.is_agent_session\\(\\)\\)`));
  }
  assert.match(sql, /if public\.is_agent_session\(\) then\s+raise exception 'agents cannot approve agents'/);
  assert.match(sql, /function public\.revoke_agent_link[\s\S]*?and not public\.is_agent_session\(\)/, 'agents cannot remove other agents');
  for (const fn of ['handle_downgrade_to_free\\(uuid\\)', 'archive_excess_documents\\(uuid, integer\\)', 'archive_excess_projects\\(uuid, integer\\)', 'archive_excess_projects\\(uuid, uuid\\)']) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${fn} from public, anon, authenticated`));
  }
});

test('removing an agent cuts it off at once, not when its token expires', () => {
  const sql = read('supabase/migrations/20261021040000_agent_removal_takes_effect.sql');
  // People's own sign-ins skip the lookup; agents need a live session and an unrevoked grant.
  assert.match(sql, /select coalesce\(auth\.jwt\(\) ->> 'client_id', ''\) = ''\s+or \(/);
  assert.match(sql, /from auth\.sessions s[\s\S]*?s\.id::text = auth\.jwt\(\) ->> 'session_id'/);
  assert.match(sql, /from auth\.oauth_consents c[\s\S]*?c\.revoked_at is not null/);
  assert.match(sql, /alter role authenticator set pgrst\.db_pre_request = 'public\.check_agent_request';/);
  assert.match(sql, /notify pgrst, 'reload config';/);
  assert.match(sql, /on storage\.objects as restrictive/);
});

test('agents cannot pay, open billing, delete the account, or export it', () => {
  const helper = read('supabase/functions/_shared/agentSession.ts');
  assert.match(helper, /claims\?\.client_id/);
  for (const fn of ['create-checkout-session', 'create-portal-session', 'delete-account', 'export-account']) {
    const src = read(`supabase/functions/${fn}/index.ts`);
    assert.match(src, /import \{ isAgentSession, AGENT_REFUSED_MESSAGE \} from '\.\.\/_shared\/agentSession\.ts'/, fn);
    const guard = src.indexOf('isAgentSession(authHeader)');
    assert.ok(guard > src.indexOf('getUser('), `${fn} checks after the token is verified`);
  }
});

test('survey-mcp read tools stay read-only; write tools are gated by flag + write scope', () => {
  const src = read('supabase/functions/survey-mcp/index.ts');
  for (const name of ['list_projects', 'list_documents', 'list_survey_items', 'find_survey_items', 'get_survey_item', 'get_document_role', 'get_survey_context']) {
    assert.match(src, new RegExp(`name: '${name}'`), name);
  }
  // READ_TOOLS are all read-only and contain no write tool.
  const readTools = src.slice(src.indexOf('const READ_TOOLS'), src.indexOf('const WRITE_TOOLS'));
  assert.equal((readTools.match(/readOnlyHint: true/g) || []).length, 7);
  assert.doesNotMatch(readTools, /readOnlyHint: false/);
  assert.doesNotMatch(readTools, /set_answers|add_note/);
  // WRITE_TOOLS exist, are the two expected writes, and are not read-only.
  const writeTools = src.slice(src.indexOf('const WRITE_TOOLS'), src.indexOf('async function gunzip'));
  assert.match(writeTools, /name: 'set_answers'/);
  assert.match(writeTools, /name: 'add_note'/);
  assert.equal((writeTools.match(/readOnlyHint: false/g) || []).length, 2);
  // tools/list offers writes only when the flag is on AND the token may write.
  assert.match(src, /const CONNECTOR_WRITES_FLAG = 'survey-connector-writes'/);
  const list = src.slice(src.indexOf("method === 'tools/list'"), src.indexOf("method === 'tools/call'"));
  assert.match(list, /get_my_feature_flags/);
  assert.match(list, /access !== 'read'/);
  assert.match(list, /\[\.\.\.READ_TOOLS, \.\.\.WRITE_TOOLS\]/);
  // Each write call gate: the feature flag on AND not a read-scoped agent.
  const guard = src.slice(src.indexOf('async function requireWrite'), src.indexOf('async function callTool'));
  assert.match(guard, /get_my_feature_flags/);
  assert.match(guard, /access === 'read'/);
  // Writes go through the shared CRDT marker sync + the append RPC on the
  // person's token, never a service-role or a document_annotations write.
  assert.match(src, /syncSurveyMarkersToDoc\(doc, markers, \{ origin: 'agent' \}\)/);
  assert.match(src, /rpc\('append_annotation_update'/);
  // The off-by-default flag is declared in a migration and the client registry.
  assert.match(read('supabase/migrations/20261022170000_survey_connector_writes_flag.sql'), /'survey-connector-writes', 'off'/);
  assert.match(read('src/featureFlags.js'), /'survey-connector-writes'/);
  // A read-only agent can only reach a STABLE rpc via GET (the #1034 gate).
  assert.match(src, /rpc\('get_my_document_role', \{ doc_id: documentId \}, \{ get: true \}\)/);
  // get_survey_context describes only THIS document's survey — the categories
  // its linked templates define plus the ones its own items use — never the
  // union of every template the person can see, and never empty just because
  // document_templates has no rows (it reads the items too).
  const ctx = src.slice(src.indexOf("name === 'get_survey_context'"), src.indexOf("throw new ToolError(`Unknown tool"));
  assert.match(ctx, /surveyItems\(db, documentId\)/);
  assert.match(ctx, /names\.linkedCats/);
  assert.match(ctx, /r\.category_id\) cats\.add/);
  assert.match(ctx, /\.filter\(\(c\) => cats\.has\(c\.id\)\)/);
});

async function loadAgentSession() {
  const { stripTypeScriptTypes } = await import('node:module');
  const js = stripTypeScriptTypes(read('supabase/functions/_shared/agentSession.ts'));
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const agentToken = (claims) => `Bearer h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

test('isAgentSession reads client_id from the token', async () => {
  const { isAgentSession, agentClientId } = await loadAgentSession();
  assert.equal(isAgentSession(agentToken({ sub: 'u', client_id: 'c1' })), true);
  assert.equal(agentClientId(agentToken({ sub: 'u', client_id: 'c1' })), 'c1');
  assert.equal(isAgentSession(agentToken({ sub: 'u' })), false);
  assert.equal(isAgentSession(agentToken({ sub: 'u', client_id: '' })), false);
  assert.equal(isAgentSession(null), false);
  assert.equal(isAgentSession('Bearer garbage'), false);
});

test('agent hourly limits: people pass untouched, agents are counted and fail closed', async () => {
  const { agentOverLimit, AGENT_HOURLY_LIMITS } = await loadAgentSession();
  const calls = [];
  const client = (result) => ({ rpc: async (name, args) => { calls.push([name, args]); return result; } });
  assert.equal(await agentOverLimit(agentToken({ sub: 'u' }), 'send-email', client({ data: false })), false);
  assert.equal(calls.length, 0, 'a person never touches the counter');
  const agent = agentToken({ sub: 'u', client_id: 'c1' });
  assert.equal(await agentOverLimit(agent, 'send-email', client({ data: true, error: null })), false);
  assert.deepEqual(calls.at(-1), ['agent_rate_hit', { p_fn: 'send-email', p_limit: AGENT_HOURLY_LIMITS['send-email'] }]);
  assert.equal(await agentOverLimit(agent, 'send-email', client({ data: false, error: null })), true);
  assert.equal(await agentOverLimit(agent, 'send-email', client({ data: null, error: { message: 'down' } })), true, 'fails closed');
  for (const fn of Object.keys(AGENT_HOURLY_LIMITS)) {
    const src = read(`supabase/functions/${fn}/index.ts`);
    assert.match(src, new RegExp(`agentOverLimit\\([^)]*'${fn}'`), `${fn} checks its agent limit`);
    assert.match(src, /status: 429|, 429\)/, `${fn} answers 429`);
    assert.match(read('supabase/migrations/20261021060000_agent_rate_limits.sql'), new RegExp(`'${fn}'`));
  }
});

test('an agent cannot lift its own hourly cap by passing a big p_limit', () => {
  // The limit lives in the function, keyed by p_fn; p_limit is ignored. An
  // agent calling the RPC straight from REST with a huge p_limit stays capped.
  const sql = read('supabase/migrations/20261021100000_agent_rate_limit_server_side.sql');
  assert.match(sql, /v_limit integer := case p_fn/);
  assert.match(sql, /return v_calls <= v_limit;/);
  assert.doesNotMatch(sql, /<= p_limit/);
  assert.match(sql, /p_limit integer default null/);
});

test('agent activity log: agents\' writes are recorded, people read their own log, agents read none', () => {
  const sql = read('supabase/migrations/20261021050000_agent_activity_log.sql');
  assert.match(sql, /using \(user_id = auth\.uid\(\) and not public\.is_agent_session\(\)\)/);
  assert.match(sql, /if v_uid is null or not public\.is_agent_session\(\) then\s+return null;/);
  for (const table of ['projects', 'documents', 'document_annotations', 'survey_items']) assert.match(sql, new RegExp(`'${table}'`));
  assert.match(sql, /interval '90 days'/);
  const page = read('src/home/AgentLinkPage.jsx');
  assert.match(page, /from\('agent_activity'\)/);
  assert.match(page, /rpc\('my_agent_last_active'\)/);
});

test('AgentID tokens: only a fresh ES256 token from AgentID, for Survey, naming an agent', async () => {
  const mod = await import('../supabase/functions/_shared/agentIdToken.js');
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
  const fetchJwks = async () => ({ keys: [jwk] });
  const now = Date.UTC(2026, 9, 21);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sign = async (claims, header = { alg: 'ES256', kid: 'k1' }, key = privateKey) => {
    const data = `${b64(header)}.${b64(claims)}`;
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(data));
    return `${data}.${Buffer.from(sig).toString('base64url')}`;
  };
  const good = {
    iss: 'https://auth.agentid.com', aud: 'https://surveytool.app', sub: 'agt_1', actor_type: 'agent',
    iat: now / 1000, exp: now / 1000 + 600, email: 'bot@agentmail.to', owner_email: 'isaiah@example.com', owner_human_verified: true,
  };
  const claims = await mod.verifyAgentIdToken(await sign(good), { fetchJwks, now });
  assert.deepEqual(mod.agentIdRecord(claims), {
    agentid_sub: 'agt_1', agent_email: 'bot@agentmail.to', agent_name: null,
    owner_sub: null, owner_email: 'isaiah@example.com', owner_human_verified: true,
  });
  const refused = async (token, why) => assert.rejects(mod.verifyAgentIdToken(token, { fetchJwks, now }), why);
  await refused(await sign({ ...good, iss: 'https://evil.example' }), /wrong issuer/);
  await refused(await sign({ ...good, aud: 'https://other.app' }), /not meant for Survey/);
  await refused(await sign({ ...good, exp: now / 1000 - 3600 }), /expired/);
  await refused(await sign({ ...good, actor_type: 'human' }), /not an agent/);
  await refused(await sign(good, { alg: 'HS256', kid: 'k1' }), /wrong signing method/);
  await refused(await sign(good, { alg: 'ES256', kid: 'other' }), /unknown signing key/);
  const { privateKey: stranger } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  await refused(await sign(good, undefined, stranger), /bad signature/);
  const [h, p, s] = (await sign(good)).split('.');
  await refused(`${h}.${b64({ ...good, sub: 'agt_2' })}.${s}`, /bad signature/);
  await refused('garbage', /not a token/);

  const fn = read('supabase/functions/agent-identity/index.ts');
  assert.ok(fn.indexOf('agentClientId(authHeader)') < fn.indexOf('await verifyAgentIdToken('), 'only signed-in agents get as far as the check');
  assert.match(fn, /onConflict: 'user_id,client_id'/);
  assert.match(read('.github/workflows/deploy-production.yml'), /\n\s+agent-identity\n/);
  assert.match(read('supabase/migrations/20261021070000_agent_identities.sql'), /using \(user_id = auth\.uid\(\) and not public\.is_agent_session\(\)\)/);
});

test('agent log keeps 90 days for everyone, without a scheduler', () => {
  const sql = read('supabase/migrations/20261021080000_agent_activity_retention.sql');
  assert.match(sql, /created_at > now\(\) - interval '90 days'\);/);
  assert.match(sql, /perform public\.prune_agent_activity\(\);/);
  assert.doesNotMatch(sql.slice(sql.indexOf('function public.prune_agent_activity')), /where user_id = v_uid/);
});
