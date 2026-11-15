// "Help & support" (Nightly flag 'help-menu'): a short start guide, what to
// do when a page is stuck, links to the site's help pages, and the version.
import DialogCard from '../components/DialogCard.jsx';
import { C } from '../uiPalette';
import { HELP_LINKS, START_STEPS, TROUBLE_TIPS, helpLinkUrl, versionLine } from './helpSupport.js';

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
const BUILD = typeof __BUILD_STAMP__ !== 'undefined' ? __BUILD_STAMP__ : '';

const heading = { fontSize: 12, fontWeight: 600, color: C.ink, margin: '14px 0 6px' };
const linkRow = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10,
  padding: '7px 10px', borderRadius: 6, border: `1px solid ${C.rule}`, color: C.ink, textDecoration: 'none',
};

export default function HelpSupportDialog({ open, onClose, onShortcuts = null }) {
  if (!open) return null;
  return (
    <DialogCard
      open
      title="Help & support"
      onClose={onClose}
      width={420}
      atRoot
      cardProps={{ 'data-help-support': 'true' }}
      footer={(
        <>
          {onShortcuts && (
            <button type="button" className="hub-btn dialog-touch-pad" onClick={() => { onClose?.(); onShortcuts(); }}>Keyboard shortcuts</button>
          )}
          <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={onClose}>Done</button>
        </>
      )}
    >
      <div style={{ ...heading, marginTop: 0 }}>Getting started</div>
      <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }} data-help-steps>
        {START_STEPS.map((step) => (
          <li key={step.title}><strong style={{ color: C.ink, fontWeight: 600 }}>{step.title}.</strong> {step.text}</li>
        ))}
      </ol>
      <div style={heading}>Something not working?</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
        {TROUBLE_TIPS.map((text) => <li key={text}>{text}</li>)}
      </ul>
      <button type="button" className="hub-btn dialog-touch-pad" style={{ marginTop: 10 }} data-help-reload onClick={() => window.location.reload()}>
        Reload Survey
      </button>
      <div style={heading}>More help</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {HELP_LINKS.map((link) => (
          <a key={link.id} href={helpLinkUrl(link)} target="_blank" rel="noopener noreferrer" style={linkRow} data-help-link={link.id}>
            <span style={{ fontWeight: 600 }}>{link.label}</span>
            <span style={{ fontSize: 11, color: C.muted }}>{link.note}</span>
          </a>
        ))}
      </div>
      <div style={{ marginTop: 14, fontSize: 11, color: C.muted }} data-help-version>{versionLine({ version: VERSION, build: BUILD })}</div>
    </DialogCard>
  );
}
