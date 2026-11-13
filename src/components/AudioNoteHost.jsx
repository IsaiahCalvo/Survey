/* Nightly 'audio-note': Drawboard's Insert > Audio note.
 *   - Audio note in the Text group (AUDIO_NOTE_OPEN_EVENT) opens "New audio
 *     note": Record (the same recorder as Survey Marker notes, kept small) or
 *     Choose file, listen back, then Insert pins a speaker badge mid-page in
 *     view (one save, one Undo step, picked). Clips stop at 2 minutes.
 *   - Play on the picked bar (AUDIO_NOTE_PLAY_EVENT) plays the picked note;
 *     pressing it again stops it.
 * The mark and its rules: utils/audioNote.js. */
import { useCallback, useEffect, useRef, useState } from 'react';
import DialogCard from './DialogCard.jsx';
import Icon from '../Icons';
import { SurveyAudioRecorderBar, useAudioRecorder } from './SurveyMediaCapture.jsx';
import { placeLibraryItem } from '../markLibrary/markLibraryPlacement.js';
import { showToast } from '../utils/toast';
import {
  AUDIO_NOTE_BADGE_SVG,
  AUDIO_NOTE_BITRATE,
  AUDIO_NOTE_MAX_MS,
  AUDIO_NOTE_OPEN_EVENT,
  AUDIO_NOTE_PLAY_EVENT,
  audioNoteItem,
  audioNoteProblem,
  formatAudioDuration,
} from '../utils/audioNote.js';
import './AudioNoteHost.css';

const readAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('read failed'));
  reader.readAsDataURL(blob);
});

let badgeCache = null;
async function badgePng() {
  if (badgeCache) return badgeCache;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(AUDIO_NOTE_BADGE_SVG)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  canvas.getContext('2d').drawImage(img, 0, 0, 96, 96);
  badgeCache = canvas.toDataURL('image/png');
  return badgeCache;
}

// A clip's length, read from the file when the recorder did not time it.
const clipDuration = (src) => new Promise((resolve) => {
  const audio = new Audio();
  const done = (ms) => { audio.src = ''; resolve(ms); };
  audio.preload = 'metadata';
  audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
  audio.onerror = () => done(0);
  audio.src = src;
  setTimeout(() => done(0), 3000);
});

export function AudioNoteDialog({ open, onSubmit, onCancel }) {
  const [clip, setClip] = useState(null); // { src, durationMs, name }
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const take = useCallback(async (blob, durationMs, name) => {
    try {
      const src = await readAsDataUrl(blob);
      const ms = durationMs || await clipDuration(src);
      const problem = audioNoteProblem({ src, durationMs: ms });
      if (problem) { setError(problem); return; }
      setError('');
      setClip({ src, durationMs: ms, name: name || 'Audio note' });
    } catch {
      setError('That clip could not be read.');
    }
  }, []);
  const recorder = useAudioRecorder({
    bitsPerSecond: AUDIO_NOTE_BITRATE,
    onRecorded: (file, durationMs) => take(file, durationMs, 'Audio note'),
  });
  const { state: recState, elapsedMs, stop: stopRec, cancel: cancelRec } = recorder;
  // Clips stop at the cap on their own.
  useEffect(() => {
    if (recState === 'recording' && elapsedMs >= AUDIO_NOTE_MAX_MS) stopRec();
  }, [recState, elapsedMs, stopRec]);
  useEffect(() => {
    if (open) return;
    setClip(null);
    setError('');
    cancelRec();
  }, [open, cancelRec]);
  const recording = recState !== 'idle';
  return (
    <DialogCard
      open={open}
      title="New audio note"
      ariaLabel="New audio note"
      onClose={onCancel}
      width={380}
      zIndex={1400}
      cardProps={{ 'data-audio-note-dialog': 'create' }}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="hub-btn hub-btn--primary dialog-touch-pad"
            data-audio-note-submit=""
            disabled={!clip || recording}
            onClick={() => clip && onSubmit?.(clip)}
          >
            Insert
          </button>
        </>
      )}
    >
      {recording ? (
        <SurveyAudioRecorderBar recorder={recorder} />
      ) : (
        <div className="audio-note-dialog__actions">
          <button type="button" className="hub-btn dialog-touch-pad" data-audio-note-record="" onClick={() => { setError(''); recorder.start(); }}>
            <Icon name="mic" size={16} color="currentColor" />
            <span>{clip ? 'Record again' : 'Record'}</span>
          </button>
          <button type="button" className="hub-btn dialog-touch-pad" data-audio-note-file="" onClick={() => fileRef.current?.click()}>
            <Icon name="paperclip" size={16} color="currentColor" />
            <span>Choose file</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            hidden
            data-audio-note-file-input=""
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) take(file, 0, file.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </div>
      )}
      {clip && !recording && (
        <div className="audio-note-dialog__clip" data-audio-note-clip="">
          {/* Plays only when the person presses play. */}
          <audio controls preload="metadata" src={clip.src} />
          <span className="audio-note-dialog__length">{formatAudioDuration(clip.durationMs)}</span>
        </div>
      )}
      {!clip && !recording && !error && (
        <p className="audio-note-dialog__hint">Record up to 2 minutes, or choose an audio file.</p>
      )}
      {error && <div role="alert" className="audio-note-dialog__error">{error}</div>}
    </DialogCard>
  );
}

export default function AudioNoteHost({
  isActive = true,
  readOnly = false,
  selectedAudio = null, // { id, src, durationMs, name } for the one picked audio note
}) {
  const [open, setOpen] = useState(false);
  const playingRef = useRef(null); // { id, audio }
  const stopPlaying = useCallback(() => {
    const playing = playingRef.current;
    playingRef.current = null;
    if (playing) { try { playing.audio.pause(); playing.audio.src = ''; } catch { /* gone */ } }
  }, []);
  useEffect(() => {
    if (isActive) return;
    setOpen(false);
    stopPlaying();
  }, [isActive, stopPlaying]);
  useEffect(() => stopPlaying, [stopPlaying]);
  useEffect(() => {
    if (!isActive) return undefined;
    const onOpen = () => { if (!readOnly) setOpen(true); };
    window.addEventListener(AUDIO_NOTE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(AUDIO_NOTE_OPEN_EVENT, onOpen);
  }, [isActive, readOnly]);

  const selectedRef = useRef(selectedAudio);
  selectedRef.current = selectedAudio;
  useEffect(() => {
    if (!isActive) return undefined;
    const onPlay = () => {
      const picked = selectedRef.current;
      if (!picked) return;
      const same = playingRef.current?.id === picked.id;
      stopPlaying();
      if (same) return; // a second press stops it
      const audio = new Audio(picked.src);
      playingRef.current = { id: picked.id, audio };
      audio.onended = () => { if (playingRef.current?.audio === audio) playingRef.current = null; };
      audio.play().catch(() => {
        if (playingRef.current?.audio === audio) playingRef.current = null;
        showToast('This audio note could not be played here.', 'warn');
      });
    };
    window.addEventListener(AUDIO_NOTE_PLAY_EVENT, onPlay);
    return () => window.removeEventListener(AUDIO_NOTE_PLAY_EVENT, onPlay);
  }, [isActive, stopPlaying]);

  const submit = useCallback(async (clip) => {
    setOpen(false);
    try {
      const item = audioNoteItem({ badgeSrc: await badgePng(), ...clip });
      if (!item || !placeLibraryItem(item, { center: true })) showToast('The audio note could not be placed.', 'error');
    } catch {
      showToast('The audio note could not be placed.', 'error');
    }
  }, []);

  return <AudioNoteDialog open={open} onSubmit={submit} onCancel={() => setOpen(false)} />;
}
