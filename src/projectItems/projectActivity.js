/* Project Activity rules (Nightly flag project-activity), copied from
   Drawboard Projects' Activity page: the project's events newest first, in
   15-minute groups, each line "Name did this". The rows come from
   public.project_events (migration 20261110177000_project_activity.sql),
   written by the server only. Pure: no React, no network. */
import { formatDue, localDay, statusLabel } from './projectItems.js';

export const ACTIVITY_PAGE = 50;
export const ACTIVITY_BUCKET_MS = 15 * 60 * 1000;

const q = (v) => `'${v}'`;
const roleWord = (r) => String(r || 'viewer').toLowerCase();

/* The words after the person's name. `memberName(id)` names a teammate. */
export function describeProjectEvent(event, { memberName = () => '' } = {}) {
  const name = event?.subject_name || '';
  const action = String(event?.action || '');
  const [kind, verb] = action.startsWith('issue_') || action.startsWith('task_')
    ? [action.slice(0, action.indexOf('_')), action.slice(action.indexOf('_') + 1)]
    : [null, null];
  if (kind) {
    const one = kind === 'task' ? 'task' : 'issue';
    switch (verb) {
      case 'created': return `created the ${one} ${name}`;
      case 'deleted': return `deleted the ${one} ${name}`;
      case 'archived': return `archived the ${one} ${name}`;
      case 'unarchived': return `unarchived the ${one} ${name}`;
      case 'status': return `changed the status of ${name} from ${q(statusLabel(event.from_value))} to ${q(statusLabel(event.to_value))}`;
      case 'assignee':
        return event.to_value
          ? `assigned ${name} to ${memberName(event.to_value) || 'a teammate'}`
          : `removed the assignee of ${name}`;
      case 'due':
        return event.to_value
          ? `set the due date of ${name} to ${q(formatDue(event.to_value, localDay()))}`
          : `removed the due date of ${name}`;
      default: return `changed ${name}`;
    }
  }
  switch (action) {
    case 'project_created': return 'created the project';
    case 'project_renamed': return `renamed the project from ${q(event.from_value || '')} to ${q(event.to_value || '')}`;
    case 'document_added': return `added ${name}`;
    case 'document_deleted': return `deleted ${name}`;
    case 'document_moved_in': return `moved ${name} into the project`;
    case 'document_moved_out': return `moved ${name} out of the project`;
    case 'document_renamed': return `renamed ${q(event.from_value || '')} to ${q(event.to_value || '')}`;
    case 'document_archived': return `archived ${name}`;
    case 'document_unarchived': return `unarchived ${name}`;
    case 'document_revised': return `added ${name || 'a new version'} as a new version of ${event.from_value || 'a document'}`;
    case 'document_revision':
      return event.from_value
        ? `changed the revision of ${name} from ${q(event.from_value)} to ${q(event.to_value)}`
        : `set the revision of ${name} to ${q(event.to_value)}`;
    case 'member_added': return `added ${name || 'a teammate'} as ${roleWord(event.to_value)}`;
    case 'member_removed': return `removed ${name || 'a teammate'}`;
    case 'member_role': return `changed ${name || 'a teammate'} from ${roleWord(event.from_value)} to ${roleWord(event.to_value)}`;
    default: return 'made a change';
  }
}

/* Drawboard groups the feed in 15-minute slots: the slot's start. */
export function activityBucket(iso) {
  const at = Date.parse(iso || '');
  return Number.isFinite(at) ? Math.floor(at / ACTIVITY_BUCKET_MS) * ACTIVITY_BUCKET_MS : 0;
}

/* Events (newest first) -> [{ at, events }] slots, newest first. */
export function groupActivity(events) {
  const groups = [];
  for (const event of events || []) {
    const at = activityBucket(event.created_at);
    const last = groups[groups.length - 1];
    if (last && last.at === at) last.events.push(event);
    else groups.push({ at, events: [event] });
  }
  return groups;
}

/* A slot's heading: "Today, 3:45 PM", "Yesterday, 9:00 AM" or "Nov 3, 2:15 PM". */
export function bucketLabel(at, now = Date.now(), locale = undefined) {
  const when = new Date(at);
  const time = when.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const day = new Date(now);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(when, day)) return `Today, ${time}`;
  const yesterday = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
  if (sameDay(when, yesterday)) return `Yesterday, ${time}`;
  const date = when.toLocaleDateString(locale, when.getFullYear() === day.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
  return `${date}, ${time}`;
}

/* The document an event points at, when it still exists in the project. */
export function eventDocumentId(event) {
  return String(event?.action || '').startsWith('document_') && event.action !== 'document_deleted' && event.action !== 'document_moved_out'
    ? event.subject_id || null
    : null;
}
