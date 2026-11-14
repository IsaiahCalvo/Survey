// "Assigned to you" email for an issue or task (Nightly flag
// 'item-assign-email', Drawboard Projects parity NT-01 / IS-10). The app asks
// right after it sets the assignee; notify-comment-mentions sends it. Plain
// JS so the Node tests and the e2e harness can run it against a database.
//
// The server trusts nothing in the request but the item id: the assignee and
// the person who assigned them come from the item's own activity log (the
// project_items_log trigger writes it, no client can forge it). Only the
// person who made that change may ask, within a few minutes, and each
// assignment is emailed once (project_item_assign_emails).
import { isUuid, mentionLinkOrigin } from './commentMentions.js';

export const ITEM_ASSIGN_WINDOW_MS = 15 * 60 * 1000;

const KINDS = { issue: { one: 'issue', prefix: 'ISS' }, task: { one: 'task', prefix: 'TSK' } };

export function itemKindWord(kind) {
  return (KINDS[kind] || KINDS.issue).one;
}

export function itemCodeOf(item) {
  return `${(KINDS[item?.kind] || KINDS.issue).prefix}-${Number(item?.number) || 0}`;
}

/**
 * Why this assignment may not be emailed now, or null when it may.
 * `event` is the newest 'assignee' row of the item's activity log.
 */
export function assignEmailRefusal({ item, event, callerId, nowMs = Date.now() }) {
  if (!item) return 'not-found';
  if (item.archived_at) return 'archived';
  if (!item.assignee_id) return 'unassigned';
  if (item.assignee_id === callerId) return 'self';
  if (!event || event.to_value !== item.assignee_id) return 'no-change';
  if (event.actor_id !== callerId) return 'not-actor';
  const at = Date.parse(event.created_at);
  if (!Number.isFinite(at) || nowMs - at > ITEM_ASSIGN_WINDOW_MS) return 'too-late';
  return null;
}

/** The link that opens the item in its project (SurveyHub ?project=&item=&kind=). */
export function itemLink(origin, item) {
  const url = new URL(mentionLinkOrigin(origin));
  url.searchParams.set('project', item.project_id);
  url.searchParams.set('item', item.id);
  url.searchParams.set('kind', item.kind === 'task' ? 'task' : 'issue');
  return url.toString();
}

/**
 * Check the request and claim the assignment, so two calls never both send.
 * Returns { refusal } or { item, email, projectName, assignedAt }.
 * `admin` is a service-role client.
 */
export async function prepareItemAssignEmail({ admin, callerId, itemId, nowMs = Date.now() }) {
  if (!isUuid(itemId)) return { refusal: 'bad-request' };
  const { data: item } = await admin.from('project_items')
    .select('id, project_id, kind, number, title, assignee_id, due_date, archived_at')
    .eq('id', itemId).maybeSingle();
  const { data: event } = item
    ? await admin.from('project_item_events')
      .select('actor_id, to_value, created_at')
      .eq('item_id', itemId).eq('action', 'assignee')
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(1).maybeSingle()
    : { data: null };
  const refusal = assignEmailRefusal({ item, event, callerId, nowMs });
  if (refusal) return { refusal };

  const { error: claimError } = await admin.from('project_item_assign_emails')
    .insert({ item_id: item.id, assignee_id: item.assignee_id, assigned_at: event.created_at });
  if (claimError) return { refusal: claimError.code === '23505' ? 'already-sent' : 'claim-failed' };

  const { data: person } = await admin.auth.admin.getUserById(item.assignee_id);
  const email = person?.user?.email || null;
  if (!email) return { refusal: 'no-email' };
  const { data: project } = await admin.from('projects').select('name').eq('id', item.project_id).maybeSingle();
  return { item, email, projectName: project?.name || 'a project', assignedAt: event.created_at };
}
