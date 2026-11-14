/* Adding Survey to a Teams channel or chat (teams/teamsPin.js): Teams opens
   <site>/teams/config in its "add a tab" window. Once signed in, the person
   picks a project and what the tab opens (its files, issues, tasks, photos
   or one drawing), then presses Teams' own Save. Everyone in the channel
   opens it with their own Survey account, so access rules stay as they are. */
import { useEffect, useMemo, useRef, useState } from 'react';
import ValueSelect from '../components/ValueSelect.jsx';
import { isFeatureOn } from '../featureFlags.js';
import { connectTeamsConfig } from './teamsHost.js';
import { PIN_LISTS, pinnedTabConfig } from './teamsPin.js';
import './teams.css';

const ONE_DRAWING = 'doc';
const fileCount = (n) => `${n} ${n === 1 ? 'file' : 'files'}`;

export default function TeamsPinPanel({ projects = [], documents = [], loading = false }) {
  const [projectId, setProjectId] = useState(null);
  const [list, setList] = useState('files');
  const [docId, setDocId] = useState('');
  const [search, setSearch] = useState('');
  const [teams, setTeams] = useState(undefined); // undefined while connecting, null when Teams never answered
  const teamsRef = useRef(null);
  const [issuesOn] = useState(() => isFeatureOn('project-issues'));
  const [photosOn] = useState(() => isFeatureOn('project-photos'));

  useEffect(() => {
    let live = true;
    connectTeamsConfig().then((link) => { if (live) { teamsRef.current = link; setTeams(link); } }).catch(() => { if (live) setTeams(null); });
    return () => { live = false; };
  }, []);

  const open = useMemo(
    () => projects.filter((p) => !p.closed_at).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [projects],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? open.filter((p) => String(p.name || '').toLowerCase().includes(q)) : open;
  }, [open, search]);
  const project = open.find((p) => p.id === projectId) || null;
  const drawings = useMemo(
    () => (project ? documents.filter((d) => d.project_id === project.id).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))) : []),
    [documents, project],
  );
  const lists = PIN_LISTS.filter((l) => (l.key === 'issue' || l.key === 'task' ? issuesOn : l.key === 'photos' ? photosOn : true));
  const drawing = list === ONE_DRAWING ? drawings.find((d) => d.id === docId) || null : null;

  const config = useMemo(() => {
    if (!project || (list === ONE_DRAWING && !drawing)) return null;
    try {
      return pinnedTabConfig(window.location.origin, {
        projectId: project.id,
        projectName: project.name,
        list: list === ONE_DRAWING ? 'files' : list,
        docId: drawing?.id || null,
        docName: drawing?.name || null,
      });
    } catch {
      return null;
    }
  }, [project, list, drawing]);

  useEffect(() => { teamsRef.current?.setChoice(config); }, [config, teams]);

  const pickProject = (id) => { setProjectId(id); setDocId(''); if (list === ONE_DRAWING) setList('files'); };

  return (
    <div className="teams-pin" role="region" aria-labelledby="teams-pin-title" data-teams-pin>
      <div className="teams-pin-inner">
        <h1 id="teams-pin-title">Pick what this tab shows</h1>
        <p className="teams-pin-help">Everyone here opens it with their own Survey account and sees only what they already have access to.</p>

        <section className="teams-pin-section" aria-labelledby="teams-pin-project">
          <h2 id="teams-pin-project">Project</h2>
          {open.length > 8 && (
            <input
              className="teams-pin-search"
              type="search"
              placeholder="Find a project"
              aria-label="Find a project"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          {loading && !open.length ? (
            <p className="teams-pin-note">Loading your projects…</p>
          ) : !open.length ? (
            <p className="teams-pin-note">You have no projects yet. Make one in Survey, then add this tab again.</p>
          ) : (
            <div className="teams-pin-projects" role="radiogroup" aria-label="Project">
              {shown.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={p.id === projectId}
                  className={`teams-pin-option${p.id === projectId ? ' is-on' : ''}`}
                  onClick={() => pickProject(p.id)}
                >
                  <strong>{p.name || 'Untitled project'}</strong>
                  <small>{fileCount(documents.filter((d) => d.project_id === p.id).length)}</small>
                </button>
              ))}
              {!shown.length && <p className="teams-pin-note">No project matches "{search.trim()}".</p>}
            </div>
          )}
        </section>

        {project && (
          <section className="teams-pin-section" aria-labelledby="teams-pin-opens">
            <h2 id="teams-pin-opens">The tab opens</h2>
            <div className="teams-pin-lists" role="radiogroup" aria-label="The tab opens">
              {[...lists, { key: ONE_DRAWING, label: 'One drawing' }].map((l) => (
                <button
                  key={l.key}
                  type="button"
                  role="radio"
                  aria-checked={list === l.key}
                  className={`teams-pin-chip${list === l.key ? ' is-on' : ''}`}
                  disabled={l.key === ONE_DRAWING && !drawings.length}
                  onClick={() => setList(l.key)}
                >
                  {l.label}
                </button>
              ))}
            </div>
            {list === ONE_DRAWING && (
              <div className="teams-pin-drawing">
                <ValueSelect
                  label="Drawing"
                  placeholder="Pick a drawing"
                  value={docId}
                  onChange={setDocId}
                  options={drawings.map((d) => ({ value: d.id, label: d.name || 'Untitled' }))}
                />
              </div>
            )}
          </section>
        )}

        <p className="teams-pin-status" role="status" data-teams-pin-status>
          {teams === null
            ? 'Open this page from Teams to add a tab.'
            : config
              ? `Press Save to add "${config.suggestedDisplayName}".`
              : project ? 'Pick a drawing to finish.' : 'Pick a project to finish.'}
        </p>
      </div>
    </div>
  );
}
