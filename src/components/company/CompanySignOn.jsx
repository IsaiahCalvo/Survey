/**
 * CompanySignOn.jsx — Settings -> Company -> Company sign-in (owners and
 * admins). The company does the whole setup itself, like a WorkOS admin
 * portal: add its email domain, add one DNS line to prove it owns it, give
 * its IT person Survey's two sign-on details, then paste back their sign-on
 * link. supabase/functions/company-sso does the DNS check and hands the
 * details to Supabase's own SAML sign-in.
 */
import { useCallback, useEffect, useState } from 'react';
import { copyTextToClipboard } from '../../utils/clipboard';
import {
  addCompanyDomain, checkCompanyDomain, connectCompanySignIn, disconnectCompanySignIn, itSetupText,
  listCompanyDomains, removeCompanyDomain, signOnLinks,
} from '../../services/companyService.js';
import { txtRecordName, txtRecordValue } from '../../../supabase/functions/_shared/companySso.js';

function CopyRow({ label, value, onCopied }) {
  return (
    <div className="company-copy-row">
      <div className="company-copy-label">{label}</div>
      <code className="company-copy-value">{value}</code>
      <button type="button" className="account-btn-secondary" aria-label={`Copy ${label}`}
        onClick={async () => { const r = await copyTextToClipboard(value, { surface: 'company_sign_on' }); onCopied(r.ok ? `${label} copied.` : 'Could not copy. Select the text instead.'); }}>
        Copy
      </button>
    </div>
  );
}

export default function CompanySignOn({ company, reload, setError, setMessage }) {
  const [domains, setDomains] = useState([]);
  const [newDomain, setNewDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [metadataUrl, setMetadataUrl] = useState('');
  const [metadataXml, setMetadataXml] = useState('');
  const [pasteXml, setPasteXml] = useState(false);
  const [checked, setChecked] = useState({}); // domain id -> 'missing'

  const links = signOnLinks(import.meta.env.VITE_SUPABASE_URL);
  const proved = domains.filter((d) => d.verified_at);

  const load = useCallback(async () => {
    try { setDomains(await listCompanyDomains(company.id)); } catch (err) { setError(err.message); }
  }, [company.id, setError]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <section className="account-section">
      <div className="company-head">
        <h3>Company sign-in</h3>
        {company.sso_connected && <span className="company-tag is-good">Connected</span>}
      </div>
      <p className="account-section-description">
        Let your people sign in to Survey with their work account (Microsoft, Okta, Google Workspace or any SAML login).
        Three steps, all done here.
      </p>

      <h4 className="company-step">1. Prove your email domain</h4>
      <form className="company-inline-form" onSubmit={(e) => {
        e.preventDefault();
        if (!newDomain.trim()) return;
        act(async () => { await addCompanyDomain(company.id, newDomain); setNewDomain(''); await load(); });
      }}>
        <div className="account-form-group company-grow">
          <label htmlFor="company-domain">Email domain</label>
          <input id="company-domain" value={newDomain} placeholder="acme.com" onChange={(e) => setNewDomain(e.target.value)} disabled={busy} />
        </div>
        <button type="submit" className="account-btn-secondary" disabled={busy || !newDomain.trim()}>Add domain</button>
      </form>
      {domains.length > 0 && (
        <ul className="company-list" aria-label="Domains">
          {domains.map((d) => (
            <li key={d.id} className="company-row">
              <div className="company-row-main">
                <div className="company-row-title">
                  {d.domain}<span className={`company-tag${d.verified_at ? ' is-good' : ''}`}>{d.verified_at ? 'Proved' : 'Not proved yet'}</span>
                </div>
                {!d.verified_at && (
                  <div className="company-dns">
                    <p className="company-row-sub">
                      Add this TXT record where {d.domain}&apos;s DNS is managed (GoDaddy, Cloudflare, Microsoft 365...), then press Check.
                      It can take a few minutes to show up.
                    </p>
                    <CopyRow label="Name" value={txtRecordName(d.domain)} onCopied={setMessage} />
                    <CopyRow label="Value" value={txtRecordValue(d.verification_token)} onCopied={setMessage} />
                    {checked[d.id] === 'missing' && (
                      <p className="company-row-sub" role="status">Survey did not find the record yet. Check the name and value, wait a few minutes and try again.</p>
                    )}
                  </div>
                )}
              </div>
              <div className="company-row-actions">
                {!d.verified_at && (
                  <button type="button" className="account-btn-primary" disabled={busy}
                    onClick={() => act(async () => {
                      const res = await checkCompanyDomain(company.id, d.id);
                      setChecked((prev) => ({ ...prev, [d.id]: res?.verified ? 'ok' : 'missing' }));
                      if (res?.verified) { setMessage(`${d.domain} is proved.`); await load(); }
                    })}>Check</button>
                )}
                <button type="button" className="account-btn-secondary" disabled={busy}
                  onClick={() => act(async () => { await removeCompanyDomain(d.id); await load(); })}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h4 className="company-step">2. Give your IT person these details</h4>
      <div className="company-copy-box">
        <CopyRow label="Entity ID" value={links.entityId} onCopied={setMessage} />
        <CopyRow label="ACS URL" value={links.acsUrl} onCopied={setMessage} />
        <button type="button" className="account-btn-secondary" onClick={async () => {
          const r = await copyTextToClipboard(itSetupText({ companyName: company.name, links, domains: proved.map((d) => d.domain) }), { surface: 'company_sign_on' });
          setMessage(r.ok ? 'Setup steps copied. Paste them into an email to your IT person.' : 'Could not copy.');
        }}>Copy all setup steps</button>
      </div>

      <h4 className="company-step">3. Paste back their sign-on details</h4>
      {proved.length === 0 ? (
        <p className="company-note">Prove a domain first (step 1).</p>
      ) : (
        <form onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            const res = await connectCompanySignIn(company.id, pasteXml ? { metadataXml } : { metadataUrl });
            setMetadataUrl(''); setMetadataXml('');
            setMessage(`Company sign-in is connected for ${res.domains.join(', ')}. People there choose "Sign in with company SSO".`);
            await reload();
          });
        }}>
          {pasteXml ? (
            <div className="account-form-group">
              <label htmlFor="company-metadata-xml">Sign-on XML (metadata file)</label>
              <textarea id="company-metadata-xml" className="company-textarea" rows={5} value={metadataXml}
                placeholder="<EntityDescriptor ...>" onChange={(e) => setMetadataXml(e.target.value)} disabled={busy} />
            </div>
          ) : (
            <div className="account-form-group">
              <label htmlFor="company-metadata-url">Sign-on link (metadata URL)</label>
              <input id="company-metadata-url" value={metadataUrl} placeholder="https://login.microsoftonline.com/.../federationmetadata.xml"
                onChange={(e) => setMetadataUrl(e.target.value)} disabled={busy} />
            </div>
          )}
          <div className="company-row-actions">
            <button type="button" className="account-text-link company-link" onClick={() => setPasteXml((v) => !v)}>
              {pasteXml ? 'Paste a link instead' : 'Paste the XML instead'}
            </button>
            <span className="company-grow" />
            {company.sso_connected && (
              <button type="button" className="account-btn-danger" disabled={busy}
                onClick={() => act(async () => { await disconnectCompanySignIn(company.id); setMessage('Company sign-in disconnected.'); await reload(); })}>
                Disconnect
              </button>
            )}
            <button type="submit" className="account-btn-primary"
              disabled={busy || !(pasteXml ? metadataXml.trim() : metadataUrl.trim())}>
              {company.sso_connected ? 'Update' : 'Connect'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
