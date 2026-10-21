import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { isAgentSession, AGENT_REFUSED_MESSAGE } from '../_shared/agentSession.ts';
import { parseBody } from '../_shared/inputSchema.js';

// "Download my data": everything the person owns, as rows plus short-lived
// links to their stored files. The app zips it on the device, so no file
// passes through this function. Files are the same set account deletion
// removes (account_deletion_storage_objects), so export and delete agree.
type AdminClient = ReturnType<typeof createClient<any>>;

const corsHeaders = {
  // INTENTIONAL: this Bearer-authenticated function is called from web,
  // Electron file://, Expo, and Capacitor. See CLAUDE.md CORS invariant.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const PAGE = 1000;
const ID_CHUNK = 100;
const LINK_SECONDS = 60 * 60;

// PostgREST caps each response at max_rows, so page until one comes back empty.
async function readAll(build: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (;;) {
    const { data, error } = await build().range(rows.length, rows.length + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
  }
  return rows;
}

async function readByIds(admin: AdminClient, table: string, columns: string, column: string, ids: string[]) {
  const rows: any[] = [];
  for (let offset = 0; offset < ids.length; offset += ID_CHUNK) {
    const chunk = ids.slice(offset, offset + ID_CHUNK);
    rows.push(...await readAll(() => admin.from(table).select(columns).in(column, chunk).order('id')));
  }
  return rows;
}

const byUser = (admin: AdminClient, table: string, columns: string, userId: string, column = 'user_id') =>
  readAll(() => admin.from(table).select(columns).eq(column, userId).order('id'));

function uniqueById(rows: any[]) {
  const seen = new Map();
  for (const row of rows) seen.set(row.id, row);
  return [...seen.values()];
}

async function collectRows(admin: AdminClient, userId: string) {
  const projects = await byUser(admin, 'projects', '*', userId);
  const templates = await byUser(admin, 'templates', '*', userId);
  const documents = await byUser(admin, 'documents', '*', userId);
  const docIds = documents.map((d) => d.id);
  const surveySessions = await byUser(admin, 'survey_sessions', '*', userId);

  return {
    profile: await readAll(() => admin.from('users')
      .select('id, email, name, full_name, avatar_url, created_at, updated_at').eq('id', userId).order('id')),
    subscription: await byUser(admin, 'user_subscriptions',
      'tier, status, trial_ends_at, current_period_start, current_period_end, storage_used_bytes, created_at, updated_at', userId),
    projects,
    templates,
    documents,
    // Markup on the person's own documents, and what they drew on documents shared with them.
    document_annotations: uniqueById([
      ...await readByIds(admin, 'document_annotations', '*', 'document_id', docIds),
      ...await byUser(admin, 'document_annotations', '*', userId),
    ]),
    spaces: await readByIds(admin, 'spaces', '*', 'document_id', docIds),
    document_revisions: await readByIds(admin, 'document_revisions', '*', 'document_id', docIds),
    document_history_events: await byUser(admin, 'document_history_events', '*', userId),
    survey_sessions: surveySessions,
    survey_items: await readByIds(admin, 'survey_items', '*', 'session_id', surveySessions.map((s) => s.id)),
    document_collaborators: uniqueById([
      ...await readByIds(admin, 'document_collaborators', '*', 'document_id', docIds),
      ...await byUser(admin, 'document_collaborators', '*', userId),
    ]),
    project_collaborators: uniqueById([
      ...await readByIds(admin, 'project_collaborators', '*', 'project_id', projects.map((p) => p.id)),
      ...await byUser(admin, 'project_collaborators', '*', userId),
    ]),
    template_collaborators: uniqueById([
      ...await readByIds(admin, 'template_collaborators', '*', 'template_id', templates.map((t) => t.id)),
      ...await byUser(admin, 'template_collaborators', '*', userId),
    ]),
    // Sign-in tokens and hashes stay out; names, states and dates come along.
    connected_services: await byUser(admin, 'connected_services',
      'id, service_name, is_connected, account_email, account_name, connected_at, last_used_at', userId),
    agent_links: await byUser(admin, 'agent_links', 'id, agent_name, scopes, status, created_at, approved_at', userId),
    agent_identities: await readAll(() => admin.from('agent_identities')
      .select('client_id, agent_name, agent_email, verified_at').eq('user_id', userId).order('client_id')),
    agent_activity: await byUser(admin, 'agent_activity', '*', userId),
    usage_metrics: await byUser(admin, 'usage_metrics', '*', userId),
    account_kits: await readAll(() => admin.from('account_kits').select('*').eq('user_id', userId).order('kit_id')),
    email_send_events: await byUser(admin, 'email_send_events', 'id, template, recipient, created_at', userId),
  };
}

async function collectFiles(admin: AdminClient, userId: string) {
  const objects: { bucket_id: string; name: string }[] = [];
  for (;;) {
    const { data, error } = await admin
      .rpc('account_deletion_storage_objects', { target_user_id: userId })
      .range(objects.length, objects.length + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    objects.push(...data);
  }

  const byBucket = new Map<string, string[]>();
  for (const { bucket_id, name } of objects) {
    byBucket.set(bucket_id, [...(byBucket.get(bucket_id) || []), name]);
  }
  const files: { bucket: string; path: string; url: string | null }[] = [];
  for (const [bucket, paths] of byBucket) {
    for (let offset = 0; offset < paths.length; offset += ID_CHUNK) {
      const chunk = paths.slice(offset, offset + ID_CHUNK);
      const { data, error } = await admin.storage.from(bucket).createSignedUrls(chunk, LINK_SECONDS);
      if (error) throw new Error(error.message);
      for (const [i, path] of chunk.entries()) {
        files.push({ bucket, path, url: data?.[i]?.signedUrl ?? null });
      }
    }
  }
  return files;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Missing authorization header' });
    // Takes no options yet; an unexpected field is a caller bug.
    const parsed = parseBody({}, await req.json().catch(() => ({})));
    if (!parsed.ok) return json(400, { error: parsed.error });

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(503, { error: 'Data export is temporarily unavailable' });
    }

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) return json(401, { error: 'Unauthorized' });
    // An agent could otherwise pull every file and markup in one call.
    if (isAgentSession(authHeader)) return json(403, { error: AGENT_REFUSED_MESSAGE });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    return json(200, {
      format: 1,
      exported_at: new Date().toISOString(),
      account: { id: user.id, email: user.email, created_at: user.created_at },
      links_expire_in_seconds: LINK_SECONDS,
      tables: await collectRows(admin, user.id),
      files: await collectFiles(admin, user.id),
    });
  } catch (error) {
    console.error('export-account failed', error instanceof Error ? error.message : String(error));
    return json(500, { error: 'Your data could not be gathered. Please try again.' });
  }
});
