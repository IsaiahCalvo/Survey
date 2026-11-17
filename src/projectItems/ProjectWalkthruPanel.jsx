/* Project Walkthru tab (KAL-595, Nightly flag 'suite'). The walks added to
   this Project from Walkthru, read only: each walk opens whole in Walkthru's
   read-only viewer (nodes, notes, audio, transcript), and its photos, audio,
   video, notes and next actions are listed here in folders. Plain nodes (no
   Category) show only here and in that viewer; Survey's own tools never get
   them. Rules and data: suite/projectWalks.js. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, Icon } from '../home/HubShell';
import { supabase as defaultClient, isSupabaseAvailable } from '../supabaseClient';
import { releaseChannel } from '../featureFlags.js';
import {
  PROJECT_WALKS_EVENT, formatDuration, listProjectWalks, projectWalkFolders, projectWalkUrl, readProjectWalk,
} from '../suite/projectWalks.js';
import { timeAgo } from './projectItems.js';
import './projectItems.css';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The walks of one Project; [] when off, offline or none. */
export function useProjectWalks({ projectId, enabled = true, client = defaultClient } = {}) {
  const live = Boolean(enabled && projectId && UUID_RE.test(String(projectId)) && client && isSupabaseAvailable());
  const [walks, setWalks] = useState([]);
  const [loading, setLoading] = useState(live);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;

  const reload = useCallback(async () => {
    if (!live) return;
    const forProject = projectId;
    try {
      const rows = await listProjectWalks(client, forProject);
      if (projectRef.current === forProject) setWalks(rows);
    } catch {
      // Offline or not allowed: the tab stays hidden until the next try.
    } finally {
      if (projectRef.current === forProject) setLoading(false);
    }
  }, [client, live, projectId]);

  useEffect(() => {
    setWalks([]);
    if (!live) { setLoading(false); return undefined; }
    setLoading(true);
    reload();
    const onChanged = (event) => {
      const changed = event?.detail?.projectId;
      if (!changed || changed === projectId) reload();
    };
    window.addEventListener(PROJECT_WALKS_EVENT, onChanged);
    return () => window.removeEventListener(PROJECT_WALKS_EVENT, onChanged);
  }, [live, projectId, reload]);

  return { live, walks, loading, reload };
}

const FOLDERS = [
  { key: 'photos', label: 'Site photos', icon: 'image', count: 'photos' },
  { key: 'audio', label: 'Audio', icon: 'mic', count: 'audio' },
  { key: 'video', label: 'Video', icon: 'video', count: 'videos' },
  { key: 'notes', label: 'Notes', icon: 'note', count: 'notes' },
  { key: 'nextActions', label: 'Next actions', icon: 'check', count: 'nextActions' },
];

function folderLine(key, item, now) {
  if (key === 'photos' || key === 'video') {
    const what = key === 'photos' ? 'Photo' : 'Video';
    return { text: item.node ? `${what} at ${item.node}` : what, meta: '' };
  }
  if (key === 'audio') {
    return { text: item.label, meta: [formatDuration(item.durationMs), item.startedAt ? timeAgo(item.startedAt, now) : ''].filter(Boolean).join(' · ') };
  }
  if (key === 'notes') return { text: item.text, meta: item.node || '' };
  return { text: item.title, meta: item.done ? 'Done' : '' };
}

function WalkCard({ walk, projectId, client, phone, now }) {
  const [open, setOpen] = useState(null); // folder key
  const [bundle, setBundle] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | ready | failed
  const url = projectWalkUrl(releaseChannel(), projectId, walk.id);

  const toggle = async (key) => {
    const next = open === key ? null : key;
    setOpen(next);
    if (!next || state === 'loading' || state === 'ready') return;
    setState('loading');
    try {
      const got = await readProjectWalk(client, projectId, walk.id);
      setBundle(got);
      setState(got ? 'ready' : 'failed');
    } catch {
      setState('failed');
    }
  };

  const folders = bundle ? projectWalkFolders(bundle) : null;
  const c = walk.counts;
  const summary = [
    `${c.floors} ${c.floors === 1 ? 'page' : 'pages'}`,
    `${c.nodes} ${c.nodes === 1 ? 'node' : 'nodes'}`,
    c.plainNodes ? `${c.plainNodes} plain` : null,
  ].filter(Boolean).join(' · ');

  return (
    <section className="project-walk" data-project-walk={walk.id}>
      <header className="project-walk__head">
        <span className="project-walk__badge" aria-hidden="true"><Icon name="pagePin" size={phone ? 16 : 14} /></span>
        <span className="project-walk__title">
          <b>{walk.name}</b>
          <span>{[walk.address, summary, walk.addedAt ? `added ${timeAgo(walk.addedAt, now)}` : null].filter(Boolean).join(' · ')}</span>
        </span>
        <button
          type="button"
          className="btn"
          data-project-walk-open
          onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
        >
          Open walk
        </button>
      </header>
      <div className="project-walk__folders" role="list">
        {FOLDERS.map((f) => {
          const count = c[f.count] || 0;
          const isOpen = open === f.key;
          const items = folders ? folders[f.key] : [];
          return (
            <div key={f.key} role="listitem" className="project-walk__folder">
              <button
                type="button"
                className="project-walk__folder-row"
                aria-expanded={isOpen}
                disabled={!count}
                data-project-walk-folder={f.key}
                onClick={() => toggle(f.key)}
              >
                <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} />
                <Icon name={f.icon} size={14} />
                <span className="project-walk__folder-name">{f.label}</span>
                <span className="project-walk__count">{count}</span>
              </button>
              {isOpen ? (
                <div className="project-walk__items" data-project-walk-items={f.key}>
                  {state === 'loading' ? <div className="project-activity__note">Loading…</div> : null}
                  {state === 'failed' ? <div className="project-activity__note">The walk could not load. Try again when you are online.</div> : null}
                  {state === 'ready' && !items.length ? <div className="project-activity__note">Nothing here.</div> : null}
                  {state === 'ready' && items.map((item) => {
                    const line = folderLine(f.key, item, now);
                    return (
                      <div key={item.id} className="project-walk__item">
                        <span className="project-walk__item-text">{line.text}</span>
                        {line.meta ? <span className="project-walk__item-meta">{line.meta}</span> : null}
                      </div>
                    );
                  })}
                  {state === 'ready' && items.length > 0 && (f.key === 'photos' || f.key === 'video' || f.key === 'audio') ? (
                    <div className="project-activity__note">Open the walk to see and play them.</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ProjectWalkthruPanel({ project, walks = [], loading = false, phone = false, client = defaultClient }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className={`project-activity project-walks${phone ? ' is-phone' : ''}`} data-project-walkthru>
      <div className="project-activity__scroll slim-scroll">
        {loading && !walks.length ? <div className="project-activity__note">Loading walks…</div> : null}
        {!loading && !walks.length ? (
          <EmptyState icon="pagePin" line="No Walkthru walks yet" description="Add a walk with From Walkthru. Its photos, audio, video, notes and next actions show here." />
        ) : null}
        {walks.map((walk) => (
          <WalkCard key={walk.id} walk={walk} projectId={project?.id} client={client} phone={phone} now={now} />
        ))}
      </div>
    </div>
  );
}
