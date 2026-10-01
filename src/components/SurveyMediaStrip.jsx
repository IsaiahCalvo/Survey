// Survey media strip (owner 2026-10-01, audit §3/§4): 64px thumbnails - a
// photo, a video's poster frame, an audio tile with its length - that open a
// full-screen viewer. Remove: long-press on the phone, a hover ✕ on desktop.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { getSurveyMediaUrl } from '../services/surveyMediaService';
import { formatMediaDuration } from './SurveyMediaCapture';

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

/**
 * A signed (or legacy data:) URL for one MediaRef: { url, failed }. url is
 * null until it resolves; failed when it cannot (no access, offline, or a
 * legacy item whose bytes this device's cache dropped).
 */
export function useSurveyMediaUrl(ref) {
  const [state, setState] = useState({ url: ref?.legacyDataUrl || null, failed: false });
  const key = ref?.legacyDataUrl ? `legacy:${ref.id}` : ref?.path || ref?.id || '';
  useEffect(() => {
    if (!ref) return undefined;
    let alive = true;
    if (ref.legacyDataUrl) { setState({ url: ref.legacyDataUrl, failed: false }); return undefined; }
    if (!ref.path) { setState({ url: null, failed: true }); return undefined; }
    setState({ url: null, failed: false });
    getSurveyMediaUrl(ref)
      .then((next) => { if (alive) setState({ url: next || null, failed: !next }); })
      .catch((error) => {
        console.warn('[surveyMedia] could not get a link', error);
        if (alive) setState({ url: null, failed: true });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export const mediaKindLabel = (kind) => (kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Photo');

// A poster frame: a media fragment asks the browser to paint the first frame
// (iOS paints nothing for preload=metadata without it). data: URLs keep theirs.
const posterSrc = (url) => (url && !url.startsWith('data:') ? `${url.split('#')[0]}#t=0.1` : url);

function MediaThumb({ item, variant, canRemove, onOpen, onRemove }) {
  const { url } = useSurveyMediaUrl(item);
  const pressRef = useRef(null);
  const suppressClickRef = useRef(false);
  const label = `${mediaKindLabel(item.kind)}${item.name ? `: ${item.name}` : ''}`;

  const clearPress = () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };
  useEffect(() => clearPress, []);

  const touchHandlers = variant === 'phone' && canRemove ? {
    onTouchStart: (event) => {
      const touch = event.touches[0];
      suppressClickRef.current = false;
      clearPress();
      pressRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        timer: window.setTimeout(() => {
          pressRef.current = null;
          suppressClickRef.current = true;
          try { navigator.vibrate?.(10); } catch { /* not supported */ }
          onRemove(item);
        }, LONG_PRESS_MS),
      };
    },
    onTouchMove: (event) => {
      const press = pressRef.current;
      const touch = event.touches[0];
      if (press && Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > LONG_PRESS_SLOP_PX) clearPress();
    },
    onTouchEnd: (event) => {
      clearPress();
      // A long-press opened the remove confirm: no click may follow it onto
      // the confirm's backdrop (which would cancel it at once).
      if (suppressClickRef.current && event.cancelable) event.preventDefault();
    },
    onTouchCancel: clearPress,
    onContextMenu: (event) => event.preventDefault(),
  } : {};

  return (
    <div className={`survey-media-thumb is-${item.kind}`} data-testid="survey-media-thumb" data-kind={item.kind}>
      <button
        type="button"
        className="survey-media-tile"
        aria-label={`Open ${label}`}
        onClick={(event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            event.preventDefault();
            return;
          }
          onOpen(item);
        }}
        {...touchHandlers}
      >
        {item.kind === 'photo' && url ? (
          <img src={url} alt="" draggable={false} loading="lazy" />
        ) : null}
        {item.kind === 'video' && url ? (
          <video src={posterSrc(url)} muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" />
        ) : null}
        {item.kind === 'video' ? (
          <span className="survey-media-tile__badge" aria-hidden="true"><Icon name="play" size={12} color="currentColor" /></span>
        ) : null}
        {item.kind === 'audio' ? (
          <span className="survey-media-tile__audio" aria-hidden="true">
            <Icon name="mic" size={20} color="currentColor" />
            <span>{item.durationMs ? formatMediaDuration(item.durationMs) : 'Audio'}</span>
          </span>
        ) : null}
        {!url && item.kind !== 'audio' ? (
          <span className="survey-media-tile__placeholder" aria-hidden="true">
            <Icon name={item.kind === 'video' ? 'video' : 'image'} size={20} color="currentColor" />
          </span>
        ) : null}
      </button>
      {variant === 'desktop' && canRemove ? (
        <button
          type="button"
          className="survey-media-thumb__remove"
          aria-label={`Remove ${label}`}
          onClick={(event) => { event.stopPropagation(); onRemove(item); }}
        >
          <Icon name="close" size={11} color="currentColor" />
        </button>
      ) : null}
    </div>
  );
}

/** An upload in flight: its local preview (photos) and a progress ring. */
function PendingThumb({ upload }) {
  const pct = Math.round((upload.progress || 0) * 100);
  return (
    <div className={`survey-media-thumb is-${upload.kind} is-pending`} data-testid="survey-media-pending">
      <div
        className="survey-media-tile"
        role="progressbar"
        aria-label={`Uploading ${upload.name || mediaKindLabel(upload.kind)}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        {upload.previewUrl ? <img src={upload.previewUrl} alt="" draggable={false} /> : (
          <span className="survey-media-tile__placeholder" aria-hidden="true">
            <Icon name={upload.kind === 'video' ? 'video' : upload.kind === 'audio' ? 'mic' : 'image'} size={20} color="currentColor" />
          </span>
        )}
        <span className="survey-media-tile__progress" aria-hidden="true">
          <span style={{ width: `${Math.max(6, pct)}%` }} />
        </span>
      </div>
    </div>
  );
}

function MediaViewerStage({ item }) {
  const { url, failed } = useSurveyMediaUrl(item);
  if (failed) {
    return (
      <div className="survey-media-viewer__loading">
        {item.unavailable ? "This file isn't stored on this device." : "Couldn't open this file. Check your connection and try again."}
      </div>
    );
  }
  if (!url) return <div className="survey-media-viewer__loading">Loading…</div>;
  if (item.kind === 'photo') return <img className="survey-media-viewer__photo" src={url} alt={item.name || 'Photo'} />;
  if (item.kind === 'video') {
    return <video key={url} className="survey-media-viewer__video" src={url} controls playsInline autoPlay data-testid="survey-media-viewer-video" />;
  }
  return (
    <div className="survey-media-viewer__audio">
      <span className="survey-media-viewer__audio-glyph"><Icon name="mic" size={40} color="currentColor" /></span>
      {item.durationMs ? <span className="survey-media-viewer__audio-length">{formatMediaDuration(item.durationMs)}</span> : null}
      <audio key={url} src={url} controls autoPlay data-testid="survey-media-viewer-audio" />
    </div>
  );
}

/** Full screen: the photo, the video player or the audio player. */
export function SurveyMediaViewer({ items, index, onIndexChange, onClose, onRemove }) {
  const item = items[index];
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      else if (event.key === 'ArrowLeft' && items.length > 1) onIndexChange((index - 1 + items.length) % items.length);
      else if (event.key === 'ArrowRight' && items.length > 1) onIndexChange((index + 1) % items.length);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, items.length, onClose, onIndexChange]);
  if (!item || typeof document === 'undefined') return null;
  return createPortal(
    <div className="survey-media-viewer" role="dialog" aria-modal="true" aria-label={`${mediaKindLabel(item.kind)} viewer`} data-testid="survey-media-viewer">
      <div className="survey-media-viewer__bar">
        <span className="survey-media-viewer__title">
          {item.name || mediaKindLabel(item.kind)}
          {items.length > 1 ? <span className="survey-media-viewer__count">{index + 1} of {items.length}</span> : null}
        </span>
        {onRemove ? (
          <button type="button" className="survey-media-viewer__btn" aria-label={`Remove this ${mediaKindLabel(item.kind).toLowerCase()}`} onClick={() => onRemove(item)}>
            <Icon name="trash" size={18} color="currentColor" />
          </button>
        ) : null}
        <button ref={closeRef} type="button" className="survey-media-viewer__btn" aria-label="Close viewer" onClick={onClose}>
          <Icon name="close" size={18} color="currentColor" />
        </button>
      </div>
      <div
        className="survey-media-viewer__stage"
        onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      >
        <MediaViewerStage item={item} />
      </div>
      {items.length > 1 ? (
        <>
          <button type="button" className="survey-media-viewer__nav is-prev" aria-label="Previous" onClick={() => onIndexChange((index - 1 + items.length) % items.length)}>
            <Icon name="chevronLeft" size={22} color="currentColor" />
          </button>
          <button type="button" className="survey-media-viewer__nav is-next" aria-label="Next" onClick={() => onIndexChange((index + 1) % items.length)}>
            <Icon name="chevronRight" size={22} color="currentColor" />
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

/**
 * The strip itself: saved items, uploads in flight, then `children` (the
 * Upload media tile). Desktop also takes files dropped onto it.
 */
export default function SurveyMediaStrip({ variant, items, pending, canRemove, onRemove, onDropFiles, children }) {
  const [viewerIndex, setViewerIndex] = useState(-1);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (viewerIndex >= items.length) setViewerIndex(items.length ? items.length - 1 : -1);
  }, [items.length, viewerIndex]);

  const closeViewer = useCallback(() => setViewerIndex(-1), []);
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
  const dropHandlers = variant === 'desktop' && onDropFiles ? {
    onDragEnter: (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragOver(true);
    },
    onDragOver: (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: () => {
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (!dragDepthRef.current) setDragOver(false);
    },
    onDrop: (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setDragOver(false);
      const files = Array.from(event.dataTransfer.files || []);
      if (files.length) onDropFiles(files);
    },
  } : {};

  return (
    <div className={`survey-media${dragOver ? ' is-drag-over' : ''}`} data-testid="survey-media-strip" {...dropHandlers}>
      <div className="survey-media__grid">
        {items.map((item, index) => (
          <MediaThumb
            key={item.id || item.path || index}
            item={item}
            variant={variant}
            canRemove={canRemove}
            onOpen={() => setViewerIndex(index)}
            onRemove={onRemove}
          />
        ))}
        {pending.map((upload) => <PendingThumb key={upload.key} upload={upload} />)}
        {children}
      </div>
      {dragOver ? <div className="survey-media__drop-hint">Drop photos, videos or audio to add them</div> : null}
      {viewerIndex >= 0 && items[viewerIndex] ? (
        <SurveyMediaViewer
          items={items}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={closeViewer}
          onRemove={canRemove ? (item) => { closeViewer(); onRemove(item); } : null}
        />
      ) : null}
    </div>
  );
}
