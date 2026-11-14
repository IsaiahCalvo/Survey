// "Open from OneDrive" (Nightly flag 'drive-sync-back'): walk OneDrive's
// folders (and SharePoint folders added to it as shortcuts), or paste a link
// to a PDF or a folder, and pick one PDF. Drawboard's "Add file > OneDrive".
// The server lists the folders with the person's Microsoft sign-in
// (services/driveFilesClient.js); nothing here sees a Microsoft token.
import { useCallback, useEffect, useState } from 'react';
import DialogCard from './DialogCard';
import Icon from '../Icons';
import Spinner from './Spinner';
import { Z_INDEX } from '../theme';
import { connectMicrosoftForDrive, driveCall } from '../services/driveFilesClient.js';
import './SheetSyncButton.css';

const isPlace = (folder) => String(folder || '').startsWith('~');

function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/**
 * @param {object} props
 * @param {(file: {name, driveId, itemId, size}) => Promise<boolean|void>} props.onPick
 *   opens the picked PDF; the picker stays up (busy) until it settles and
 *   closes when it resolves true or nothing.
 * @param {() => void} props.onClose
 * @param {string|null} [props.intoName] the project a pick is added to (title only)
 * @param {object} [props.call] driveCall, for tests
 * @param {object} [props.connect] connectMicrosoftForDrive, for tests
 */
export default function DriveFilePicker({ onPick, onClose, intoName = null, call = driveCall, connect = connectMicrosoftForDrive }) {
  const [at, setAt] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [listing, setListing] = useState(null); // { folders, places, files } | null while loading
  const [problem, setProblem] = useState(null); // { error, code }
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [busy, setBusy] = useState(null); // 'link' | 'connect' | itemId being opened
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    setListing(null);
    setProblem(null);
    call('driveBrowse', { folder: at }).then((res) => {
      if (!live) return;
      if (!res || res.error) {
        setProblem({ error: res?.error || 'Could not open this folder.', code: res?.code || null });
        setListing({ folders: [], places: [], files: [] });
        return;
      }
      setListing({
        folders: Array.isArray(res.folders) ? res.folders : [],
        places: Array.isArray(res.places) ? res.places : [],
        files: Array.isArray(res.files) ? res.files : [],
      });
    });
    return () => { live = false; };
  }, [at, call, round]);

  const pick = useCallback(async (file) => {
    if (busy) return;
    setBusy(file.itemId);
    try {
      const done = await onPick(file);
      if (done !== false) onClose();
    } finally {
      setBusy(null);
    }
  }, [busy, onClose, onPick]);

  const openLink = async (e) => {
    e?.preventDefault?.();
    const url = pasted.trim();
    if (!url || busy) return;
    setBusy('link');
    setPasteError('');
    const res = await call('driveBrowse', { folder: '', folderLink: url });
    setBusy(null);
    if (!res || res.error) { setPasteError(res?.error || 'Could not open that link.'); return; }
    setPasted('');
    if (res.file) { await pick(res.file); return; }
    setPlaceName(res.name || 'SharePoint');
    setAt(res.folder || '');
  };

  const connectNow = async () => {
    setBusy('connect');
    const res = await connect();
    setBusy(null);
    if (!res?.ok) { setProblem({ error: res?.error || 'Microsoft was not connected.', code: 'not_connected' }); return; }
    setRound((n) => n + 1);
  };

  const parts = at.split('/').filter(Boolean);
  const place = isPlace(at);
  const crumbs = place ? parts.slice(1) : parts;
  const head = place ? [parts[0]] : [];
  const needsConnect = problem?.code === 'not_connected' || problem?.code === 'reconnect';
  const empty = listing && !listing.folders.length && !listing.places.length && !listing.files.length;

  return (
    <DialogCard
      title={intoName ? `Add to ${intoName} from OneDrive` : 'Open from OneDrive'}
      message="Pick a PDF. Survey saves your marks back to it in OneDrive."
      onClose={onClose}
      busy={Boolean(busy) && busy !== 'connect'}
      width={420}
      atRoot
      zIndex={Z_INDEX.modalOverlay}
      cardProps={{ 'data-drive-picker': 'true' }}
    >
      {needsConnect ? (
        <div className="sheet-sync-body">
          <p className="sheet-sync-empty">{problem.code === 'reconnect' ? 'Your Microsoft sign-in has ended.' : 'Connect your Microsoft account to see your OneDrive files.'}</p>
          <div className="sheet-sync-row">
            <button type="button" className="sheet-sync-btn sheet-sync-btn--primary sheet-sync-btn--block" disabled={busy === 'connect'} onClick={connectNow}>
              {busy === 'connect' ? (<><Spinner size={14} color="currentColor" />Waiting for Microsoft…</>) : (<><Icon name="microsoft" size={14} />Connect Microsoft</>)}
            </button>
          </div>
        </div>
      ) : (
        <div className="sheet-sync-body sheet-sync-folders">
          <nav className="sheet-sync-crumbs" aria-label="Folder">
            <button type="button" className="sheet-sync-crumb" onClick={() => setAt('')}>OneDrive</button>
            {place && (
              <span>
                <span aria-hidden="true"> › </span>
                <button type="button" className="sheet-sync-crumb" onClick={() => setAt(parts[0])}>{placeName || 'SharePoint'}</button>
              </span>
            )}
            {crumbs.map((name, i) => (
              <span key={i}>
                <span aria-hidden="true"> › </span>
                <button type="button" className="sheet-sync-crumb" onClick={() => setAt([...head, ...crumbs.slice(0, i + 1)].join('/'))}>{name}</button>
              </span>
            ))}
          </nav>
          <div className="sheet-sync-folder-list" role="list" aria-busy={listing === null || undefined}>
            {listing === null ? (
              <>
                <span className="sheet-sync-skeleton" />
                <span className="sheet-sync-skeleton is-short" />
              </>
            ) : empty ? (
              <p className="sheet-sync-empty">{problem ? problem.error : 'No folders or PDFs here.'}</p>
            ) : (
              <>
                {listing.places.map((p) => (
                  <button key={p.folder} type="button" role="listitem" className="sheet-sync-folder" onClick={() => { setPlaceName(p.name); setAt(p.folder); }}>
                    <Icon name="folder" size={14} color="currentColor" />
                    <span>{p.name}</span>
                  </button>
                ))}
                {listing.folders.map((name) => (
                  <button key={name} type="button" role="listitem" className="sheet-sync-folder" onClick={() => setAt(at ? `${at}/${name}` : name)}>
                    <Icon name="folder" size={14} color="currentColor" />
                    <span>{name}</span>
                  </button>
                ))}
                {listing.files.map((f) => (
                  <button
                    key={f.itemId}
                    type="button"
                    role="listitem"
                    className="sheet-sync-folder"
                    data-drive-file={f.name}
                    disabled={Boolean(busy) && busy !== f.itemId}
                    onClick={() => pick(f)}
                  >
                    {busy === f.itemId ? <Spinner size={14} color="currentColor" /> : <Icon name="document" size={14} color="currentColor" />}
                    <span>{f.name}</span>
                    <span className="sheet-sync-folder__meta" style={{ marginLeft: 'auto', opacity: 0.6, flex: 'none' }}>{sizeText(f.size)}</span>
                  </button>
                ))}
              </>
            )}
          </div>
          <form className="sheet-sync-code" onSubmit={openLink}>
            <label htmlFor="drive-picker-link">File or folder in SharePoint or Teams? Paste its link.</label>
            <div className="sheet-sync-code__row">
              <input
                id="drive-picker-link"
                type="url"
                inputMode="url"
                placeholder="https://…sharepoint.com/…"
                autoComplete="off"
                spellCheck={false}
                value={pasted}
                onChange={(e) => { setPasted(e.target.value); setPasteError(''); }}
              />
              <button type="submit" className="sheet-sync-btn" disabled={!pasted.trim() || Boolean(busy)}>
                {busy === 'link' ? 'Opening…' : 'Open'}
              </button>
            </div>
          </form>
          {pasteError && <p className="sheet-sync-paste-error" role="alert">{pasteError}</p>}
        </div>
      )}
    </DialogCard>
  );
}
