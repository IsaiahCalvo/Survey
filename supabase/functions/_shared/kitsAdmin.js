/**
 * kitsAdmin.js — what the kits-admin edge function does, as plain JS so a
 * Node test can run it against a real database. Only the people who run
 * Survey (feature_flag_admins, the /flags list; agents never) get past the
 * check, and only then is the service-role client used.
 *
 *   { action: 'list' }
 *   { action: 'publish', kit }                 kits never change: a new version each time
 *   { action: 'assign', email, kitId, version }
 *   { action: 'unassign', email, kitId }
 */
import { publishProblems } from './kitShape.js';
import { parseBody, s } from './inputSchema.js';

const BODY_SCHEMA = {
  action: s.enum(['list', 'publish', 'assign', 'unassign']),
  kit: s.record({ maxBytes: 256 * 1024, optional: true }),
  email: s.string({ max: 320, optional: true }),
  kitId: s.string({ max: 100, optional: true }),
  version: s.string({ max: 50, optional: true }),
};

const fail = (status, error) => ({ status, body: { error } });
const ok = (body) => ({ status: 200, body });

async function allUsers(service) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function userIdByEmail(service, email) {
  const wanted = String(email || '').trim().toLowerCase();
  if (!wanted) return null;
  return (await allUsers(service)).find((u) => (u.email || '').toLowerCase() === wanted)?.id || null;
}

export async function handleKitsAdmin(rawBody, { userClient, service }) {
  const { data: isAdmin, error: adminError } = await userClient.rpc('is_feature_flag_admin');
  if (adminError || isAdmin !== true) return fail(403, 'This is only for the people who run Survey.');

  const parsed = parseBody(BODY_SCHEMA, rawBody ?? {});
  if (!parsed.ok) return fail(400, parsed.error);
  const payload = parsed.value;
  const { action } = payload;
  if (action === 'list') {
    const [{ data: kits, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
      service.from('kits').select('id, version, kind, label, created_at').order('id').order('created_at'),
      service.from('account_kits').select('user_id, kit_id, kit_version, created_at').order('kit_id'),
    ]);
    if (e1 || e2) return fail(500, 'Could not load kits.');
    const emails = new Map((await allUsers(service)).map((u) => [u.id, u.email]));
    return ok({
      kits,
      assignments: rows.map((r) => ({ ...r, email: emails.get(r.user_id) || null }))
        .sort((a, b) => String(a.email).localeCompare(String(b.email))),
    });
  }

  if (action === 'publish') {
    const kit = payload.kit;
    const problems = publishProblems(kit);
    if (problems.length) return fail(400, `Kit not valid: ${problems.join('; ')}`);
    const { id, version, kind, label = '', ...rest } = kit;
    const { error } = await service.from('kits').insert({ id, version, kind, label, definition: { ...rest, label } });
    if (error) return fail(400, /duplicate key/.test(error.message) ? `${id}@${version} already exists; bump the version.` : 'Could not publish the kit.');
    return ok({ published: `${id}@${version}` });
  }

  if (action === 'assign' || action === 'unassign') {
    const userId = await userIdByEmail(service, payload.email);
    if (!userId) return fail(404, `No account with email ${payload.email || ''}.`);
    const kitId = String(payload.kitId || '');
    if (action === 'unassign') {
      const { error } = await service.from('account_kits').delete().eq('user_id', userId).eq('kit_id', kitId);
      return error ? fail(500, 'Could not remove it.') : ok({ removed: kitId });
    }
    const { error } = await service.from('account_kits')
      .upsert({ user_id: userId, kit_id: kitId, kit_version: String(payload.version || '') });
    if (error) return fail(400, /foreign key/.test(error.message) ? `No kit ${kitId}@${payload.version}.` : 'Could not give the kit.');
    return ok({ assigned: `${kitId}@${payload.version}` });
  }

  return fail(400, 'Unknown action.');
}

