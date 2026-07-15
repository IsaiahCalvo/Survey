import test from 'node:test';
import { doesNotMatch, equal, match } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { isServiceRoleCaller } from '../supabase/functions/send-email/auth.js';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('send-email accepts only the configured service-role bearer token', () => {
  equal(isServiceRoleCaller('Bearer service-secret', 'service-secret'), true);
  equal(isServiceRoleCaller('bearer service-secret', 'service-secret'), true);
  equal(isServiceRoleCaller('Bearer signed-user-jwt', 'service-secret'), false);
  equal(isServiceRoleCaller('Bearer public-anon-key', 'service-secret'), false);
  equal(isServiceRoleCaller(null, 'service-secret'), false);
  equal(isServiceRoleCaller('Bearer service-secret', ''), false);
});

test('manage-collaborator-access wiring uses caller RLS for mutations and service role only for trusted lookups/send', () => {
  const source = read('supabase/functions/manage-collaborator-access/index.ts');
  match(source, /from '\.\/handler\.js'/);
  match(source, /createClient\(SUPABASE_URL, ANON_KEY, \{\s*global: \{ headers: \{ Authorization: authHeader \} \}/);
  match(source, /callerClient[\s\S]*\.from\(table\)/);
  doesNotMatch(source, /adminClient\s*\.from\(/);
  match(source, /adminClient\.auth\.admin\.getUserById/);
  match(source, /functions\/v1\/send-email/);
  match(source, /Bearer \$\{SERVICE_ROLE_KEY\}/);

  const config = read('supabase/config.toml');
  match(config, /\[functions\.manage-collaborator-access\]\s*\nverify_jwt = false/);
});

test('browser clients use the narrow access-mutation endpoint, never the generic email relay', () => {
  const emailService = read('src/services/shareEmailService.js');
  match(emailService, /export async function manageCollaboratorAccess/);
  match(emailService, /functions\.invoke\('manage-collaborator-access'/);
  doesNotMatch(emailService, /functions\.invoke\('send-email'/);
  doesNotMatch(emailService, /sendPermissionChangedEmail|sendAccessRemovedEmail/);

  const documentService = read('src/services/documentAnnotationService.js');
  match(documentService, /manageCollaboratorAccess\(\{\s*kind: 'document'/);

  const projectService = read('src/services/projectInviteService.js');
  match(projectService, /manageCollaboratorAccess\(\{\s*kind: 'project'/);

  for (const modal of ['src/home/AccessManagementModal.jsx', 'src/home/ManageTeamModal.jsx']) {
    const source = read(modal);
    doesNotMatch(source, /sendPermissionChangedEmail|sendAccessRemovedEmail/);
  }
});
