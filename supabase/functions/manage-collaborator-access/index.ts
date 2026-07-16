import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import {
  CORS_HEADERS,
  handleManageCollaboratorAccess,
} from './handler.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const RESOURCES = {
  document: {
    collaboratorTable: 'document_collaborators',
    resourceTable: 'documents',
    resourceColumn: 'document_id',
  },
  project: {
    collaboratorTable: 'project_collaborators',
    resourceTable: 'projects',
    resourceColumn: 'project_id',
  },
} as const;

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') || '';
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body = null;
  if (req.method !== 'OPTIONS') {
    try {
      body = await req.json();
    } catch {
      body = null;
    }
  }

  const tableFor = (kind: keyof typeof RESOURCES) => RESOURCES[kind];
  const deps = {
    anonKey: ANON_KEY,
    getUserFromToken: async (jwt: string) => {
      const { data: { user }, error } = await callerClient.auth.getUser(jwt);
      return error ? null : user;
    },
    selectCollaborator: async (
      kind: keyof typeof RESOURCES,
      resourceId: string,
      targetUserId: string,
    ) => {
      const meta = tableFor(kind);
      if (!meta) return null;
      const table = meta.collaboratorTable;
      const { data, error } = await callerClient
        .from(table)
        .select('id, user_id, role')
        .eq(meta.resourceColumn, resourceId)
        .eq('user_id', targetUserId)
        .eq('status', 'active')
        .maybeSingle();
      return error ? null : data;
    },
    selectResource: async (kind: keyof typeof RESOURCES, resourceId: string) => {
      const meta = tableFor(kind);
      if (!meta) return null;
      const { data, error } = await callerClient
        .from(meta.resourceTable)
        .select('id, name, user_id')
        .eq('id', resourceId)
        .maybeSingle();
      return error ? null : data;
    },
    updateRole: async (
      kind: keyof typeof RESOURCES,
      resourceId: string,
      targetUserId: string,
      newRole: string,
    ) => {
      const meta = tableFor(kind);
      if (!meta) return [];
      const table = meta.collaboratorTable;
      const { data, error } = await callerClient
        .from(table)
        .update({ role: newRole })
        .eq(meta.resourceColumn, resourceId)
        .eq('user_id', targetUserId)
        .select('id');
      return error ? [] : (data || []);
    },
    removeAccess: async (
      kind: keyof typeof RESOURCES,
      resourceId: string,
      targetUserId: string,
    ) => {
      const meta = tableFor(kind);
      if (!meta) return [];
      const table = meta.collaboratorTable;
      const { data, error } = await callerClient
        .from(table)
        .delete()
        .eq(meta.resourceColumn, resourceId)
        .eq('user_id', targetUserId)
        .select('id');
      return error ? [] : (data || []);
    },
    getTargetEmail: async (targetUserId: string) => {
      const { data, error } = await adminClient.auth.admin.getUserById(targetUserId);
      return error ? null : (data?.user?.email || null);
    },
    sendEmail: async (payload: object) => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify(payload),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };

  try {
    const out = await handleManageCollaboratorAccess({
      method: req.method,
      authHeader,
      body,
    }, deps);
    return new Response(out.body == null ? null : JSON.stringify(out.body), {
      status: out.status,
      headers: out.body == null
        ? { ...CORS_HEADERS }
        : { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Request failed' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
