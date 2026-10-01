// Survey media capture (owner 2026-10-01, audit §4): ONE "Upload media" tile
// that opens a menu - Take photo, Record video, Record audio, Choose files -
// plus the in-app audio recorder. iOS has no audio option for <input capture>,
// so audio is recorded here with getUserMedia + MediaRecorder.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { watchLightPopover } from './dismissRules';
import { showToast } from '../utils/toast';

const isIOS = () => {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1);
};

/** The recording format: AAC in MP4 on iOS (WebKit records nothing else),
 *  Opus in WebM in Chrome and Electron. */
export function pickAudioRecordingMime(win = typeof window !== 'undefined' ? window : null) {
  const Recorder = win?.MediaRecorder;
  if (!Recorder) return '';
  const order = isIOS()
    ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return order.find((type) => {
    try { return Recorder.isTypeSupported?.(type); } catch { return false; }
  }) || '';
}

export const formatMediaDuration = (ms) => {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const recordingFileName = (mime) => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
  return `Audio ${stamp}.${mime.startsWith('audio/mp4') ? 'm4a' : 'webm'}`;
};

/**
 * The in-app recorder. `onRecorded(file, durationMs)` gets the finished clip;
 * cancel() discards it. The microphone is released on stop, cancel and unmount.
 */
export function useAudioRecorder({ onRecorded }) {
  const [state, setState] = useState('idle'); // 'idle' | 'starting' | 'recording'
  const [elapsedMs, setElapsedMs] = useState(0);
  const sessionRef = useRef(null);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const release = useCallback((session) => {
    if (!session) return;
    window.clearInterval(session.timer);
    session.stream?.getTracks?.().forEach((track) => { try { track.stop(); } catch { /* already stopped */ } });
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') {
      showToast('This device cannot record audio here.', 'warn');
      return;
    }
    const session = { cancelled: false, chunks: [], startedAt: 0, timer: 0, stream: null, recorder: null };
    sessionRef.current = session;
    setState('starting');
    setElapsedMs(0);
    try {
      session.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      sessionRef.current = null;
      setState('idle');
      const blocked = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      showToast(blocked
        ? 'Microphone access is off. Allow it for Survey in Settings to record audio.'
        : 'Could not start the microphone.', 'warn');
      return;
    }
    if (session.cancelled) { release(session); return; }
    const mimeType = pickAudioRecordingMime();
    let recorder;
    try {
      recorder = new window.MediaRecorder(session.stream, mimeType ? { mimeType } : undefined);
    } catch {
      release(session);
      sessionRef.current = null;
      setState('idle');
      showToast('This device cannot record audio here.', 'warn');
      return;
    }
    session.recorder = recorder;
    recorder.ondataavailable = (event) => { if (event.data?.size) session.chunks.push(event.data); };
    recorder.onstop = () => {
      const durationMs = Date.now() - session.startedAt;
      release(session);
      if (sessionRef.current === session) sessionRef.current = null;
      setState('idle');
      if (session.cancelled || !session.chunks.length) return;
      // The bucket allows plain media types: drop the codecs parameter.
      const type = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
      const file = new File(session.chunks, recordingFileName(type), { type });
      onRecordedRef.current?.(file, durationMs);
    };
    session.startedAt = Date.now();
    recorder.start(1000);
    session.timer = window.setInterval(() => setElapsedMs(Date.now() - session.startedAt), 250);
    setState('recording');
  }, [release]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (session?.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.cancelled = true;
    if (session.recorder && session.recorder.state !== 'inactive') {
      session.recorder.stop();
    } else {
      release(session);
      sessionRef.current = null;
      setState('idle');
    }
  }, [release]);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (!session) return;
    session.cancelled = true;
    try { if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop(); } catch { /* ignore */ }
    release(session);
  }, [release]);

  return { state, elapsedMs, start, stop, cancel };
}

/** The recorder's line: a red dot, the timer, Cancel and Stop. */
export function SurveyAudioRecorderBar({ recorder }) {
  if (recorder.state === 'idle') return null;
  return (
    <div className="survey-media-recorder" role="group" aria-label="Recording audio" data-testid="survey-media-recorder">
      <span className={`survey-media-recorder__dot${recorder.state === 'recording' ? ' is-live' : ''}`} aria-hidden="true" />
      <span className="survey-media-recorder__time" aria-live="off">{formatMediaDuration(recorder.elapsedMs)}</span>
      <span className="survey-media-recorder__label">{recorder.state === 'recording' ? 'Recording' : 'Starting microphone'}</span>
      <button type="button" className="survey-media-recorder__cancel" onClick={recorder.cancel}>Cancel</button>
      <button
        type="button"
        className="survey-media-recorder__stop"
        disabled={recorder.state !== 'recording'}
        onClick={recorder.stop}
      >
        Stop
      </button>
    </div>
  );
}

/**
 * The one "Upload media" tile and its menu. Phone: an action sheet from the
 * bottom of the screen. Desktop: a small menu under the tile, without the
 * camera items (a desktop browser opens a file picker for them anyway).
 */
export function SurveyMediaUploadTile({ variant, disabled, onFiles, onRecordAudio, recording }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const tileRef = useRef(null);
  const menuRef = useRef(null);
  const photoRef = useRef(null);
  const videoRef = useRef(null);
  const filesRef = useRef(null);
  const isPhone = variant === 'phone';

  useEffect(() => {
    if (!open) return undefined;
    return watchLightPopover({
      contains: (target) => Boolean(menuRef.current?.contains(target) || tileRef.current?.contains(target)),
      close: () => setOpen(false),
    });
  }, [open]);

  useLayoutEffect(() => {
    if (!open || isPhone || !tileRef.current) return;
    const rect = tileRef.current.getBoundingClientRect();
    const menuHeight = 96;
    const below = rect.bottom + 6 + menuHeight <= window.innerHeight;
    setMenuPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 208)),
      top: below ? rect.bottom + 6 : Math.max(8, rect.top - 6 - menuHeight),
    });
  }, [open, isPhone]);

  const pick = (input) => {
    setOpen(false);
    // Synchronously, inside the tap: iOS only opens a picker from a gesture.
    input?.click();
  };
  const handleChange = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length) onFiles(files);
  };

  const items = [
    isPhone && { key: 'photo', icon: 'camera', label: 'Take photo', run: () => pick(photoRef.current) },
    isPhone && { key: 'video', icon: 'video', label: 'Record video', run: () => pick(videoRef.current) },
    { key: 'audio', icon: 'mic', label: 'Record audio', run: () => { setOpen(false); onRecordAudio(); }, disabled: recording },
    { key: 'files', icon: 'upload', label: 'Choose files', run: () => pick(filesRef.current) },
  ].filter(Boolean);

  const menu = open && typeof document !== 'undefined' ? createPortal(
    isPhone ? (
      <div className="survey-media-sheet-root">
        <div className="survey-media-sheet-backdrop" onClick={() => setOpen(false)} />
        <div ref={menuRef} className="survey-media-sheet" role="menu" aria-label="Upload media">
          <div className="survey-media-sheet__group">
            {items.map((item) => (
              <button key={item.key} type="button" role="menuitem" disabled={item.disabled} onClick={item.run}>
                <Icon name={item.icon} size={20} color="currentColor" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <button type="button" className="survey-media-sheet__cancel" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </div>
    ) : (
      <div
        ref={menuRef}
        className="survey-media-menu"
        role="menu"
        aria-label="Upload media"
        style={menuPos ? { left: menuPos.left, top: menuPos.top } : { visibility: 'hidden' }}
      >
        {items.map((item) => (
          <button key={item.key} type="button" role="menuitem" disabled={item.disabled} onClick={item.run}>
            <Icon name={item.icon} size={15} color="currentColor" />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    ),
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={tileRef}
        type="button"
        className="survey-media-tile survey-media-tile--upload"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="plus" size={18} color="currentColor" />
        <span>Upload media</span>
      </button>
      <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={handleChange} />
      <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden onChange={handleChange} />
      <input ref={filesRef} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={handleChange} />
      {menu}
    </>
  );
}
