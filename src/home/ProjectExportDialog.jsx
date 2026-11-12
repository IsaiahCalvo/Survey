/* Export project (Nightly flag 'project-export'; Drawboard Projects parity
   EX-10 / EX-12 / EX-17): one zip of the whole project, made on the device
   and downloaded straight away (Drawboard emails it). Choices: marks in or
   original files, current copies or every revision, comments CSVs, the
   Issues and Tasks registers. Rules: projectExport.js; work: projectExportRun.js. */
import { useEffect, useRef, useState } from 'react';
import DialogCard from '../components/DialogCard.jsx';
import ButtonGroup from '../components/ButtonGroup.jsx';
import Spinner from '../components/Spinner';
import { Icon } from './HubShell';
import { Z_INDEX } from '../theme';
import { supabase } from '../supabaseClient';
import { useStorage } from '../hooks/useDatabase';
import { showToast } from '../utils/toast';
import { exportProgressText } from './projectExport.js';
import { isFeatureOn } from '../featureFlags.js';
import '../components/PdfToolsDialog.css';
import '../components/ExportPdfDialog.css';
import './projectExport.css';

const MARKS = [
  { value: 'marks', label: 'With marks', ariaLabel: 'With marks. Each file as Download with marks gives it.' },
  { value: 'original', label: 'Original files', ariaLabel: 'Original files. The files as they were uploaded.' },
];
const REVISIONS = [
  { value: 'current', label: 'Current', ariaLabel: 'Current copy of each file' },
  { value: 'all', label: 'All revisions', ariaLabel: 'Every revision of each file' },
];

function Check({ on, label, onToggle, attr }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} className={`xpdf-page${on ? ' is-on' : ''}`} {...attr} onClick={onToggle}>
      <span className="xpdf-check" aria-hidden="true">{on ? <Icon name="check" size={11} /> : null}</span>
      <span className="xpdf-page__label">{label}</span>
    </button>
  );
}

export default function ProjectExportDialog({ project, documents = [], lookupMember, onClose }) {
  const { downloadDocument } = useStorage();
  const [marks, setMarks] = useState('marks');
  const [revisions, setRevisions] = useState('current');
  const [comments, setComments] = useState(true);
  const [issues, setIssues] = useState(true);
  const [restrictOn] = useState(() => isFeatureOn('restrict-editing'));
  const [restrict, setRestrict] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);
  const busy = Boolean(progress);
  const files = documents.length;

  const run = async () => {
    setError('');
    setProgress({ done: 0, total: files, phase: 'files' });
    try {
      const { buildProjectExport } = await import('./projectExportRun.js');
      const result = await buildProjectExport({
        client: supabase,
        project,
        documents,
        options: { withMarks: marks === 'marks', allRevisions: revisions === 'all', comments, issues, restrict: restrictOn && restrict },
        download: downloadDocument,
        lookupMember,
        onProgress: (p) => { if (!cancelled.current) setProgress(p); },
        isCancelled: () => cancelled.current,
      });
      if (!result || cancelled.current) return;
      if (!result.count) { setProgress(null); setError('Nothing to export yet. Add files to the project first.'); return; }
      const { deliverGeneratedFile } = await import('../utils/xfdfExport/deliverFile.js');
      const saved = await deliverGeneratedFile({
        data: result.bytes,
        fileName: result.fileName,
        mimeType: 'application/zip',
        title: 'Export project',
        filterName: 'Zip files',
        extensions: ['zip'],
      });
      if (saved?.canceled) { setProgress(null); return; }
      const left = [...result.failed, ...result.skipped];
      if (result.password) {
        const { showRestrictedExportToast } = await import('../utils/restrictPdfEditing.js');
        showRestrictedExportToast(left.length ? `${result.fileName} (not all files went in: ${left.slice(0, 3).join(', ')}${left.length > 3 ? ` and ${left.length - 3} more` : ''})` : result.fileName, result.password);
        onClose();
        return;
      }
      showToast(left.length
        ? `Exported ${result.fileName}. Not all went in: ${left.slice(0, 3).join(', ')}${left.length > 3 ? ` and ${left.length - 3} more` : ''}.`
        : `Exported ${result.fileName}`, left.length ? 'warn' : 'success');
      onClose();
    } catch (err) {
      console.warn('[projectExport] failed', err);
      if (!cancelled.current) { setProgress(null); setError("The project couldn't be exported. Check your connection and try again."); }
    }
  };

  const cancel = () => { cancelled.current = true; onClose(); };
  const pct = progress?.total ? Math.round((Math.min(progress.done, progress.total) / progress.total) * 100) : 0;

  return (
    <DialogCard
      title="Export project"
      message={`${project?.name || 'Project'}: ${files} ${files === 1 ? 'file' : 'files'} in one zip.`}
      onClose={cancel}
      width={440}
      zIndex={Z_INDEX.modalOverlay}
      cardProps={{ 'data-project-export': '' }}
      footer={(
        <>
          {busy && <span className="pdft-busy" role="status" data-project-export-progress=""><Spinner size={14} color="currentColor" /> {exportProgressText(progress)}</span>}
          <button type="button" className="hub-btn dialog-touch-pad" onClick={cancel}>Cancel</button>
          <button type="button" data-autofocus="" className="hub-btn hub-btn--primary dialog-touch-pad xpdf-go" onClick={run} disabled={busy || files === 0}>
            <Icon name="download" size={14} />
            <span>Export</span>
          </button>
        </>
      )}
    >
      <div className="xpdf-body project-export__body">
        <div className="xpdf-section">
          <span className="xpdf-label" id="project-export-marks">Files</span>
          <ButtonGroup labelledBy="project-export-marks" fill className="xpdf-modes" value={marks} options={MARKS.map((o) => ({ ...o, disabled: busy }))} onChange={setMarks} />
        </div>
        <div className="xpdf-section">
          <span className="xpdf-label" id="project-export-revisions">Revisions</span>
          <ButtonGroup labelledBy="project-export-revisions" fill className="xpdf-modes" value={revisions} options={REVISIONS.map((o) => ({ ...o, disabled: busy }))} onChange={setRevisions} />
        </div>
        <div className="xpdf-section">
          <span className="xpdf-label">Also add</span>
          <div className="xpdf-pages">
            <Check on={comments} label="Comments (.csv per file)" onToggle={() => !busy && setComments((v) => !v)} attr={{ 'data-project-export-comments': '' }} />
            <Check on={issues} label="Issues and Tasks registers (.csv)" onToggle={() => !busy && setIssues((v) => !v)} attr={{ 'data-project-export-issues': '' }} />
          </div>
        </div>
        {restrictOn && (
          <div className="xpdf-section">
            <div className="xpdf-pages">
              <Check on={restrict} label="Restrict editing" onToggle={() => !busy && setRestrict((v) => !v)} attr={{ 'data-export-restrict': '' }} />
            </div>
            {restrict && <p className="pdft-help" data-export-restrict-help="">Every PDF opens without a password. Changes and new marks need the one password shown after export.</p>}
          </div>
        )}
        {busy && (
          <div className="project-export__bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
        )}
        {error && <p className="pdft-error" role="alert">{error}</p>}
      </div>
    </DialogCard>
  );
}
