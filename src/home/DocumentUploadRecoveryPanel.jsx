export default function DocumentUploadRecoveryPanel({ recovery, onDiscard }) {
  const { rows, busy, listError, error, notice, refresh, retry } = recovery;
  if (!rows.length && !listError && !error && !notice && !busy) return null;
  const button = { minHeight: 44, flexShrink: 0 };
  return <section aria-label="File upload recovery" className="card" style={{ margin: '0 8px 8px', padding: '10px 14px', flexShrink: 0, maxHeight: '35vh', overflow: 'auto' }}>
    <details open>
      <summary style={{ cursor: 'pointer', minHeight: 24 }}>File upload recovery{rows.length ? ` (${rows.length})` : ''}</summary>
      <p style={{ fontSize: 12 }}>Saved retry bytes stay in this browser or app profile. Clearing app data can erase them. Retry resumes the same cloud upload; it does not publish other local files.</p>
      {listError || error ? <p role="alert">{listError || error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {busy ? <p role="status">Saving file upload… Keep this window open.</p> : null}
      <button type="button" className="btn" style={button} disabled={busy} onClick={() => { void refresh(); }}>Refresh file recovery</button>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map(row => <li key={row.id} style={{ borderTop: '1px solid var(--ink-500)', marginTop: 8, paddingTop: 8 }}>
          <strong style={{ overflowWrap: 'anywhere' }}>{row.name}</strong>
          <p style={{ fontSize: 12, margin: '6px 0' }}>{row.phase === 'complete'
            ? 'Cloud save confirmed. Retry clears only this local retry copy.'
            : row.phase === 'document-confirmed' ? 'File saved. A name or previous-version step still needs confirmation.'
              : 'Retry bytes are saved here. Cloud work may already be saved.'}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" style={button} disabled={busy} aria-label={`Retry file ${row.name}`}
              onClick={() => { void retry(row.id).catch(() => {}); }}>Retry upload</button>
            <button type="button" className="btn" style={button} disabled={busy} onClick={() => { void onDiscard(row); }}>Discard retry copy</button>
          </div>
        </li>)}
      </ul>
    </details>
  </section>;
}
