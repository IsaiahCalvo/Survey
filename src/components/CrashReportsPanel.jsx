/**
 * CrashReportsPanel.jsx — Settings -> Crash reports.
 *
 * Owner 2026-10-07: the app "keeps crashing" and nobody could see why. Every
 * crash on this device leaves a short note (utils/crashLog.js, the last 20,
 * kept in this browser only); this lists them with one Copy button so the
 * owner can paste them to us. Nothing here sends anything anywhere.
 */
import { useEffect, useState } from 'react';
import {
  clearCrashReports, crashKindLabel, formatCrashReports, onCrashRecorded, readCrashReports,
} from '../utils/crashLog';

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall back below */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

const when = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function CrashReportsPanel() {
  const [records, setRecords] = useState(() => readCrashReports());
  const [note, setNote] = useState('');

  useEffect(() => onCrashRecorded(() => setRecords(readCrashReports())), []);
  useEffect(() => {
    if (!note) return undefined;
    const timer = window.setTimeout(() => setNote(''), 2500);
    return () => window.clearTimeout(timer);
  }, [note]);

  const newestFirst = records.slice().reverse();

  return (
    <section className="account-section crash-reports">
      <h3>Crash reports</h3>
      <p className="account-section-description">
        When Survey crashes, freezes or closes by itself on this device, a short note is kept here
        (the last 20). Nothing is sent anywhere. Copy them and paste them to us.
      </p>
      <div className="crash-reports-actions">
        <button
          type="button"
          className="account-btn-secondary"
          disabled={records.length === 0}
          onClick={async () => setNote(await copyText(formatCrashReports(records)) ? 'Copied.' : 'Could not copy. Select the text below instead.')}
        >
          Copy
        </button>
        <button
          type="button"
          className="account-btn-secondary"
          disabled={records.length === 0}
          onClick={() => { clearCrashReports(); setRecords([]); setNote('Cleared.'); }}
        >
          Clear
        </button>
        <span className="crash-reports-note" role="status" aria-live="polite">{note}</span>
      </div>
      {newestFirst.length === 0 ? (
        <p className="crash-reports-empty">No crashes recorded on this device.</p>
      ) : (
        <ul className="crash-reports-list">
          {newestFirst.map((r) => (
            <li key={r.id} className="crash-reports-item">
              <details>
                <summary>
                  <span className="crash-reports-when">{when(r.at)}</span>
                  <span className="crash-reports-kind">{crashKindLabel(r.kind)}{r.count > 1 ? ` x${r.count}` : ''}</span>
                  <span className="crash-reports-what">{r.message}</span>
                </summary>
                <pre className="crash-reports-text">{formatCrashReports([r]).replace(/^#1 /, '')}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
