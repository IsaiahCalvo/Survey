/* Nightly 'image-camera' (Drawboard Insert > Image > Camera): the Text
 * group's Camera button takes a photo and drops it in the middle of the page
 * in view (one save, one Undo step, picked), like a picture from a file.
 *   - Phones and tablets (a finger is the main pointer) open the device's own
 *     camera through the file input's capture hint.
 *   - Desktops open "Take photo": the live camera, Take photo, then Insert or
 *     Retake. The camera light goes off as soon as the card closes.
 * The mark: utils/insertedImage.js; placing it: components/InsertImage.jsx. */
import { useCallback, useEffect, useRef, useState } from 'react';
import DialogCard from './DialogCard.jsx';
import Icon from '../Icons';
import { insertImageFile, pickImageToInsert } from './InsertImage.jsx';
import { showToast } from '../utils/toast';
import './ImageCameraHost.css';

export const IMAGE_CAMERA_OPEN_EVENT = 'survey:image-camera-open';

/** True when the device's own camera app is the better way in. */
export function prefersNativeCamera(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false;
  const coarse = Boolean(win.matchMedia?.('(pointer: coarse)')?.matches);
  const hover = Boolean(win.matchMedia?.('(hover: hover)')?.matches);
  const noLiveCamera = typeof win.navigator?.mediaDevices?.getUserMedia !== 'function';
  return noLiveCamera || (coarse && !hover);
}

/** The camera message to show for a getUserMedia failure. */
export function cameraProblem(error) {
  const name = String(error?.name || '');
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Survey is not allowed to use the camera. Allow it in the browser, or choose a file.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found. You can choose a file instead.';
  if (name === 'NotReadableError') return 'The camera is busy in another app.';
  return 'The camera could not start.';
}

function openNativeCamera() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.setAttribute('capture', 'environment');
  input.setAttribute('data-image-camera-input', 'true');
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (file) placePhoto(file);
  }, { once: true });
  document.body.appendChild(input);
  input.click();
}

async function placePhoto(file) {
  const done = await insertImageFile(file, { center: true });
  if (!done) showToast('The photo could not be placed.', 'error');
  return done;
}

const stopStream = (stream) => { stream?.getTracks?.().forEach((track) => { try { track.stop(); } catch { /* gone */ } }); };

export function ImageCameraDialog({ open, onCancel, onPlaced, onChooseFile }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState('starting'); // starting | live | taken | error
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState(null); // { url, blob }
  const [busy, setBusy] = useState(false);

  const stop = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    stop();
    setState('starting');
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      setState('live');
    } catch (err) {
      setError(cameraProblem(err));
      setState('error');
    }
  }, [stop]);

  useEffect(() => {
    if (!open) {
      stop();
      setPhoto((current) => { if (current) URL.revokeObjectURL(current.url); return null; });
      return undefined;
    }
    start();
    return stop;
  }, [open, start, stop]);

  const take = () => {
    const video = videoRef.current;
    const width = video?.videoWidth || 0;
    const height = video?.videoHeight || 0;
    if (!width || !height) return;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      stop();
      setPhoto({ url: URL.createObjectURL(blob), blob });
      setState('taken');
    }, 'image/jpeg', 0.9);
  };

  const retake = () => {
    setPhoto((current) => { if (current) URL.revokeObjectURL(current.url); return null; });
    start();
  };

  const insert = async () => {
    if (!photo || busy) return;
    setBusy(true);
    const file = new File([photo.blob], 'Photo.jpg', { type: 'image/jpeg' });
    try { await onPlaced?.(file); } finally { setBusy(false); }
  };

  return (
    <DialogCard
      open={open}
      title="Take photo"
      ariaLabel="Take photo"
      onClose={onCancel}
      width={520}
      zIndex={1400}
      cardProps={{ 'data-image-camera-dialog': state }}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          {state === 'error' && (
            <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" data-image-camera-file="" onClick={onChooseFile}>Choose file</button>
          )}
          {state === 'taken' && (
            <button type="button" className="hub-btn dialog-touch-pad" data-image-camera-retake="" onClick={retake}>Retake</button>
          )}
          {state === 'taken' ? (
            <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" data-image-camera-insert="" disabled={busy} onClick={insert}>Insert</button>
          ) : state !== 'error' && (
            <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" data-image-camera-take="" disabled={state !== 'live'} onClick={take}>
              <Icon name="camera" size={16} color="currentColor" />
              <span>Take photo</span>
            </button>
          )}
        </>
      )}
    >
      <div className="image-camera-dialog__frame">
        {/* Muted and inline: the live view never makes a sound and never goes full screen. */}
        <video ref={videoRef} muted playsInline autoPlay hidden={state !== 'live' && state !== 'starting'} />
        {photo && <img src={photo.url} alt="Photo taken" />}
        {state === 'starting' && <span className="image-camera-dialog__hint">Starting the camera…</span>}
        {state === 'error' && <span role="alert" className="image-camera-dialog__error">{error}</span>}
      </div>
    </DialogCard>
  );
}

export default function ImageCameraHost({ enabled = false, readOnly = false }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) { setOpen(false); return undefined; }
    const onOpen = () => {
      if (readOnly) return;
      if (prefersNativeCamera()) { openNativeCamera(); return; }
      setOpen(true);
    };
    window.addEventListener(IMAGE_CAMERA_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(IMAGE_CAMERA_OPEN_EVENT, onOpen);
  }, [enabled, readOnly]);
  const close = useCallback(() => setOpen(false), []);
  const placed = useCallback(async (file) => {
    const done = await placePhoto(file);
    if (done) setOpen(false);
  }, []);
  const chooseFile = useCallback(() => {
    setOpen(false);
    pickImageToInsert();
  }, []);
  return <ImageCameraDialog open={open} onCancel={close} onPlaced={placed} onChooseFile={chooseFile} />;
}
