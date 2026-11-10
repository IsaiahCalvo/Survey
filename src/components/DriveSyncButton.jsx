// The OneDrive button in the viewer's top bar and its cards (Nightly flag
// 'drive-sync-back'; hooks/useDriveSyncBack.js). Shown only for a document
// linked to a OneDrive file. The card says when Survey last saved to OneDrive
// and has "Sync to OneDrive now", how often to save, and turning it off;
// Drawboard's three dialogs (conflict, file gone, read-only) open on their own.
import { useEffect, useState } from 'react';
import DialogCard from './DialogCard';
import BodyPortal from './BodyPortal';
import Icon from '../Icons';
import Spinner from './Spinner';
import { Z_INDEX } from '../theme';
import { syncedAgo } from '../services/sheetSyncClient.js';

const MINUTE_CHOICES = [1, 5, 15, 30, 60];

export function driveSyncLine(state, nowMs = Date.now()) {
  const link = state?.link;
  if (!link) return '';
  if (state.phase === 'saving') return 'Saving to OneDrive…';
  if (link.syncOff) return 'Saving back to OneDrive is off.';
  if (state.phase === 'problem' && state.problem?.error) return state.problem.error;
  if (state.dirty) return 'Changes not saved to OneDrive yet.';
  if (link.lastPushedAt) return `Saved to OneDrive ${syncedAgo(link.lastPushedAt, nowMs)}.`;
  return 'Survey saves your marks to OneDrive after you change something.';
}

export default function DriveSyncButton({ state, tip, onOpen }) {
  if (!state?.enabled || !state.link) return null;
  const warn = state.phase === 'problem' || state.link.syncOff;
  return (
    <button
      type="button"
      data-drive-sync-button="true"
      className="btn btn-ghost chrome-control"
      aria-label={`OneDrive: ${driveSyncLine(state)}`}
      {...tip(driveSyncLine(state) || 'OneDrive', 'below')}
      onClick={onOpen}
      style={{ width: 'auto', padding: '0 8px', gap: 6, display: 'inline-flex', alignItems: 'center' }}
    >
      {state.phase === 'saving' ? <Spinner size={14} color="currentColor" /> : <Icon name="oneDrive" size={16} />}
      {(warn || state.dirty) && (
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: warn ? 'var(--danger, #e5484d)' : 'var(--warning, #f5a524)' }} />
      )}
    </button>
  );
}

export function DriveSyncDialogs({ state, cardOpen, onCloseCard }) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!cardOpen) return undefined;
    const clock = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(clock);
  }, [cardOpen]);
  // A dialog replaces the card: it must not pop back once the dialog closes.
  const dialogUp = Boolean(state?.dialog);
  useEffect(() => {
    if (dialogUp && cardOpen) onCloseCard?.();
  }, [dialogUp, cardOpen, onCloseCard]);
  if (!state?.enabled || !state.link) return null;
  const { link, dialog } = state;
  const name = link.name || 'this file';
  const saving = state.phase === 'saving';
  return (
    <BodyPortal>
      {cardOpen && !dialog && (
        <DialogCard
          title="OneDrive"
          message={name}
          onClose={onCloseCard}
          width={360}
          atRoot
          zIndex={Z_INDEX.modalOverlay}
          cardProps={{ 'data-drive-sync-card': 'true' }}
          footer={(
            <>
              <button type="button" className="hub-btn dialog-touch-pad" onClick={onCloseCard}>Close</button>
              {state.canPush && !link.syncOff && (
                <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" disabled={saving} onClick={() => state.syncNow()}>
                  {saving ? (<><Spinner size={14} color="currentColor" />Saving…</>) : 'Sync to OneDrive now'}
                </button>
              )}
            </>
          )}
        >
          <p role="status" style={{ margin: '0 0 12px', fontSize: 13 }}>{driveSyncLine(state)}</p>
          {state.canPush && (
            <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
              {!link.syncOff && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  Save every
                  <select
                    aria-label="Save to OneDrive every"
                    value={MINUTE_CHOICES.includes(link.syncMinutes) ? link.syncMinutes : 5}
                    onChange={(e) => state.setMinutes(Number(e.target.value))}
                  >
                    {MINUTE_CHOICES.map((m) => <option key={m} value={m}>{m === 60 ? '1 hour' : `${m} min`}</option>)}
                  </select>
                  after a change
                </label>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {link.webUrl && (
                  <a className="hub-btn dialog-touch-pad" style={{ textDecoration: 'none' }} href={link.webUrl} target="_blank" rel="noopener noreferrer">Open in OneDrive</a>
                )}
                {link.syncOff
                  ? <button type="button" className="hub-btn dialog-touch-pad" onClick={() => state.resumeSyncing()}>Turn saving back on</button>
                  : <button type="button" className="hub-btn dialog-touch-pad" onClick={() => state.stopSyncing()}>Stop saving back</button>}
                <button type="button" className="hub-btn dialog-touch-pad" onClick={async () => { await state.unlink(); onCloseCard(); }}>Unlink</button>
              </div>
            </div>
          )}
        </DialogCard>
      )}
      {dialog === 'conflict' && (
        <DialogCard
          title="This file changed in OneDrive"
          message={`Someone changed ${name} in OneDrive since Survey last saved it. Keep Survey’s version to replace it, or stop saving back so both stay as they are.`}
          onClose={state.closeDialog}
          role="alertdialog"
          atRoot
          zIndex={Z_INDEX.modalOverlay}
          cardProps={{ 'data-drive-dialog': 'conflict' }}
          footer={(
            <>
              <button type="button" className="hub-btn dialog-touch-pad" onClick={() => state.stopSyncing()}>Stop saving back</button>
              <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={() => state.keepSurveyVersion()}>Keep Survey’s version</button>
            </>
          )}
        />
      )}
      {dialog === 'gone' && (
        <DialogCard
          title="The OneDrive file is gone"
          message={`${name} was moved or deleted in OneDrive. The document and your marks stay in Survey.`}
          onClose={state.closeDialog}
          atRoot
          zIndex={Z_INDEX.modalOverlay}
          cardProps={{ 'data-drive-dialog': 'gone' }}
          footer={(
            <>
              <button type="button" className="hub-btn dialog-touch-pad" onClick={state.closeDialog}>Not now</button>
              <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={() => state.unlink()}>Unlink</button>
            </>
          )}
        />
      )}
      {dialog === 'read_only' && (
        <DialogCard
          title="You can’t change this OneDrive file"
          message={`Your Microsoft sign-in can open ${name} but not save to it. Your marks stay in Survey.`}
          onClose={state.closeDialog}
          atRoot
          zIndex={Z_INDEX.modalOverlay}
          cardProps={{ 'data-drive-dialog': 'read_only' }}
          footer={(
            <>
              <button type="button" className="hub-btn dialog-touch-pad" onClick={state.closeDialog}>OK</button>
              <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={() => state.stopSyncing()}>Stop saving back</button>
            </>
          )}
        />
      )}
    </BodyPortal>
  );
}
