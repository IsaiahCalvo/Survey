/* Projects: the project settings card (flag `project-access`, Drawboard
   Projects parity PS-01..09). Like Drawboard's "Change settings": a cover
   picture with a pencil, the name, a description and who can open the
   project (Private, or everyone in the company with one role). Owners change
   access; editors may change the cover, name and description; viewers only
   read. Also: the cover picture for the project header, the "What can each
   role do?" card, and the close / reopen / leave calls. */
import { useEffect, useMemo, useRef, useState } from 'react';
import DialogCard from '../components/DialogCard.jsx';
import { useTooltip } from '../components/Tooltip';
import { Icon } from '../home/HubShell';
import { supabase, isSupabaseAvailable } from '../supabaseClient';
import { normalizeMediaMime, preparePhotoForUpload } from '../services/surveyMediaService';
import { signPhotoUrls } from '../projectPhotos/projectPhotosData.js';
import {
  ACCESS_COMPANY, ACCESS_PRIVATE, COMPANY_ROLES, DESCRIPTION_MAX, NAME_MAX, ROLE_GUIDE,
  accessOf, accessSummary, coverPath, settingsChanges, settingsProblem,
} from './projectAccess.js';
import './projectAccess.css';

const BUCKET = 'project-photos';
const COVER_MAX_BYTES = 10 * 1024 * 1024;

/* ---- Data ---------------------------------------------------------------- */

let orgPromise = null;
/** The signed-in person's company ({ id, name }) or null; asked once a session. */
export function loadMyCompany({ fresh = false } = {}) {
  if (!isSupabaseAvailable()) return Promise.resolve(null);
  if (!orgPromise || fresh) {
    orgPromise = supabase.rpc('get_my_organization')
      .then(({ data, error }) => (error || !data?.id ? null : { id: data.id, name: data.name || '' }))
      .catch(() => null);
  }
  return orgPromise;
}

async function uploadCover(project, file) {
  const mime0 = normalizeMediaMime(file?.type, file?.name);
  if (!String(mime0 || '').startsWith('image/')) throw new Error(`"${file?.name || 'That file'}" is not a picture.`);
  const { blob, mime } = await preparePhotoForUpload(file, mime0);
  const path = coverPath(project.id, project.cover_path, mime);
  if (!path) throw new Error('Use a JPEG, PNG or WebP picture.');
  if (blob.size > COVER_MAX_BYTES) throw new Error('That picture is over 10 MB.');
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: true });
  if (up.error) throw new Error(up.error.message || 'The picture could not be uploaded.');
  return path;
}

/** Saves what changed. Returns { project } with the fresh row, or { error }. */
export async function saveProjectSettings(project, changes) {
  const patch = {};
  let uploaded = null;
  try {
    if (changes.coverFile) { uploaded = await uploadCover(project, changes.coverFile); patch.cover_path = uploaded; }
    else if (changes.removeCover) patch.cover_path = null;
    if (changes.name) patch.name = changes.name;
    if ('description' in changes) patch.description = changes.description || null;
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      const { error } = await supabase.from('projects').update(patch).eq('id', project.id);
      if (error) throw new Error(error.message || 'The settings could not be saved.');
      const old = project.cover_path;
      if (old && old !== patch.cover_path && 'cover_path' in patch) {
        supabase.storage.from(BUCKET).remove([old]).catch(() => {});
      }
    }
    if ('access' in changes) {
      const { error } = await supabase.rpc('set_project_access', { p_project: project.id, p_role: changes.access });
      if (error) throw new Error(error.message || 'Access could not be changed.');
    }
    return { ok: true };
  } catch (e) {
    if (uploaded && uploaded !== project.cover_path) supabase.storage.from(BUCKET).remove([uploaded]).catch(() => {});
    return { error: e?.message || 'The settings could not be saved.' };
  }
}

export async function setProjectClosed(projectId, closed) {
  const { error } = await supabase.rpc('set_project_closed', { p_project: projectId, p_closed: Boolean(closed) });
  return error ? { error: error.message || 'That did not work.' } : { ok: true };
}

export async function leaveProject(projectId, userId) {
  const { data, error } = await supabase.from('project_collaborators')
    .delete().eq('project_id', projectId).eq('user_id', userId).select('id');
  if (error) return { error: error.message || 'You could not leave this project.' };
  if (!data?.length) return { error: 'You could not leave this project.' };
  return { ok: true };
}

/* ---- Cover picture ------------------------------------------------------- */

function useSignedCover(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!path) return undefined;
    signPhotoUrls([path]).then((m) => { if (alive) setUrl(m.get(path) || null); }).catch(() => {});
    return () => { alive = false; };
  }, [path]);
  return url;
}

/** Small square cover for the project header; nothing when there is none. */
export function ProjectCover({ project, size = 40 }) {
  const url = useSignedCover(project?.cover_path || null);
  if (!project?.cover_path) return null;
  return (
    <span className="project-cover-thumb" style={{ width: size, height: size }} data-project-cover>
      {url ? <img src={url} alt="" /> : null}
    </span>
  );
}

/* ---- Role guide ---------------------------------------------------------- */

export function RoleGuideDialog({ onClose }) {
  const cell = (yes) => (yes
    ? <span className="role-guide-yes" aria-label="Yes"><Icon name="check" size={13} /></span>
    : <span className="role-guide-no" aria-label="No">–</span>);
  return (
    <DialogCard title="What can each role do?" onClose={onClose} width={Math.min(560, window.innerWidth - 24)} atRoot
      footer={<button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={onClose}>Done</button>}>
      <table className="role-guide" data-role-guide>
        <thead>
          <tr><td /><th scope="col">Owner</th><th scope="col">Editor</th><th scope="col">Viewer</th></tr>
        </thead>
        <tbody>
          {ROLE_GUIDE.map((r) => (
            <tr key={r.can}><th scope="row">{r.can}</th><td>{cell(r.owner)}</td><td>{cell(r.editor)}</td><td>{cell(r.viewer)}</td></tr>
          ))}
        </tbody>
      </table>
    </DialogCard>
  );
}

/* ---- Settings card ------------------------------------------------------- */

export default function ProjectSettingsDialog({ project, role, isOwner, onClose, onSaved }) {
  const tip = useTooltip();
  const canEdit = isOwner || role === 'editor' || role === 'owner';
  const start = accessOf(project);
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [access, setAccess] = useState(start.kind);
  const [companyRole, setCompanyRole] = useState(start.role);
  const [coverFile, setCoverFile] = useState(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [company, setCompany] = useState(undefined); // undefined = loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { let alive = true; loadMyCompany().then((c) => { if (alive) setCompany(c); }); return () => { alive = false; }; }, []);

  const signed = useSignedCover(removeCover ? null : project?.cover_path || null);
  const localUrl = useMemo(() => (coverFile ? URL.createObjectURL(coverFile) : null), [coverFile]);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);
  const coverUrl = localUrl || signed;
  const hasCover = Boolean(coverFile) || (!removeCover && Boolean(project?.cover_path));

  const draft = { name, description, access, role: companyRole, coverFile, removeCover };
  const changes = settingsChanges(project, draft);
  if (!isOwner) delete changes.access;
  const problem = settingsProblem(draft);
  const dirty = Object.keys(changes).length > 0;
  const companyBlocked = company === null;

  const save = async () => {
    if (problem) { setError(problem); return; }
    if (!dirty) { onClose(); return; }
    setBusy(true);
    setError('');
    const res = await saveProjectSettings(project, changes);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onSaved?.(changes);
    onClose();
  };

  const pickCover = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setCoverFile(f);
    setRemoveCover(false);
  };

  return (
    <>
      <DialogCard
        title="Project settings"
        onClose={onClose}
        busy={busy}
        width={Math.min(520, window.innerWidth - 24)}
        atRoot
        cardProps={{ 'data-project-settings': project?.id }}
        footer={(
          <>
            <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose} disabled={busy}>Cancel</button>
            {canEdit && (
              <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" data-project-settings-save onClick={save} disabled={busy || Boolean(problem)}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            )}
          </>
        )}
      >
        <div className="project-settings">
          <div className={`project-settings-cover${hasCover ? ' has-cover' : ''}`}>
            {hasCover && coverUrl ? <img src={coverUrl} alt="" /> : null}
            {!hasCover && <span className="project-settings-cover-empty"><Icon name="image" size={18} />No cover picture</span>}
            {canEdit && (
              <div className="project-settings-cover-actions">
                <button type="button" className="project-settings-cover-btn" aria-label={hasCover ? 'Change cover picture' : 'Add cover picture'}
                  data-project-cover-pick onClick={() => fileRef.current?.click()} {...tip(hasCover ? 'Change cover picture' : 'Add cover picture', 'below')}>
                  <Icon name="edit" size={14} />
                </button>
                {hasCover && (
                  <button type="button" className="project-settings-cover-btn" aria-label="Remove cover picture" data-project-cover-remove
                    onClick={() => { setCoverFile(null); setRemoveCover(true); }} {...tip('Remove cover picture', 'below')}>
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden data-project-cover-input onChange={pickCover} />
          </div>

          <label className="project-settings-field">
            <span>Project name</span>
            <input type="text" value={name} maxLength={NAME_MAX} disabled={!canEdit} data-project-settings-name onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="project-settings-field">
            <span>Description</span>
            <textarea rows={3} value={description} maxLength={DESCRIPTION_MAX} disabled={!canEdit} data-project-settings-description
              placeholder={canEdit ? 'What is this project for?' : ''} onChange={(e) => setDescription(e.target.value)} />
          </label>

          <fieldset className="project-settings-access" disabled={!isOwner}>
            <legend>Who can open this project</legend>
            <div role="radiogroup" aria-label="Project access" className="project-settings-radios">
              <button type="button" role="radio" aria-checked={access === ACCESS_PRIVATE} data-project-access="private"
                className={`project-settings-radio${access === ACCESS_PRIVATE ? ' is-on' : ''}`} onClick={() => setAccess(ACCESS_PRIVATE)}>
                <span className="project-settings-dot" aria-hidden="true" />
                <span><strong>Private</strong><small>Only people you invite</small></span>
              </button>
              <button type="button" role="radio" aria-checked={access === ACCESS_COMPANY} data-project-access="company"
                disabled={companyBlocked && access !== ACCESS_COMPANY}
                className={`project-settings-radio${access === ACCESS_COMPANY ? ' is-on' : ''}`} onClick={() => setAccess(ACCESS_COMPANY)}>
                <span className="project-settings-dot" aria-hidden="true" />
                <span>
                  <strong>{company?.name ? `Everyone in ${company.name}` : 'Everyone in my company'}</strong>
                  <small>{companyBlocked ? 'Join or start a company in Account to use this' : 'New company members get in too'}</small>
                </span>
              </button>
            </div>
            {access === ACCESS_COMPANY && (
              <div className="project-settings-role" role="radiogroup" aria-label="Company role">
                <span>They join as</span>
                {COMPANY_ROLES.map((r) => (
                  <button key={r.value} type="button" role="radio" aria-checked={companyRole === r.value} data-company-role={r.value}
                    className={`project-settings-chip${companyRole === r.value ? ' is-on' : ''}`} onClick={() => setCompanyRole(r.value)}>
                    {r.label}
                  </button>
                ))}
              </div>
            )}
            {!isOwner && <p className="project-settings-note">{accessSummary(project, company?.name)} Only the owner can change this.</p>}
          </fieldset>

          <button type="button" className="project-settings-link" data-role-guide-open onClick={() => setGuideOpen(true)}>What can each role do?</button>
          {error && <p className="project-settings-error" role="alert">{error}</p>}
        </div>
      </DialogCard>
      {guideOpen && <RoleGuideDialog onClose={() => setGuideOpen(false)} />}
    </>
  );
}
