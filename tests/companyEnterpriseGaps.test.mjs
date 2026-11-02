// Enterprise gaps after #1269 (beta 'company-admin') and the AI connector
// export: company invite emails (send-invite-email + send-email binding),
// the shared storage pool and require-SSO guard rails in the migration, the
// Microsoft sign-in flag, and the connector's export text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  handleSendInviteEmail, companyInviteUrl, CANONICAL_ORIGIN,
} from '../supabase/functions/send-invite-email/handler.js';
import { authorizeUserSend, userTemplateSubject, USER_TEMPLATES, INVITE_TEMPLATES } from '../supabase/functions/send-email/policy.js';
import { inviteEmailSummary, describeActivity } from '../src/services/companyService.js';
import { companySignInRequiredMessage } from '../src/utils/companySignIn.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { csvCell, surveyItemsCsv, surveySummaryText, EXPORT_CSV_MAX_ROWS } from '../supabase/functions/_shared/surveyExportText.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const MIGRATION = read('supabase/migrations/20261102170000_company_pool_invite_email_require_sso.sql');
const INVITE_ID = '11111111-2222-4333-8444-555555555555';

function companyDeps(overrides = {}) {
  const calls = { claim: [], release: [], send: [] };
  const deps = {
    anonKey: 'anon',
    getUserFromToken: async () => ({ id: 'u1', email: 'owner@acme.com' }),
    selectInviteRow: async () => { throw new Error('company invites never read token tables'); },
    claimCompanyInviteEmail: async (id) => { calls.claim.push(id); return { email: 'sam@acme.com', role: 'admin', company_name: 'Acme Builders', expires_at: '2026-11-16T00:00:00Z' }; },
    releaseCompanyInviteEmail: async (id) => { calls.release.push(id); },
    sendFallbackEmail: async (payload) => { calls.send.push(payload); return { outcome: 'confirmed' }; },
    ...overrides,
  };
  return { deps, calls };
}
const post = (body) => ({ method: 'POST', authHeader: 'Bearer user-jwt', body });

test('company invite email: server copy of the invite, link back to where it was made', async () => {
  const { deps, calls } = companyDeps();
  const out = await handleSendInviteEmail(post({ companyInviteId: INVITE_ID, inviterName: 'Olive', appOrigin: 'https://surveytool-nightly.vercel.app' }), deps);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { sent: true });
  assert.deepEqual(calls.claim, [INVITE_ID]);
  assert.equal(calls.send.length, 1);
  const [mail] = calls.send;
  assert.equal(mail.to, 'sam@acme.com');
  assert.equal(mail.template, 'company-invite');
  assert.equal(mail.data.companyName, 'Acme Builders');
  assert.equal(mail.data.role, 'an admin');
  assert.equal(mail.data.inviteUrl, 'https://surveytool-nightly.vercel.app/?settings=company');
});

test('company invite email: unknown origins fall back to the live app', () => {
  assert.equal(companyInviteUrl('https://evil.example'), `${CANONICAL_ORIGIN}/?settings=company`);
  assert.equal(companyInviteUrl(undefined), `${CANONICAL_ORIGIN}/?settings=company`);
});

test('company invite email: not theirs / closed / just sent gets one answer and sends nothing', async () => {
  const { deps, calls } = companyDeps({ claimCompanyInviteEmail: async () => null });
  const out = await handleSendInviteEmail(post({ companyInviteId: INVITE_ID }), deps);
  assert.equal(out.status, 409);
  assert.equal(calls.send.length, 0);
});

test('company invite email: a bad id never reaches the database', async () => {
  const { deps, calls } = companyDeps();
  const out = await handleSendInviteEmail(post({ companyInviteId: 'not-a-uuid' }), deps);
  assert.equal(out.status, 400);
  assert.equal(calls.claim.length, 0);
});

test('company invite email: plan gate gives the claim back and says why', async () => {
  const { deps, calls } = companyDeps({ sendFallbackEmail: async () => ({ outcome: 'definite-failure', status: 403 }) });
  const out = await handleSendInviteEmail(post({ companyInviteId: INVITE_ID }), deps);
  assert.equal(out.status, 403);
  assert.deepEqual(calls.release, [INVITE_ID]);
});

test('company invite email: an unknown outcome keeps the claim (no double email)', async () => {
  const { deps, calls } = companyDeps({ sendFallbackEmail: async () => ({ outcome: 'uncertain' }) });
  const out = await handleSendInviteEmail(post({ companyInviteId: INVITE_ID }), deps);
  assert.equal(out.status, 502);
  assert.equal(out.body.retryable, false);
  assert.equal(calls.release.length, 0);
});

test('company invite email: signed-out callers are refused before any claim', async () => {
  const { deps, calls } = companyDeps({ getUserFromToken: async () => null });
  const out = await handleSendInviteEmail(post({ companyInviteId: INVITE_ID }), deps);
  assert.equal(out.status, 401);
  assert.equal(calls.claim.length, 0);
});

test('send-email binds company-invite to an open company invite and gates it like any invite', async () => {
  assert.ok(USER_TEMPLATES.includes('company-invite'));
  assert.ok(INVITE_TEMPLATES.includes('company-invite'));
  const base = {
    findInviteRowForRecipient: async () => null,
    findActiveCollaboratorForRecipient: async () => null,
    claimSendBudget: async () => 'allowed',
  };
  const unbound = await authorizeUserSend({ template: 'company-invite', to: 'sam@acme.com' }, base);
  assert.equal(unbound.ok, false);
  assert.equal(unbound.status, 403);
  const bound = await authorizeUserSend({ template: 'company-invite', to: 'sam@acme.com' },
    { ...base, findCompanyInviteForRecipient: async () => ({ id: INVITE_ID }) });
  assert.equal(bound.ok, true);
  const free = await authorizeUserSend({ template: 'company-invite', to: 'sam@acme.com' },
    { ...base, findCompanyInviteForRecipient: async () => ({ id: INVITE_ID }), claimSendBudget: async (_t, _r, isInvite) => (isInvite ? 'invite_blocked_free_tier' : 'allowed') });
  assert.equal(free.status, 403);
  assert.equal(userTemplateSubject('company-invite', { inviterName: 'Olive', companyName: 'Acme' }), 'Olive invited you to join Acme on Survey');
});

test('invite banner says whether the email went out', () => {
  assert.equal(inviteEmailSummary([{ address: 'a@x.com', email: 'sent' }]),
    'Invited a@x.com. We emailed them; they join from Settings, Company.');
  assert.match(inviteEmailSummary([{ address: 'b@x.com', email: 'needs-plan' }]), /need Pro or a paid company plan/);
  assert.match(inviteEmailSummary([{ address: 'c@x.com', email: 'failed' }]), /did not go out/);
});

test('require-SSO log rows and the sign-in note read as words', () => {
  assert.equal(describeActivity({ action: 'sso.required', details: { domains: ['acme.com'] } }).extra, 'for acme.com');
  assert.match(companySignInRequiredMessage('acme.com'), /^acme\.com asks you to sign in with your work account/);
  assert.match(companySignInRequiredMessage(''), /^Your company asks/);
});

test('migration: pooled storage only for paid seats, one lock per company, non-growing saves still pass', () => {
  const fn = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.enforce_documents_storage_quota'));
  assert.match(fn, /if v_new_size <= v_old_size then\s+return NEW;/);
  const nonGrowing = fn.indexOf('if v_new_size <= v_old_size');
  const pool = fn.indexOf('_company_seated(v_owner)');
  assert.ok(nonGrowing > 0 && pool > nonGrowing, 'the pool check comes after the non-growing fast path');
  assert.match(fn, /'kal390org:' \|\| v_org::text/);
  assert.match(fn, /public\._company_storage_used\(v_org, NEW\.bucket_id, NEW\.name\)/);
  assert.match(MIGRATION, /revoke all on function public\._company_storage_used\(uuid, text, text\) from public, anon, authenticated/);
});

test('migration: the sign-in hook can only say no to non-SSO tokens at required domains, and never fails closed', () => {
  const hook = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.custom_access_token_hook'));
  assert.match(hook, /exception when others then\s+return event;/);
  assert.match(hook, /if not public\._sso_required_for_email\(v_email\) then\s+return event;/);
  assert.match(hook, /if public\._amr_has_sso\(event->'claims'->'amr'\) then\s+return event;/);
  assert.match(MIGRATION, /revoke all on function public\.custom_access_token_hook\(jsonb\) from public, anon, authenticated/);
  assert.match(MIGRATION, /grant execute on function public\.custom_access_token_hook\(jsonb\) to supabase_auth_admin/);
  // Turning it on needs connected SSO + a proved domain, and an SSO session
  // when the admin's own email is at that domain.
  const setter = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.set_organization_require_sso'));
  assert.match(setter, /sso_provider_id is null or coalesce\(cardinality\(v_domains\), 0\) = 0/);
  assert.match(setter, /not public\._amr_has_sso\(auth\.jwt\(\)->'amr'\)/);
  // Disconnecting SSO drops the requirement.
  assert.match(MIGRATION, /NEW\.require_sso := false/);
});

test('migration: invite email claim is owner/admin only with a 10 minute resend gap', () => {
  const claim = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.claim_company_invite_email'));
  assert.match(claim, /my_org_role\(v_inv\.organization_id\), ''\) not in \('owner', 'admin'\)/);
  assert.match(claim, /interval '10 minutes'/);
});

test('Microsoft sign-in is a beta flag seeded off, hidden in the store apps', () => {
  assert.equal(FEATURE_FLAGS['microsoft-sign-in']?.stage, 'beta');
  assert.match(MIGRATION, /\('microsoft-sign-in', 'off'/);
  const modal = read('src/components/AuthModal.jsx');
  assert.match(modal, /microsoftOn && !isGoogleSignInHidden\(\)/);
  assert.match(read('src/contexts/AuthContext.jsx'), /provider: 'azure'/);
});

const ITEMS = [
  { name: 'D-2', category: 'Door', entity: 'Done', page: 1, answers: [{ item: 'Closer', answer: 'Y' }, { item: 'Lock', answer: 'N' }], note: 'Scratched, "left" leaf', files: 2 },
  { name: 'C-1', category: 'Camera', entity: null, page: null, answers: [{ item: 'Mounted', answer: null }], note: '=cmd()', files: 0 },
];

test('connector export: summary counts by category and status', () => {
  const textOut = surveySummaryText(ITEMS, { title: 'L2.pdf' });
  assert.match(textOut, /^L2\.pdf: 2 items/);
  assert.match(textOut, /Checklist: 2 of 3 answered, 1 answered No/);
  assert.match(textOut, /- Door: 1/);
  assert.match(textOut, /- Done: 1/);
});

test('connector export: CSV quotes and cannot run formulas', () => {
  const lines = surveyItemsCsv(ITEMS).trim().split('\r\n');
  assert.equal(lines[0], 'Item,Category,Status,Page,Answered,Of,Answers,Note,Photos and files');
  assert.equal(lines[1], 'D-2,Door,Done,1,2,2,Closer: Y; Lock: N,"Scratched, ""left"" leaf",2');
  assert.ok(lines[2].includes("'=cmd()"));
  assert.equal(csvCell('+1'), "'+1");
  const many = Array.from({ length: EXPORT_CSV_MAX_ROWS + 5 }, (_, i) => ({ name: `I-${i}`, answers: [] }));
  assert.equal(surveyItemsCsv(many).trim().split('\r\n').length, EXPORT_CSV_MAX_ROWS + 1);
});
