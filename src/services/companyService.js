// Company workspace (Enterprise, beta flag 'company-admin'): people, roles,
// seats, the shared storage pool and the activity log. Every write is a
// database function (supabase/migrations/20261028020000_company_workspace.sql)
// that checks the caller's role itself; this file only calls them and turns
// rows into words.
import { supabase } from '../supabaseClient.js';

export const COMPANY_FLAG = 'company-admin';
export const ACTIVITY_PAGE_SIZE = 50;

// What each logged action reads as in the list ("Olive renamed a project").
const ACTION_WORDS = Object.freeze({
  'company.created': 'created the company',
  'company.renamed': 'renamed the company',
  'member.invited': 'invited',
  'member.invite_canceled': 'canceled the invite for',
  'member.invite_declined': 'declined the invite',
  'member.joined': 'joined the company',
  'member.role_changed': 'changed the role of',
  'member.removed': 'removed',
  'member.left': 'left the company',
  'project.created': 'created project',
  'project.renamed': 'renamed project',
  'project.archived': 'archived project',
  'project.restored': 'restored project',
  'project.deleted': 'deleted project',
  'project.shared': 'shared project',
  'project.role_changed': 'changed access to project',
  'project.unshared': 'removed access to project',
  'project.invite_sent': 'sent an invite to project',
  'document.uploaded': 'uploaded',
  'document.renamed': 'renamed',
  'document.moved': 'moved',
  'document.deleted': 'deleted',
  'document.edited': 'marked up',
  'document.shared': 'shared',
  'document.role_changed': 'changed access to',
  'document.unshared': 'removed access to',
  'domain.added': 'added the domain',
  'domain.verified': 'proved the domain',
  'domain.removed': 'removed the domain',
  'sso.connected': 'connected company sign-in',
  'sso.updated': 'updated company sign-in',
  'sso.disconnected': 'disconnected company sign-in',
  'billing.updated': 'updated the company plan',
});
const BILLING_WORDS = Object.freeze({ active: 'paid', trialing: 'on trial', past_due: 'payment due', canceled: 'ended', none: 'not paid' });

// Filter chips in the log. Each matches an action prefix.
export const ACTIVITY_KINDS = Object.freeze([
  { id: 'all', label: 'Everything', prefix: '' },
  { id: 'people', label: 'People', prefix: 'member.' },
  { id: 'sharing', label: 'Sharing', prefix: '' },
  { id: 'projects', label: 'Projects', prefix: 'project.' },
  { id: 'documents', label: 'Documents', prefix: 'document.' },
]);

const ROLE_WORDS = Object.freeze({ owner: 'Owner', admin: 'Admin', member: 'Member', editor: 'Editor', viewer: 'Viewer' });
export const roleLabel = (role) => ROLE_WORDS[role] || (role ? String(role) : '');

export function describeActivity(row) {
  const action = String(row?.action || '');
  const verb = ACTION_WORDS[action] || action.replace(/[._]/g, ' ');
  const d = row?.details && typeof row.details === 'object' ? row.details : {};
  const target = row?.target_label || '';
  let extra = '';
  if (action === 'member.role_changed' && d.from && d.to) extra = `${roleLabel(d.from)} to ${roleLabel(d.to)}`;
  else if (action === 'member.invited' && d.role) extra = `as ${roleLabel(d.role).toLowerCase()}`;
  else if (action === 'member.removed' && d.projects_handed_off > 0 && d.handoff_to) {
    extra = `${d.projects_handed_off} project${d.projects_handed_off === 1 ? '' : 's'} handed to ${d.handoff_to}`;
  } else if (/\.(shared|role_changed|unshared|invite_sent)$/.test(action) && d.person) {
    extra = action.endsWith('unshared') ? `for ${d.person}` : `with ${d.person}${d.role ? ` as ${roleLabel(d.role).toLowerCase()}` : ''}`;
  } else if (/\.renamed$/.test(action) && d.from) extra = `from ${d.from}`;
  // Self events name nobody else.
  const selfOnly = action === 'member.joined' || action === 'member.left' || action === 'member.invite_declined'
    || action === 'sso.disconnected';
  if (action.startsWith('sso.') && Array.isArray(d.domains)) extra = `for ${d.domains.join(', ')}`;
  if (action === 'billing.updated') {
    const state = BILLING_WORDS[d.status] || '';
    extra = d.status === 'canceled' ? '(ended)' : `to ${d.seats} seats${state ? ` (${state})` : ''}`;
    return { verb, target: '', extra };
  }
  return { verb, target: selfOnly ? '' : target, extra };
}

export function activitySentence(row) {
  const who = row?.actor_email || 'Someone';
  const { verb, target, extra } = describeActivity(row);
  return [who, verb, target, extra].filter(Boolean).join(' ');
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  // A cell starting with = + - @ would run as a formula in Excel.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function activityToCsv(rows) {
  const head = ['When (UTC)', 'Person', 'Action', 'What', 'Details'];
  const lines = [head.join(',')];
  for (const row of rows || []) {
    const { extra } = describeActivity(row);
    lines.push([
      row.created_at, row.actor_email || '', row.action, row.target_label || '', extra,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function formatBytesShort(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

// Supabase answers {data, error}; turn the error into the sentence the
// database wrote (they are written for people) or a plain fallback.
function unwrap({ data, error }, fallback) {
  if (error) throw new Error(error.message || fallback);
  return data;
}

export async function getMyCompany() {
  return unwrap(await supabase.rpc('get_my_organization'), 'Could not load your company.');
}

export async function createCompany(name) {
  return unwrap(await supabase.rpc('create_organization', { p_name: name }), 'Could not create the company.');
}

export async function renameCompany(orgId, name) {
  return unwrap(await supabase.rpc('rename_organization', { p_org: orgId, p_name: name }), 'Could not rename the company.');
}

export async function listCompanyMembers(orgId) {
  return unwrap(await supabase.rpc('list_organization_members', { p_org: orgId }), 'Could not load the people list.') || [];
}

export async function listCompanyInvites(orgId) {
  return unwrap(await supabase
    .from('organization_invites')
    .select('id, email, role, created_at, expires_at')
    .eq('organization_id', orgId)
    .is('accepted_at', null).is('revoked_at', null).is('declined_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }), 'Could not load invites.') || [];
}

export async function inviteToCompany(orgId, email, role) {
  return unwrap(await supabase.rpc('invite_organization_member', { p_org: orgId, p_email: email, p_role: role }), `Could not invite ${email}.`);
}

export async function cancelCompanyInvite(inviteId) {
  return unwrap(await supabase.rpc('revoke_organization_invite', { p_invite: inviteId }), 'Could not cancel the invite.');
}

export async function myCompanyInvites() {
  return unwrap(await supabase.rpc('my_organization_invites'), 'Could not load your invites.') || [];
}

export async function acceptCompanyInvite(inviteId) {
  return unwrap(await supabase.rpc('accept_organization_invite', { p_invite: inviteId }), 'Could not join the company.');
}

export async function declineCompanyInvite(inviteId) {
  return unwrap(await supabase.rpc('decline_organization_invite', { p_invite: inviteId }), 'Could not decline the invite.');
}

export async function setCompanyRole(orgId, userId, role) {
  return unwrap(await supabase.rpc('set_organization_member_role', { p_org: orgId, p_user: userId, p_role: role }), 'Could not change the role.');
}

export async function removeFromCompany(orgId, userId, handoffTo = null) {
  return unwrap(await supabase.rpc('remove_organization_member', { p_org: orgId, p_user: userId, p_handoff_to: handoffTo }), 'Could not remove this person.');
}

export async function leaveCompany(orgId) {
  return unwrap(await supabase.rpc('leave_organization', { p_org: orgId }), 'Could not leave the company.');
}

export async function deleteCompany(orgId) {
  return unwrap(await supabase.rpc('delete_organization', { p_org: orgId }), 'Could not delete the company.');
}

// One page of the log, newest first. beforeId pages backwards.
export async function listCompanyActivity(orgId, { beforeId = null, actorId = null, kind = 'all', limit = ACTIVITY_PAGE_SIZE } = {}) {
  let q = supabase
    .from('organization_activity')
    .select('id, actor_id, actor_email, action, target_type, target_label, project_id, document_id, details, created_at')
    .eq('organization_id', orgId)
    .order('id', { ascending: false })
    .limit(limit);
  if (beforeId) q = q.lt('id', beforeId);
  if (actorId) q = q.eq('actor_id', actorId);
  const def = ACTIVITY_KINDS.find((k) => k.id === kind);
  if (def?.prefix) q = q.like('action', `${def.prefix}%`);
  else if (def?.id === 'sharing') q = q.or('action.like.*.shared,action.like.*.unshared,action.like.*_changed,action.like.*.invite_sent').not('action', 'like', 'member.%');
  return unwrap(await q, 'Could not load the activity log.') || [];
}

/* ---------- Company sign-in setup (domains + SAML) ---------- */

export async function listCompanyDomains(orgId) {
  return unwrap(await supabase
    .from('organization_domains')
    .select('id, domain, verification_token, verified_at, created_at')
    .eq('organization_id', orgId)
    .order('created_at'), 'Could not load your domains.') || [];
}

export async function addCompanyDomain(orgId, domain) {
  return unwrap(await supabase.rpc('add_organization_domain', { p_org: orgId, p_domain: domain }), 'Could not add the domain.');
}

export async function removeCompanyDomain(domainId) {
  return unwrap(await supabase.rpc('remove_organization_domain', { p_domain_id: domainId }), 'Could not remove the domain.');
}

// The company-sso function answers { error } in words; invoke() hides the
// body behind error.context.
async function callCompanySso(body) {
  const { data, error } = await supabase.functions.invoke('company-sso', { body });
  if (error) {
    let text = '';
    try { text = (await error.context?.json?.())?.error || ''; } catch { /* not JSON */ }
    throw new Error(text || 'Survey could not reach company sign-in setup. Try again.');
  }
  return data;
}

export const checkCompanyDomain = (orgId, domainId) => callCompanySso({ action: 'check-domain', orgId, domainId });
export const connectCompanySignIn = (orgId, { metadataUrl = '', metadataXml = '' } = {}) => callCompanySso({
  action: 'connect', orgId, ...(metadataUrl.trim() ? { metadataUrl } : {}), ...(metadataXml.trim() ? { metadataXml } : {}),
});
export const disconnectCompanySignIn = (orgId) => callCompanySso({ action: 'disconnect', orgId });

// The two details a company's IT person types into their login system
// (Okta, Microsoft Entra, Google Workspace...), from Survey's Supabase URL.
export function signOnLinks(supabaseUrl) {
  const base = String(supabaseUrl || '').replace(/\/+$/, '');
  return {
    entityId: `${base}/auth/v1/sso/saml/metadata`,
    acsUrl: `${base}/auth/v1/sso/saml/acs`,
  };
}

export function itSetupText({ companyName, links, domains = [] }) {
  return [
    `Set up Survey (surveytool.app) as a SAML app for ${companyName || 'our company'}.`,
    '',
    `Entity ID / Audience / Identifier: ${links.entityId}`,
    `ACS URL / Reply URL / Single sign-on URL: ${links.acsUrl}`,
    `Survey metadata (if your system can read it): ${links.entityId}`,
    'Name ID: the person\'s email address. Also send the attribute "email".',
    domains.length ? `People sign in with emails at: ${domains.join(', ')}` : '',
    '',
    'When it is saved, send back the app\'s metadata URL (or the metadata XML file).',
  ].filter((line, i, all) => line || all[i - 1]).join('\n');
}

// Seats on one bill. Enterprise is $20 per person a month with 3 at least,
// and never fewer seats than the people and open invites already holding one
// (create-checkout-session checks the same).
export const SEAT_PRICE_USD = 20;
export const MIN_SEATS = 3;
export const minSeatsFor = (company) => Math.max(MIN_SEATS, Number(company?.seats_used) || 0);
export const seatsCost = (seats) => `$${(Math.max(0, Math.floor(Number(seats) || 0)) * SEAT_PRICE_USD).toLocaleString('en-US')} a month`;

async function invokeForUrl(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let text = '';
    try { text = (await error.context?.json?.())?.error || ''; } catch { /* not JSON */ }
    throw new Error(text || 'Could not open billing. Try again.');
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.url) throw new Error('Could not open billing. Try again.');
  return data.url;
}

export const companyCheckoutUrl = (orgId, seats, returnUrl) => invokeForUrl('create-checkout-session', {
  tier: 'enterprise', billingPeriod: 'monthly', orgId, seats, returnUrl,
});
// The card and seat count live on the payer's own Stripe customer.
export const companyBillingUrl = (returnUrl) => invokeForUrl('create-portal-session', { returnUrl });
