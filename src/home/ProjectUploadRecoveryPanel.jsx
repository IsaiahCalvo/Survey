// Recovery copies are separate from the local-only document library. Choosing
// Retry is consent to resume the original cloud upload, not to publish a local doc.
export default function ProjectUploadRecoveryPanel({ recovery, onDiscard }) {
  const { rows, busy, listError, error, notice, refresh, retry } = recovery;
  if (!rows.length && !listError && !error && !notice && !busy) return null;
  const button = { minHeight: 44, flexShrink: 0 };
  return <section aria-label="Project upload recovery" className="card" style={{ margin: '0 8px 8px', padding: '10px 14px', flexShrink: 0, maxHeight: '35vh', overflow: 'auto' }}>
    <details open={rows.length > 0 || !!listError || !!error || !!notice || busy}>
      <summary style={{ cursor: 'pointer', minHeight: 24 }}>Project upload recovery{rows.length ? ` (${rows.length})` : ''}</summary>
      <p style={{ fontSize: 12 }}>Retry copies stay in this browser or app profile until each upload is confirmed. Clearing app data can erase them. Retry resumes the same cloud project.</p>
      {listError || error ? <p role="alert">{listError || error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {busy ? <p role="status">Saving upload progress… Keep this window open.</p> : null}
      <button type="button" className="btn" style={button} disabled={busy} onClick={() => { void refresh(); }}>Refresh upload recovery</button>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map(row => <li key={row.id} style={{ borderTop: '1px solid var(--ink-500)', marginTop: 8, paddingTop: 8 }}>
          <strong style={{ overflowWrap: 'anywhere' }}>{row.name}</strong>
          <p style={{ fontSize: 12, margin: '6px 0' }}>{row.phase === 'complete'
            ? 'Cloud save confirmed. Retry to clear only the local retry copies.'
            : row.phase === 'preparing'
              ? 'Local staging did not finish. Reselect the original PDFs below; no cloud upload has started.'
              : `${row.files.filter(file => file.state === 'confirmed').length} of ${row.files.length} PDFs confirmed. Other cloud work may already be saved.`}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {row.phase === 'preparing' && row.files.length > 0 ? <label style={{ maxWidth: '100%', fontSize: 12 }}>
              Reselect original PDFs for {row.name}
              <input aria-label={`Reselect original PDFs for ${row.name}`} type="file" accept="application/pdf,.pdf" multiple disabled={busy}
                style={{ display: 'block', maxWidth: '100%', minHeight: 44 }}
                onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.length) void retry(row.id, files).catch(() => {}); }} />
            </label> : <button type="button" className="btn" style={button} disabled={busy}
              aria-label={`Retry ${row.name}`} onClick={() => { void retry(row.id).catch(() => {}); }}>Retry upload</button>}
            <button type="button" className="btn" style={button} disabled={busy} onClick={() => { void onDiscard(row); }}>Discard retry copies</button>
          </div>
        </li>)}
      </ul>
    </details>
  </section>;
}
