/**
 * CompanyPanel.jsx — Settings -> Company (Enterprise, beta flag 'company-admin').
 *
 * The company workspace: one list of a company's people with roles (owner,
 * admin, member), invites by email, seats, the shared storage pool and the
 * activity log the database writes for every project, document, share and
 * people change. Pro is for a person; this is the part a company pays
 * Enterprise for (/mnt/project-files/security/pro-vs-enterprise.md).
 *
 * The database checks every action's role itself (companyService.js); the
 * buttons here are hidden for people who could not use them anyway.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirmDialog } from '../dialogPrompts';
import ValueSelect from '../ValueSelect.jsx';
import { deliverGeneratedFile } from '../../utils/xfdfExport/deliverFile.js';
import {
  ACTIVITY_KINDS, ACTIVITY_PAGE_SIZE, acceptCompanyInvite, activitySentence, activityToCsv,
  cancelCompanyInvite, createCompany, declineCompanyInvite, deleteCompany, formatBytesShort,
  getMyCompany, inviteToCompany, leaveCompany, listCompanyActivity, listCompanyInvites,
  listCompanyMembers, myCompanyInvites, removeFromCompany, renameCompany, roleLabel, setCompanyRole,
} from '../../services/companyService.js';
import './CompanyPanel.css';

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
];
const INVITE_ROLE_OPTIONS = ROLE_OPTIONS.slice(0, 2);
const CSV_MAX_ROWS = 10000;

const when = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never');

function parseEmails(raw) {
  return [...new Set((raw || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

const coarsePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

// The app's drop-down on a desktop; phones keep the browser's own list.
function Picker({ label, value, options, onChange, disabled, width = '120px' }) {
  if (coarsePointer()) {
    return (
      <select className="company-native-select" aria-label={label} value={value} disabled={disabled}
        onChange={(e) => { if (e.target.value !== value) onChange(e.target.value); }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return <ValueSelect look="field" size="sm" width={width} label={label} value={value} options={options} onChange={onChange} disabled={disabled} />;
}

function Meter({ used, limit }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="company-meter" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
      <div className="company-meter-fill" style={{ width: `${Math.max(pct, used > 0 ? 1 : 0)}%` }} />
    </div>
  );
}

/* ---------- No company yet: invites waiting + create ---------- */
function NoCompany({ onChanged, setError, setMessage }) {
  const [invites, setInvites] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    myCompanyInvites().then((rows) => { if (live) setInvites(rows); }).catch((err) => { if (live) { setInvites([]); setError(err.message); } });
    return () => { live = false; };
  }, [setError]);

  const run = async (fn, done) => {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); if (done) setMessage(done); await onChanged(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <>
      <section className="account-section">
        <h3>Company</h3>
        <p className="account-section-description">
          A company workspace keeps all your people in one list, with roles, seats on one bill,
          one shared storage pool and a log of who did what. It is part of the Enterprise plan.
        </p>
        {invites && invites.length > 0 && (
          <ul className="company-list" aria-label="Company invites for you">
            {invites.map((inv) => (
              <li key={inv.id} className="company-row">
                <div className="company-row-main">
                  <div className="company-row-title">{inv.organization_name}</div>
                  <div className="company-row-sub">
                    {inv.invited_by_email ? `${inv.invited_by_email} invited you` : 'You are invited'} as {roleLabel(inv.role).toLowerCase()}
                  </div>
                </div>
                <div className="company-row-actions">
                  <button type="button" className="account-btn-secondary" disabled={busy}
                    onClick={() => run(() => declineCompanyInvite(inv.id), 'Invite declined.')}>Decline</button>
                  <button type="button" className="account-btn-primary" disabled={busy}
                    onClick={() => run(() => acceptCompanyInvite(inv.id), `You joined ${inv.organization_name}.`)}>Join</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="account-section">
        <h3>Start a company workspace</h3>
        <form className="company-inline-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(() => createCompany(name.trim()), 'Company workspace created.'); }}>
          <div className="account-form-group company-grow">
            <label htmlFor="company-new-name">Company name</label>
            <input id="company-new-name" value={name} maxLength={120} placeholder="Acme Builders" onChange={(e) => setName(e.target.value)} disabled={busy} />
          </div>
          <button type="submit" className="account-btn-primary" disabled={busy || !name.trim()}>Create</button>
        </form>
      </section>
    </>
  );
}

/* ---------- People ---------- */
function People({ company, members, invites, isAdmin, isOwner, me, reload, setError, setMessage }) {
  const [askConfirm, confirmDialog] = useConfirmDialog();
  const [emails, setEmails] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null); // user_id of the row asking how to remove
  const [handoff, setHandoff] = useState(me);

  const admins = members.filter((m) => m.role === 'owner' || m.role === 'admin');
  const seatsLeft = Math.max(0, company.seat_limit - company.seats_used);

  const act = async (fn, done) => {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); if (done) setMessage(done); await reload(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const sendInvites = async (e) => {
    e.preventDefault();
    const list = parseEmails(emails);
    if (list.length === 0) return;
    setBusy(true); setError(''); setMessage('');
    const sent = [];
    const failed = [];
    for (const email of list) {
      try { await inviteToCompany(company.id, email, inviteRole); sent.push(email); } catch (err) { failed.push(err.message); }
    }
    setBusy(false);
    if (sent.length) { setEmails(''); setMessage(`Invited ${sent.join(', ')}. They join from Settings, Company.`); }
    if (failed.length) setError(failed.join(' '));
    await reload();
  };

  // Owners change any role; admins move people between admin and member.
  const canEditRole = (m) => isAdmin && m.user_id !== me && (isOwner || m.role !== 'owner');
  const canRemove = (m) => m.user_id !== me && (isOwner || (isAdmin && m.role !== 'owner'));

  return (
    <section className="account-section">
      <h3>People</h3>
      <p className="account-section-description">
        {company.member_count} {company.member_count === 1 ? 'person' : 'people'}
        {invites.length > 0 ? `, ${invites.length} invited` : ''}. Seats left: {seatsLeft} of {company.seat_limit}.
      </p>

      {isAdmin && (
        <form className="company-inline-form" onSubmit={sendInvites}>
          <div className="account-form-group company-grow">
            <label htmlFor="company-invite-emails">Invite by email</label>
            <input id="company-invite-emails" value={emails} placeholder="name@company.com, another@company.com"
              onChange={(e) => setEmails(e.target.value)} disabled={busy || seatsLeft === 0} />
          </div>
          <Picker label="Role for new people" value={inviteRole} options={INVITE_ROLE_OPTIONS} onChange={setInviteRole} disabled={busy} width="110px" />
          <button type="submit" className="account-btn-primary" disabled={busy || seatsLeft === 0 || parseEmails(emails).length === 0}>Invite</button>
        </form>
      )}
      {isAdmin && seatsLeft === 0 && (
        <p className="company-note">All seats are taken. Remove someone, or add seats once company billing opens.</p>
      )}

      <ul className="company-list" aria-label="People in the company">
        {members.map((m) => (
          <li key={m.user_id} className="company-row">
            <span className="company-avatar" aria-hidden="true">{(m.full_name || m.email || '?').slice(0, 1).toUpperCase()}</span>
            <div className="company-row-main">
              <div className="company-row-title">
                {m.full_name || m.email}{m.user_id === me ? <span className="company-tag">You</span> : null}
              </div>
              <div className="company-row-sub">
                {m.full_name ? `${m.email} · ` : ''}Last signed in {day(m.last_sign_in_at)} · {formatBytesShort(m.storage_bytes)}
              </div>
              {removing === m.user_id && (
                <div className="company-remove-box">
                  <p>Take {m.full_name || m.email} out of {company.name}? They keep their own account and projects.</p>
                  <label className="company-check">
                    <input type="checkbox" checked={Boolean(handoff)} onChange={(e) => setHandoff(e.target.checked ? me : null)} />
                    Give an admin edit access to the projects they made while in the company
                  </label>
                  {handoff && admins.length > 1 && (
                    <Picker label="Who gets their projects" value={handoff}
                      options={admins.filter((a) => a.user_id !== m.user_id).map((a) => ({ value: a.user_id, label: a.full_name || a.email }))}
                      onChange={setHandoff} disabled={busy} width="220px" />
                  )}
                  <div className="company-row-actions">
                    <button type="button" className="account-btn-secondary" disabled={busy} onClick={() => setRemoving(null)}>Cancel</button>
                    <button type="button" className="account-btn-danger" disabled={busy}
                      onClick={() => act(async () => {
                        const handed = await removeFromCompany(company.id, m.user_id, handoff || null);
                        setRemoving(null);
                        setMessage(`Removed ${m.email}.${handed ? ` ${handed} project${handed === 1 ? '' : 's'} handed over.` : ''}`);
                      })}>Remove</button>
                  </div>
                </div>
              )}
            </div>
            <div className="company-row-actions">
              {canEditRole(m) ? (
                <Picker label={`Role for ${m.email}`} value={m.role}
                  options={isOwner ? ROLE_OPTIONS : INVITE_ROLE_OPTIONS}
                  onChange={(role) => act(async () => {
                    if (role === 'owner' && !(await askConfirm({
                      title: 'Make an owner?',
                      message: `${m.email} will be able to change anyone's role, remove anyone and delete the company.`,
                      confirmLabel: 'Make owner',
                    }))) return;
                    await setCompanyRole(company.id, m.user_id, role);
                  })} disabled={busy} width="110px" />
              ) : (
                <span className="company-role">{roleLabel(m.role)}</span>
              )}
              {canRemove(m) && removing !== m.user_id && (
                <button type="button" className="account-btn-secondary" disabled={busy}
                  onClick={() => { setHandoff(me); setRemoving(m.user_id); }}>Remove</button>
              )}
            </div>
          </li>
        ))}
        {invites.map((inv) => (
          <li key={inv.id} className="company-row is-pending">
            <span className="company-avatar" aria-hidden="true">@</span>
            <div className="company-row-main">
              <div className="company-row-title">{inv.email}<span className="company-tag">Invited</span></div>
              <div className="company-row-sub">{roleLabel(inv.role)} · sent {day(inv.created_at)} · ends {day(inv.expires_at)}</div>
            </div>
            {isAdmin && (
              <div className="company-row-actions">
                <button type="button" className="account-btn-secondary" disabled={busy}
                  onClick={() => act(() => cancelCompanyInvite(inv.id), `Invite for ${inv.email} canceled.`)}>Cancel invite</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {confirmDialog}
    </section>
  );
}

/* ---------- Activity log ---------- */
function Activity({ company, members, version, setError }) {
  const [rows, setRows] = useState([]);
  const [kind, setKind] = useState('all');
  const [actor, setActor] = useState('');
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async (beforeId = null) => {
    setLoading(true);
    try {
      const page = await listCompanyActivity(company.id, { beforeId, actorId: actor || null, kind });
      setRows((prev) => (beforeId ? [...prev, ...page] : page));
      setMore(page.length === ACTIVITY_PAGE_SIZE);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, [company.id, actor, kind, setError]);

  // version moves on every change made on this page, so the log shows it.
  useEffect(() => { load(null); }, [load, version]);

  const download = async () => {
    setNote('Getting the whole log…');
    try {
      const all = [];
      let before = null;
      while (all.length < CSV_MAX_ROWS) {
        const page = await listCompanyActivity(company.id, { beforeId: before, actorId: actor || null, kind, limit: 1000 });
        all.push(...page);
        if (page.length < 1000) break;
        before = page[page.length - 1].id;
      }
      const slug = company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
      await deliverGeneratedFile({
        data: activityToCsv(all),
        fileName: `${slug}-activity-${new Date().toISOString().slice(0, 10)}.csv`,
        mimeType: 'text/csv',
        title: 'Save activity log',
        filterName: 'CSV',
        extensions: ['csv'],
      });
      setNote(`Downloaded ${all.length} rows.`);
    } catch (err) { setNote(''); setError(err.message || 'Could not download the log.'); }
  };

  const actorOptions = useMemo(() => [{ value: '', label: 'Everyone' },
    ...members.map((m) => ({ value: m.user_id, label: m.full_name || m.email }))], [members]);

  return (
    <section className="account-section">
      <h3>Activity log</h3>
      <p className="account-section-description">
        Who made, shared, renamed, moved, marked up or deleted what, across every project your people own.
        Survey writes it on the server, so it cannot be skipped or edited. Only owners and admins see it.
      </p>
      <div className="company-filters">
        <div className="company-chips" role="group" aria-label="What to show">
          {ACTIVITY_KINDS.map((k) => (
            <button key={k.id} type="button" className={`company-chip${kind === k.id ? ' is-on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>
          ))}
        </div>
        <Picker label="Person" value={actor} options={actorOptions} onChange={setActor} width="180px" />
        <button type="button" className="account-btn-secondary" onClick={download} disabled={rows.length === 0}>Download CSV</button>
        <span className="company-note" role="status" aria-live="polite">{note}</span>
      </div>
      {rows.length === 0 && !loading ? (
        <p className="company-note">Nothing here yet.</p>
      ) : (
        <ul className="company-log" aria-label="Activity">
          {rows.map((r) => (
            <li key={r.id} className="company-log-row">
              <span className="company-log-text">{activitySentence(r)}</span>
              <time className="company-log-when" dateTime={r.created_at}>{when(r.created_at)}</time>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <button type="button" className="account-btn-secondary company-more" disabled={loading} onClick={() => load(rows[rows.length - 1]?.id)}>
          {loading ? 'Loading…' : 'Show older'}
        </button>
      )}
    </section>
  );
}

/* ---------- The panel ---------- */
export default function CompanyPanel() {
  const { user } = useAuth();
  const me = user?.id || null;
  const [company, setCompany] = useState(undefined); // undefined = loading, null = none
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [askConfirm, confirmDialog] = useConfirmDialog();
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    setVersion((v) => v + 1);
    try {
      const next = await getMyCompany();
      setCompany(next || null);
      if (next) {
        const admin = next.my_role === 'owner' || next.my_role === 'admin';
        const [people, open] = await Promise.all([
          listCompanyMembers(next.id),
          admin ? listCompanyInvites(next.id) : Promise.resolve([]),
        ]);
        setMembers(people);
        setInvites(open);
      }
    } catch (err) {
      setCompany((prev) => (prev === undefined ? null : prev));
      setError(err.message);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (company === undefined) return <section className="account-section"><h3>Company</h3><p className="company-note">Loading…</p></section>;

  const banner = (
    <>
      {error && <div className="account-error" role="alert">{error}</div>}
      {message && <div className="account-message" role="status">{message}</div>}
    </>
  );

  if (!company) {
    return <>{banner}<NoCompany onChanged={reload} setError={setError} setMessage={setMessage} /></>;
  }

  const isOwner = company.my_role === 'owner';
  const isAdmin = isOwner || company.my_role === 'admin';
  const ownerCount = members.filter((m) => m.role === 'owner').length;
  const paid = company.billing_status === 'active' || company.billing_status === 'trialing';

  const act = async (fn, done) => {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); if (done) setMessage(done); await reload(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <>
      {banner}
      <section className="account-section">
        {renaming ? (
          <form className="company-inline-form" onSubmit={(e) => { e.preventDefault(); act(async () => { await renameCompany(company.id, name); setRenaming(false); }, 'Company renamed.'); }}>
            <div className="account-form-group company-grow">
              <label htmlFor="company-rename">Company name</label>
              <input id="company-rename" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <button type="button" className="account-btn-secondary" onClick={() => setRenaming(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="account-btn-primary" disabled={busy || !name.trim()}>Save</button>
          </form>
        ) : (
          <div className="company-head">
            <h3>{company.name}</h3>
            <span className="company-tag">{roleLabel(company.my_role)}</span>
            {isAdmin && <button type="button" className="account-text-link company-link" onClick={() => { setName(company.name); setRenaming(true); }}>Rename</button>}
          </div>
        )}
        <div className="company-stats">
          <div className="company-stat">
            <div className="company-stat-label">Seats</div>
            <div className="company-stat-value">{company.seats_used} of {company.seat_limit}</div>
            <Meter used={company.seats_used} limit={company.seat_limit} />
          </div>
          <div className="company-stat">
            <div className="company-stat-label">Shared storage</div>
            <div className="company-stat-value">{formatBytesShort(company.storage_used_bytes)} of {formatBytesShort(company.storage_limit_bytes)}</div>
            <Meter used={company.storage_used_bytes} limit={company.storage_limit_bytes} />
          </div>
          <div className="company-stat">
            <div className="company-stat-label">Company plan</div>
            <div className="company-stat-value">{paid ? 'Enterprise' : 'Not paid yet'}</div>
          </div>
        </div>
        {!paid && (
          <p className="company-note">
            Until the company plan is paid, everyone keeps the plan on their own account. Paying for seats on one bill is coming soon.
          </p>
        )}
      </section>

      <People company={company} members={members} invites={invites} isAdmin={isAdmin} isOwner={isOwner} me={me}
        reload={reload} setError={setError} setMessage={setMessage} />

      {isAdmin && <Activity company={company} members={members} version={version} setError={setError} />}

      <section className="account-section account-danger-zone">
        <h3>Leave or delete</h3>
        <p className="account-danger-zone-description">
          Projects and documents belong to the people who made them, so they stay when someone leaves or the company is deleted.
        </p>
        <div className="company-row-actions">
          {!(isOwner && ownerCount <= 1) && (
            <button type="button" className="account-btn-danger" disabled={busy}
              onClick={async () => {
                if (!(await askConfirm({ title: `Leave ${company.name}?`, message: 'You go back to the plan on your own account. An admin can invite you again.', confirmLabel: 'Leave company', danger: true }))) return;
                act(() => leaveCompany(company.id), `You left ${company.name}.`);
              }}>Leave company</button>
          )}
          {isOwner && (
            <button type="button" className="account-btn-danger" disabled={busy || paid}
              onClick={async () => {
                if (!(await askConfirm({ title: `Delete ${company.name}?`, message: 'The people list, invites and activity log are deleted. Everyone keeps their own account and projects.', confirmLabel: 'Delete company', danger: true }))) return;
                act(() => deleteCompany(company.id), 'Company deleted.');
              }}>Delete company</button>
          )}
        </div>
      </section>
      {confirmDialog}
    </>
  );
}
