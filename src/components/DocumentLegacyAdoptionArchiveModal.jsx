import React from 'react';
import BodyPortal from './BodyPortal.js';

export default function DocumentLegacyAdoptionArchiveModal({ open = false, status = null,
  busy = false, error = '', onExport, onClose }) {
  if (!open || status?.version !== 2) return null;
  const hasPdf = status.objects?.some(entry => entry.kind === 'pdf');
  const hasSidecar = status.objects?.some(entry => entry.kind === 'sidecar');
  return <BodyPortal><section role="dialog" aria-modal="true"
    aria-label="Export legacy source archive" style={{ position:'fixed',zIndex:7600,
      top:'50%',left:'50%',transform:'translate(-50%, -50%)',width:'min(520px, calc(100% - 24px))',
      padding:16,borderRadius:10,background:'#202631',color:'#f4f6f8',
      border:'1px solid #465164',boxShadow:'0 12px 32px rgba(0,0,0,.38)' }}>
    <h2 style={{ margin:'0 0 8px',fontSize:17 }}>Export the legacy source archive?</h2>
    <p style={{ margin:'0 0 10px',fontSize:13 }}>
      These are the exact files kept when this document got its first checked version.
      They are for owner review only and will not be loaded, adopted, shared, or added to the open document.
    </p>
    {hasSidecar && <p style={{ margin:'0 0 10px',fontSize:12,color:'#ffd39a' }}>
      The old JSON may contain private page view, tool, template, or Excel settings.
    </p>}
    {error && <p role="alert" style={{ color:'#ffb3b3',margin:'0 0 10px' }}>{error}</p>}
    {hasPdf && <button type="button" disabled={busy}
      onClick={() => { void onExport?.('pdf'); }}>Export original PDF</button>}
    {hasSidecar && <button type="button" disabled={busy} style={{ marginLeft:8 }}
      onClick={() => { void onExport?.('sidecar'); }}>Export old JSON</button>}
    <button type="button" disabled={busy} onClick={onClose} style={{ marginLeft:8 }}>Close</button>
  </section></BodyPortal>;
}
