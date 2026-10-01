// The open Survey Marker's Notes block and Media strip (owner 2026-10-01,
// audit §3 chunk B), shared by the phone accordion and the desktop rail. It
// replaces the phone's separate Notes screen and the desktop's 600px Note
// dialog: the note is edited in place and saved when you leave the field;
// media is uploaded to storage (surveyMediaService) and kept on the note as
// references in `note.media`. Every write goes through `onUpdateNote`, a
// functional patch of the marker's `note`, so sync, localStorage and the
// Excel row see the same marker change the old dialogs made.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { showToast } from '../utils/toast';
import { useConfirmDialog } from './dialogPrompts';
import {
  buildNoteWithMedia,
  checkSurveyMediaLimits,
  classifyMediaFile,
  deleteSurveyMedia,
  migrateLegacyNoteMedia,
  normalizeNoteMedia,
  noteHasLegacyMedia,
  uploadSurveyMedia,
} from '../services/surveyMediaService';
import SurveyMediaStrip, { mediaKindLabel } from './SurveyMediaStrip';
import { SurveyAudioRecorderBar, SurveyMediaUploadTile, useAudioRecorder } from './SurveyMediaCapture';
import './surveyMarkerNotes.css';

const SAVED_TICK_MS = 1600;
// One background migration per marker per session (audit §4: legacy base64
// photos/videos move to files once, by an editor who opens the marker).
const migrationsStarted = new Set();

const noteText = (note) => {
  if (typeof note === 'string') {
    // A note can be plain text, or an object that arrived as JSON text.
    try {
      const parsed = note.trim().startsWith('{') ? JSON.parse(note) : null;
      if (parsed && typeof parsed === 'object') return typeof parsed.text === 'string' ? parsed.text : '';
    } catch { /* plain text */ }
    return note;
  }
  return typeof note?.text === 'string' ? note.text : '';
};
// The service's errors (SurveyMediaError) carry a sentence the UI can show
// as-is - "Media storage isn't set up yet.", a size limit, no permission ...
const mediaErrorMessage = (error, fallback) => (error?.code && error?.message ? error.message : fallback);

/** The note, edited in place: grows with its text, saves when you leave it. */
function SurveyNoteField({ text, onSave, variant, autoFocus, onAutoFocused, readOnly }) {
  const [draft, setDraft] = useState(text);
  const [savedVisible, setSavedVisible] = useState(false);
  const fieldRef = useRef(null);
  const focusedRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedRef = useRef(text);
  savedRef.current = text;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const savedTimerRef = useRef(0);

  // Someone else's edit (or an Excel pull) lands while you are not typing.
  useEffect(() => {
    if (!focusedRef.current) setDraft(text);
  }, [text]);

  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (!autoFocus || !fieldRef.current) return;
    const el = fieldRef.current;
    el.focus({ preventScroll: false });
    const end = el.value.length;
    try { el.setSelectionRange(end, end); } catch { /* not focusable yet */ }
    onAutoFocused?.();
  }, [autoFocus, onAutoFocused]);

  const commit = useCallback(() => {
    if (draftRef.current === savedRef.current) return false;
    onSaveRef.current(draftRef.current);
    savedRef.current = draftRef.current;
    return true;
  }, []);

  // iOS WKWebView does not blur a field when you tap plain content outside
  // it, so the keyboard would stay up and the note unsaved: any press outside
  // the field ends the typing (and still does what it was aimed at).
  useEffect(() => {
    const onDown = (event) => {
      const el = fieldRef.current;
      if (!el || document.activeElement !== el) return;
      const target = event.target;
      if (target === el || (target?.nodeType === 1 && el.contains(target))) return;
      el.blur();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  // Collapsing the marker (or the sheet) while typing still keeps the words;
  // so does leaving the app.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') commit(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.clearTimeout(savedTimerRef.current);
      commit();
    };
  }, [commit]);

  return (
    <div className={`survey-notes survey-notes--${variant}`} data-testid="survey-notes">
      <div className="survey-notes__head">
        <span className="survey-notes__label">Notes</span>
        <span className={`survey-notes__saved${savedVisible ? ' is-visible' : ''}`} aria-live="polite" data-testid="survey-notes-saved">
          {savedVisible ? (<><Icon name="check" size={12} color="currentColor" />Saved</>) : null}
        </span>
      </div>
      <textarea
        ref={fieldRef}
        className="survey-notes__field"
        aria-label="Survey Marker notes"
        placeholder={readOnly ? 'No notes' : 'Add a note'}
        rows={1}
        value={draft}
        readOnly={readOnly}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={() => {
          focusedRef.current = false;
          if (commit()) {
            setSavedVisible(true);
            window.clearTimeout(savedTimerRef.current);
            savedTimerRef.current = window.setTimeout(() => setSavedVisible(false), SAVED_TICK_MS);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setDraft(savedRef.current);
            draftRef.current = savedRef.current;
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

export default function SurveyMarkerNotes({
  variant = 'desktop',
  note,
  markerId,
  documentId: documentIdProp,
  canEdit = true,
  onUpdateNote,
  autoFocusNote = false,
  onAutoFocused,
}) {
  // DEV only: the ?testPdf= route opens a local file with no document id;
  // headless checks name one here to exercise uploads (stripped from builds).
  const documentId = documentIdProp
    || (import.meta.env.DEV ? globalThis.__surveyMediaTestDocumentId : null)
    || null;
  const [pending, setPending] = useState([]);
  // Its own confirm, portalled above the phone sheet and the media viewer
  // (the rail's shared one renders inside the rail, under the sheet).
  const [askConfirm, confirmDialogElement] = useConfirmDialog();
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const items = useMemo(() => normalizeNoteMedia(note || {}), [note]);

  const saveText = useCallback((text) => {
    onUpdateNote((prev) => ({ ...prev, text }));
  }, [onUpdateNote]);

  const uploadFiles = useCallback((files, { durationMs } = {}) => {
    if (!canEdit) return;
    if (!documentId) {
      showToast('Save this document to your account before adding media.', 'warn');
      return;
    }
    files.forEach((file) => {
      const kind = classifyMediaFile(file);
      if (!kind) {
        showToast(`"${file.name || 'That file'}" is not a photo, video or audio recording.`, 'warn');
        return;
      }
      // Videos and audio are checked before upload; a photo is checked by the
      // service after it is scaled down.
      const limitError = kind === 'photo' ? null : checkSurveyMediaLimits({ kind, size: file.size, name: file.name });
      if (limitError) {
        showToast(limitError.message, 'warn');
        return;
      }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = kind === 'photo' && typeof URL !== 'undefined' ? URL.createObjectURL(file) : null;
      setPending((list) => [...list, { key, kind, name: file.name, progress: 0, previewUrl }]);
      const finish = () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        if (mountedRef.current) setPending((list) => list.filter((entry) => entry.key !== key));
      };
      uploadSurveyMedia({
        documentId,
        markerId,
        file,
        kind,
        durationMs,
        onProgress: (progress) => {
          if (!mountedRef.current) return;
          setPending((list) => list.map((entry) => (entry.key === key ? { ...entry, progress } : entry)));
        },
      }).then((ref) => {
        onUpdateNote((prev) => buildNoteWithMedia(prev, [...normalizeNoteMedia(prev), ref]), { requireExisting: true });
        finish();
      }).catch((error) => {
        finish();
        console.warn('[surveyMedia] upload failed', error);
        showToast(
          mediaErrorMessage(error, `Couldn't upload "${file.name || mediaKindLabel(kind).toLowerCase()}".`),
          error?.code === 'not-set-up' || error?.code === 'too-large' ? 'warn' : 'error',
        );
      });
    });
  }, [canEdit, documentId, markerId, onUpdateNote]);

  const recorder = useAudioRecorder({
    onRecorded: (file, durationMs) => uploadFiles([file], { durationMs }),
  });

  const removeItem = useCallback(async (item) => {
    const kind = mediaKindLabel(item.kind).toLowerCase();
    const confirmed = await askConfirm({ title: `Remove this ${kind}?`, message: 'It is removed from this Survey Marker for everyone.', confirmLabel: 'Remove', danger: true });
    if (!confirmed) return;
    // Legacy ids are positional ("legacy-photo-0"), so a legacy item must
    // also match its bytes to be the one that was on screen.
    const isTarget = (entry) => entry.id === item.id && (entry.legacyDataUrl || null) === (item.legacyDataUrl || null);
    onUpdateNote((prev) => buildNoteWithMedia(prev, normalizeNoteMedia(prev).filter((entry) => !isTarget(entry))), { requireExisting: true });
    if (item.path) {
      deleteSurveyMedia(item).catch((error) => console.warn('[surveyMedia] could not delete the file', error));
    }
  }, [askConfirm, onUpdateNote]);

  // Legacy inline photos/videos: move them to storage once, in the
  // background. A failure leaves them where they are, still viewable.
  useEffect(() => {
    if (!canEdit || !documentId || !markerId || !noteHasLegacyMedia(note)) return;
    const key = `${documentId}:${markerId}`;
    if (migrationsStarted.has(key)) return;
    migrationsStarted.add(key);
    migrateLegacyNoteMedia({ documentId, markerId, note })
      .then((migrated) => {
        if (!migrated || migrated === note) return;
        // The migrated list (refs where the base64 was, anything that failed
        // still inline) plus anything uploaded meanwhile; the text as it is now.
        onUpdateNote((prev) => {
          const migratedItems = normalizeNoteMedia(migrated);
          const ids = new Set(migratedItems.map((entry) => entry.id));
          const addedMeanwhile = normalizeNoteMedia(prev).filter((entry) => entry.path && !ids.has(entry.id));
          return buildNoteWithMedia(prev, [...migratedItems, ...addedMeanwhile]);
        }, { requireExisting: true });
      })
      .catch((error) => console.warn('[surveyMedia] legacy media stays inline for now', error));
    // Once per marker: later note changes must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, documentId, markerId]);

  return (
    <div className={`survey-marker-notes survey-marker-notes--${variant}`} data-testid="survey-marker-notes">
      <SurveyNoteField
        key={markerId}
        text={noteText(note)}
        onSave={saveText}
        variant={variant}
        autoFocus={autoFocusNote}
        onAutoFocused={onAutoFocused}
        readOnly={!canEdit}
      />
      <div className="survey-marker-notes__media">
        <span className="survey-notes__label">Media</span>
        <SurveyMediaStrip
          variant={variant}
          items={items}
          pending={pending}
          canRemove={canEdit}
          onRemove={removeItem}
          onDropFiles={canEdit ? uploadFiles : null}
        >
          {canEdit ? (
            <SurveyMediaUploadTile
              variant={variant}
              recording={recorder.state !== 'idle'}
              onFiles={uploadFiles}
              onRecordAudio={recorder.start}
            />
          ) : null}
        </SurveyMediaStrip>
        <SurveyAudioRecorderBar recorder={recorder} />
      </div>
      {typeof document !== 'undefined'
        ? createPortal(<div className="survey-media-confirm-layer">{confirmDialogElement}</div>, document.body)
        : null}
    </div>
  );
}
