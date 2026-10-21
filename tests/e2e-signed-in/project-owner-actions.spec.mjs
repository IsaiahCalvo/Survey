// PR #1071 greys Share, Delete and Add member for anyone but the project
// owner. This checks the server agrees: an editor and a viewer of the owner's
// project call the same API paths the app uses and nothing changes. Rename is
// different: editors may rename a shared project (rls-matrix), viewers may not.
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, apiClientFor as clientFor, expect, test } from './helpers.mjs';

const PROJECT = E2E_PROJECT.id;
const admin = adminClient();

async function userId(email) {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data.users.find((u) => u.email === email).id;
}

async function snapshot() {
  const [project, invites, members] = await Promise.all([
    admin.from('projects').select('*').eq('id', PROJECT).single(),
    admin.from('project_invites').select('id, role, revoked_at, expires_at').eq('project_id', PROJECT).order('id'),
    admin.from('project_collaborators').select('user_id, role, status').eq('project_id', PROJECT).order('user_id'),
  ]);
  return JSON.stringify({ project: project.data, invites: invites.data, members: members.data });
}

// A call is refused when it errors, touches no rows, or an RPC answers ok:false.
function refused({ data, error }) {
  if (error) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (data && typeof data === 'object' && 'ok' in data) return data.ok !== true;
  return data == null;
}

for (const key of ['editor', 'viewer']) {
  test(`a project ${key} cannot share, add members, archive or delete the owner's project`, async () => {
    const account = E2E_ACCOUNTS[key];
    const client = await clientFor(account);
    const me = await userId(account.email);
    const stranger = await userId(E2E_ACCOUNTS.free.email);
    const owner = await userId(E2E_ACCOUNTS.owner.email);
    const expires = new Date(Date.now() + 7 * 864e5).toISOString();
    const before = await snapshot();
    const invite = (email) => ({
      project_id: PROJECT, token: `owner-only-${key}-${email ? 'mail' : 'link'}`, role: 'editor', intended_role: 'editor',
      target_email: email, created_by: me, expires_at: expires,
    });
    const attempts = {
      'share link (project_invites insert)': () => client.from('project_invites').insert(invite(null)).select(),
      'email invite (project_invites insert)': () => client.from('project_invites').insert(invite(E2E_ACCOUNTS.free.email)).select(),
      'add member (project_collaborators insert)': () => client.from('project_collaborators').insert({
        project_id: PROJECT, user_id: stranger, invited_by: me, role: 'editor', email: E2E_ACCOUNTS.free.email, status: 'active',
      }).select(),
      'promote self to owner (project_collaborators update)': () => client.from('project_collaborators')
        .update({ role: 'owner' }).eq('project_id', PROJECT).eq('user_id', me).select(),
      'archive_project rpc': () => client.rpc('archive_project', { p_project_id: PROJECT }),
      'purge_archived_project rpc': () => client.rpc('purge_archived_project', { p_project_id: PROJECT }),
      'projects delete': () => client.from('projects').delete().eq('id', PROJECT).select(),
      'give project away (projects.user_id)': () => client.from('projects').update({ user_id: me }).eq('id', PROJECT).select(),
    };
    try {
      for (const [label, call] of Object.entries(attempts)) {
        const result = await call();
        expect(refused(result), `${key}: ${label} went through: ${JSON.stringify(result.data)}`).toBe(true);
      }
      expect(await snapshot(), `${key} changed the project, its invites or members`).toBe(before);

      const rename = await client.from('projects').update({ name: `Renamed by ${key}` }).eq('id', PROJECT).select('id');
      if (key === 'viewer') {
        expect(refused(rename), 'viewer renamed the project').toBe(true);
        expect(await snapshot()).toBe(before);
      } else {
        expect(rename.error).toBeNull();
        expect(rename.data).toHaveLength(1);
      }
    } finally {
      await admin.from('projects').update({ name: E2E_PROJECT.name, user_id: owner, user_archived_at: null, user_archive_expires_at: null, user_archived_by: null, archive_group_id: null }).eq('id', PROJECT);
      await admin.from('project_invites').delete().like('token', `owner-only-${key}-%`);
      await admin.from('project_collaborators').delete().eq('project_id', PROJECT).eq('user_id', stranger);
    }
  });
}
