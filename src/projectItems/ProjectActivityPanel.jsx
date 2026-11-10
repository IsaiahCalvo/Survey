/* Project Activity (Nightly flag project-activity), copied from Drawboard
   Projects' Activity page: what happened to the project, newest first, in
   15-minute groups, with Load more. Rules: projectActivity.js. A document
   still in the project opens from its line. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, EmptyState } from '../home/HubShell';
import { presenceInitials } from '../components/presenceIdentity.js';
import { supabase as defaultClient, isSupabaseAvailable } from '../supabaseClient';
import { ACTIVITY_PAGE, bucketLabel, describeProjectEvent, eventDocumentId, groupActivity } from './projectActivity.js';
import { timeAgo } from './projectItems.js';
import './projectItems.css';

const COLUMNS = 'id, actor_id, action, subject_id, subject_name, from_value, to_value, created_at';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useProjectActivity({ projectId, client = defaultClient } = {}) {
  const live = Boolean(projectId && UUID_RE.test(String(projectId)) && client && isSupabaseAvailable());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(live);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(null);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;

  const read = useCallback(async (before = null) => {
    let query = client.from('project_events').select(COLUMNS).eq('project_id', projectId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(ACTIVITY_PAGE + 1);
    if (before) query = query.lt('created_at', before.created_at);
    const { data, error: err } = await query;
    return { rows: data || [], err };
  }, [client, projectId]);

  const reload = useCallback(async () => {
    if (!live) return;
    const forProject = projectId;
    const { rows, err } = await read();
    if (projectRef.current !== forProject) return;
    setLoading(false);
    if (err) { setError(err.message || 'load failed'); return; }
    setError(null);
    setMore(rows.length > ACTIVITY_PAGE);
    setEvents(rows.slice(0, ACTIVITY_PAGE));
  }, [live, projectId, read]);

  const loadMore = useCallback(async () => {
    if (!live || !events.length) return;
    const forProject = projectId;
    const last = events[events.length - 1];
    const { rows, err } = await read(last);
    if (projectRef.current !== forProject || err) return;
    setMore(rows.length > ACTIVITY_PAGE);
    setEvents((cur) => {
      const seen = new Set(cur.map((e) => e.id));
      return [...cur, ...rows.slice(0, ACTIVITY_PAGE).filter((e) => !seen.has(e.id))];
    });
  }, [events, live, projectId, read]);

  useEffect(() => {
    setEvents([]);
    setMore(false);
    if (!live) { setLoading(false); return undefined; }
    setLoading(true);
    reload();
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [live, reload]);

  return { live, events, loading, more, error, reload, loadMore };
}

export default function ProjectActivityPanel({ project, lookupMember, documents = [], onOpenDocument, phone = false, user = null }) {
  const data = useProjectActivity({ projectId: project?.id });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nameOf = (id) => {
    if (!id) return 'Someone';
    if (id === user?.id) return 'You';
    return lookupMember?.(id)?.name || 'Teammate';
  };
  const docsById = new Map(documents.map((d) => [String(d.id), d]));
  const groups = groupActivity(data.events);

  return (
    <div className={`project-activity${phone ? ' is-phone' : ''}`} data-project-activity>
      <div className="project-activity__scroll slim-scroll">
        {data.loading && !data.events.length ? <div className="project-activity__note">Loading activity…</div> : null}
        {!data.loading && !data.events.length ? (
          <EmptyState icon="clock" line="No activity yet" description="Files added, renamed or archived, new revisions, issue and task changes and team changes show here." />
        ) : null}
        {groups.map((group) => (
          <section key={group.at} className="project-activity__group" data-activity-group>
            <h3 className="project-activity__when">{bucketLabel(group.at, now)}</h3>
            {group.events.map((event) => {
              const docId = eventDocumentId(event);
              const doc = docId ? docsById.get(String(docId)) : null;
              const text = describeProjectEvent(event, { memberName: nameOf });
              const who = nameOf(event.actor_id);
              const body = (
                <>
                  <Avatar initials={presenceInitials(who === 'You' ? (user?.user_metadata?.full_name || user?.email || 'You') : who)} id={event.actor_id || 'system'} size={phone ? 28 : 24} />
                  <span className="project-activity__text"><b>{who}</b> {text}</span>
                  <span className="project-activity__ago">{timeAgo(event.created_at, now)}</span>
                </>
              );
              return doc && onOpenDocument ? (
                <button key={event.id} type="button" className="project-activity__row is-link" data-activity-event={event.action} onClick={() => onOpenDocument(doc)}>
                  {body}
                </button>
              ) : (
                <div key={event.id} className="project-activity__row" data-activity-event={event.action}>{body}</div>
              );
            })}
          </section>
        ))}
        {data.more ? (
          <button type="button" className="btn project-activity__more" data-activity-more onClick={data.loadMore}>Load more</button>
        ) : null}
        {data.error ? <div className="project-activity__note">Activity could not load. It will try again when you come back.</div> : null}
      </div>
    </div>
  );
}
