// The OneDrive / Google Drive button in the viewer's top bar and its cards
// (Nightly flag 'drive-sync-back'; hooks/useDriveSyncBack.js). Shown only for a
// document linked to a drive file. The card says when Survey last saved to the
// drive and has "Sync to OneDrive now", how often to save, and turning it off;
// Drawboard's three dialogs (conflict, file gone, read-only) open on their own.
import { useEffect, useState } from 'react';
import ValueSelect from './ValueSelect.jsx';
import DialogCard from './DialogCard';
import BodyPortal from './BodyPortal';
import Icon from '../Icons';
import Spinner from './Spinner';
import { Z_INDEX } from '../theme';
import { syncedAgo } from '../services/sheetSyncClient.js';
import { driveCompany, driveIcon, drivePlace } from '../utils/driveLinks.js';

const MINUTE_CHOICES = [1, 5, 15, 30, 60];


export function driveSyncLine(state, nowMs = Date.now()) {
  const link = state?.link;
  if (!link) return '';
  const place = drivePlace(link);
  if (state.phase === 'saving') return `Saving to ${place}…`;
  if (link.syncOff) return `Saving back to ${place} is off.`;
  if (state.phase === 'problem' && state.problem?.error) return state.problem.error;
  if (state.dirty) return `Changes not saved to ${place} yet.`;
  if (link.lastPushedAt) return `Saved to ${place} ${syncedAgo(link.lastPushedAt, nowMs)}.`;
  return `Survey saves your marks to ${place} after you change something.`;
}

export default function DriveSyncButton({ state, tip, onOpen }) {
  if (!state?.enabled || !state.link) return null;
  const warn = state.phase === 'problem' || state.link.syncOff;
  const place = drivePlace(state.link);
  return (
    <button
      type="button"
      data-drive-sync-button="true"
      className="btn btn-ghost chrome-control"
      aria-label={`${place}: ${driveSyncLine(state)}`}
      {...tip(driveSyncLine(state) || place, 'below')}
      onClick={onOpen}
      style={{ width: 'auto', padding: '0 8px', gap: 6, display: 'inline-flex', alignItems: 'center' }}
    >
      {state.phase === 'saving' ? <Spinner size={14} color="currentColor" /> : <Icon name={driveIcon(state.link)} size={16} />}
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
  const place = drivePlace(link);
  const company = driveCompany(link);
  return (
    <BodyPortal>
      {cardOpen && !dialog && (
        <DialogCard
          title={place}
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
                  {saving ? (<><Spinner size={14} color="currentColor" />Saving…</>) : `Sync to ${place} now`}
                </button>
              )}
            </>
          )}
        >
          <p role="status" style={{ margin: '0 0 12px', fontSize: 13 }}>{driveSyncLine(state)}</p>
          {state.canPush && (
            <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
              {!link.syncOff && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden="true">Save every</span>
                  <ValueSelect
                    label={`Save to ${place} every`}
                    width={96}
                    value={MINUTE_CHOICES.includes(link.syncMinutes) ? link.syncMinutes : 5}
                    options={MINUTE_CHOICES.map((m) => ({ value: m, label: m === 60 ? '1 hour' : `${m} min` }))}
                    onChange={(next) => state.setMinutes(Number(next))}
                  />
                  <span aria-hidden="true">after a change</span>
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {link.webUrl && (
                  <a className="hub-btn dialog-touch-pad" style={{ textDecoration: 'none' }} href={link.webUrl} target="_blank" rel="noopener noreferrer">Open in {place}</a>
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
          title={`This file changed in ${place}`}
          message={`Someone changed ${name} in ${place} since Survey last saved it. Keep Survey’s version to replace it, or stop saving back so both stay as they are.`}
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
          title={`The ${place} file is gone`}
          message={`${name} was moved or deleted in ${place}. The document and your marks stay in Survey.`}
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
          title={`You can’t change this ${place} file`}
          message={`Your ${company} sign-in can open ${name} but not save to it. Your marks stay in Survey.`}
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
