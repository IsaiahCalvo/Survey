// The Survey agent's camera: opened by the take_photo tool ("take a photo for
// D-117"). A live preview from the back camera, a shutter button, and Cancel;
// in hands-free mode the panel also takes the photo on "take it" / "snap".
// Where the live camera is not allowed, it falls back to the phone's own
// camera through a file input, which needs a tap.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

const JPEG_QUALITY = 0.85;

function stillFrom(video) {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}

const SurveyAgentCamera = forwardRef(function SurveyAgentCamera({ itemName, handsFree = false, onDone }, ref) {
  const videoRef = useRef(null);
  const inputRef = useRef(null);
  const streamRef = useRef(null);
  const doneRef = useRef(false);
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);

  const finish = (file) => {
    if (doneRef.current) return;
    doneRef.current = true;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onDone(file);
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!live || !video) return false;
    const blob = await stillFrom(video);
    if (!blob) return false;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    finish(new File([blob], `photo-${stamp}.jpg`, { type: 'image/jpeg' }));
    return true;
  };

  useImperativeHandle(ref, () => ({ capture, cancel: () => finish(null) }));

  useEffect(() => {
    let cancelled = false;
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!media?.getUserMedia) { setFailed(true); return undefined; }
    media.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        if (cancelled || doneRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.play?.().catch(() => {});
        }
        setLive(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="survey-agent__camera" role="group" aria-label={`Camera for ${itemName}`}>
      <p className="survey-agent__camera-title">Photo for {itemName}</p>
      {!failed && (
        <video ref={videoRef} className="survey-agent__camera-view" muted playsInline autoPlay aria-hidden="true" />
      )}
      {failed && <p className="survey-agent__camera-note">The live camera is not available. Open the phone camera instead.</p>}
      {handsFree && live && <p className="survey-agent__camera-note">Say "take it" to take the photo, or "cancel".</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) finish(file); }}
      />
      <div className="survey-agent__camera-actions">
        <button type="button" className="survey-agent__undo" onClick={() => finish(null)}>Cancel</button>
        {failed
          ? <button type="button" className="survey-agent__send" onClick={() => inputRef.current?.click()}>Open camera</button>
          : <button type="button" className="survey-agent__send" disabled={!live} onClick={capture}>Take photo</button>}
      </div>
    </div>
  );
});

export default SurveyAgentCamera;
