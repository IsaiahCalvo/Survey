import React from 'react';
import ShareModal from './ShareModal';

const C = {
  scrim: 'rgba(13,15,20,0.55)',
  card: '#181c24',
  deep: '#12151c',
  rule: '#2a3140',
  ink: '#f4f1ea',
  inkSoft: '#e8e2d4',
  muted: '#8d96a6',
  gold: '#d8a84e',
  danger: '#cf6f6f',
};

const ROLES = ['Owner', 'Editor', 'Viewer'];
const MONO_FONT = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';

const initialsOf = (name) => (name || '')
  .trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '-';

const labelForKind = (kind) => {
  if (kind === 'template') return 'Template Access';
  if (kind === 'document') return 'Document Access';
  return 'Access';
};

export default function AccessManagementModal({ open, onClose, kind = 'document', item = null, user = null }) {
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [members, setMembers] = React.useState(() => []);

  React.useEffect(() => {
    const ownerName = user?.name || user?.email?.split('@')[0] || 'You';
    setMembers([
      {
        id: user?.id || 'owner',
        name: ownerName,
        email: user?.email || '',
        role: 'Owner',
        added: 'Owner',
        color: C.gold,
      },
      {
        id: 'viewer-placeholder',
        name: 'Shared link recipients',
        email: 'Managed by invite links',
        role: 'Viewer',
        added: 'Link',
        color: '#8d96a6',
      },
    ]);
  }, [item?.id, user?.id, user?.email, user?.name]);

  if (!open) return null;

  const name = item?.name || item?.title || 'Untitled';
  const noun = kind === 'template' ? 'template' : 'document';

  const setRole = (id, role) => {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, role } : m)));
  };

  const removeMember = (id) => {
    setMembers((prev) => prev.filter((m) => m.id !== id || m.role === 'Owner'));
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: C.scrim, backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300, fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: '92vw', background: C.card, border: `1px solid ${C.rule}`, borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', color: C.ink, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '84vh' }}>
          <div style={{ padding: '16px 18px 14px', borderBottom: `1px solid ${C.rule}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 3, height: 30, background: C.gold, borderRadius: 2, flex: 'none', marginRight: 10 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, letterSpacing: 0.14, textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>{labelForKind(kind)}</div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.015, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
            </div>
            <button onClick={() => setInviteOpen(true)} style={{ flex: 'none', background: C.gold, color: '#15110a', border: 0, borderRadius: 6, padding: '5px 11px', height: 28, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Invite</button>
            <button onClick={onClose} title="Close" style={{ background: 'transparent', border: `1px solid ${C.rule}`, color: C.muted, width: 24, height: 24, borderRadius: 6, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, display: 'grid', placeItems: 'center', fontFamily: 'inherit', flex: 'none' }}>x</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 1fr 1fr 24px', gap: 14, alignItems: 'center', padding: '8px 18px 6px', borderBottom: `1px solid ${C.rule}`, fontSize: 10.5, letterSpacing: 0.14, textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>
            <span />
            <span>Users</span>
            <span>Role</span>
            <span>Added</span>
            <span />
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '6px 8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {members.map((m) => {
              const isOwner = m.role === 'Owner';
              return (
                <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 1fr 1fr 24px', gap: 14, alignItems: 'center', padding: '8px 10px', borderRadius: 6, height: 50, boxSizing: 'border-box' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: m.color, color: '#15110a', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, flex: 'none' }}>{initialsOf(m.name)}</div>
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                    <div style={{ fontFamily: MONO_FONT, fontSize: 11, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</div>
                  </div>
                  <select value={m.role} disabled={isOwner} onChange={(e) => setRole(m.id, e.target.value)} style={{ background: 'transparent', border: 0, padding: '0 14px 0 0', color: C.inkSoft, font: 'inherit', fontFamily: 'inherit', fontSize: 11.5, height: 24, lineHeight: '24px', textAlign: 'left', cursor: isOwner ? 'not-allowed' : 'pointer', width: 'max-content', maxWidth: '100%' }}>
                    {ROLES.map((role) => <option key={role}>{role}</option>)}
                  </select>
                  <div style={{ fontFamily: MONO_FONT, fontSize: 11.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.added}</div>
                  <button disabled={isOwner} onClick={() => removeMember(m.id)} title="Remove" style={{ width: 24, height: 24, borderRadius: 6, padding: 0, background: 'transparent', border: 0, color: isOwner ? C.muted : C.danger, cursor: isOwner ? 'not-allowed' : 'pointer', fontSize: 16, lineHeight: 1, fontFamily: 'inherit' }}>x</button>
                </div>
              );
            })}
          </div>

          <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10.5, color: C.muted, letterSpacing: 0.06, textTransform: 'uppercase', fontWeight: 700 }}>{members.length} member{members.length === 1 ? '' : 's'}</span>
            <button onClick={onClose} style={{ background: C.gold, color: '#15110a', border: 0, borderRadius: 6, padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Done</button>
          </div>
        </div>
      </div>

      <ShareModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        kind={noun}
        name={name}
      />
    </>
  );
}
