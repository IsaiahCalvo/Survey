/**
 * UnsupportedAnnotationsNotice.jsx — bottom-right toast telling the user that
 * some annotations in the opened PDF aren't displayed (but stay in the file).
 *
 * UX (owner-approved 2026-07-17): non-blocking, dismissible, shown once per
 * document open (PDFViewer resets + re-arms it on every document load). The
 * message names what we can in plain English ("2 stamps and 1 sound clip …
 * aren't displayed. They're not deleted — they stay in the file and will
 * still be included when you export.") and buckets anything unnameable as
 * "annotations of a type we don't recognize" — never raw PDF subtype jargon.
 * Redaction marks get a stronger warning because their covered text remains
 * readable. The notice stays until the user dismisses it.
 *
 * Default export UnsupportedAnnotationsNotice takes `unsupportedCounts`
 * ({ Stamp: 2, ... } from the importer) and `onDismiss`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUnsupportedAnnotationNotice } from '../utils/unsupportedAnnotationNotice';
import Icon from '../Icons';

const COLLAPSED_DISMISS_MS = 3000;
const EXPANDED_DISMISS_MS = 5000;
const EXIT_ANIMATION_MS = 300;

const UnsupportedAnnotationsNotice = ({ unsupportedCounts, onDismiss }) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches
  ));
  const dismissCompletionRef = useRef(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const noticeIdentity = Object.entries(unsupportedCounts || {})
    .filter(([, count]) => Number(count) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `${type}:${count}`)
    .join('|');
  const hasRedactions = Number(unsupportedCounts?.Redact) > 0;

  const clearDismissCompletion = useCallback(() => {
    if (dismissCompletionRef.current !== null) {
      clearTimeout(dismissCompletionRef.current);
      dismissCompletionRef.current = null;
    }
  }, []);

  const handleDismiss = useCallback(() => {
    clearDismissCompletion();
    setIsExiting(true);
    dismissCompletionRef.current = setTimeout(() => {
      dismissCompletionRef.current = null;
      setIsVisible(false);
      onDismissRef.current?.();
    }, EXIT_ANIMATION_MS);
  }, [clearDismissCompletion]);

  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 720px)');
    if (!query) return undefined;
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => () => clearDismissCompletion(), [clearDismissCompletion]);

  useEffect(() => {
    clearDismissCompletion();
    setIsVisible(true);
    setIsExiting(false);
    setIsExpanded(false);
  }, [clearDismissCompletion, noticeIdentity]);

  useEffect(() => {
    if (!isVisible || isExiting || hasRedactions) return undefined;
    const dismissAfter = isMobile && !isExpanded
      ? COLLAPSED_DISMISS_MS
      : EXPANDED_DISMISS_MS;
    const timer = setTimeout(handleDismiss, dismissAfter);
    return () => clearTimeout(timer);
  }, [handleDismiss, hasRedactions, isExpanded, isExiting, isMobile, isVisible, noticeIdentity]);

  const message = formatUnsupportedAnnotationNotice(unsupportedCounts);
  if (!isVisible || !message) {
    return null;
  }

  return (
    <div
      role={isMobile ? 'button' : undefined}
      tabIndex={isMobile ? 0 : undefined}
      aria-expanded={isMobile ? isExpanded : undefined}
      aria-label={isMobile
        ? `Unsupported annotation. ${isExpanded ? 'Hide' : 'Show'} details`
        : undefined}
      onClick={() => { if (isMobile) setIsExpanded((expanded) => !expanded); }}
      onKeyDown={(event) => {
        if (!isMobile || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        setIsExpanded((expanded) => !expanded);
      }}
      style={{
        position: 'fixed',
        bottom: isMobile ? 'calc(var(--mobile-viewer-dock-height, 72px) + 12px)' : 20,
        right: isMobile ? 12 : 20,
        width: isMobile && isExpanded ? 'calc(100vw - 116px)' : 'auto',
        maxWidth: isMobile ? (isExpanded ? 340 : 248) : 400,
        backgroundColor: '#1a1a1a',
        border: '1px solid #2a3140',
        borderRadius: 8,
        padding: isMobile ? '10px 12px' : '12px 16px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        zIndex: 10000,
        display: 'flex',
        alignItems: isMobile && !isExpanded ? 'center' : 'flex-start',
        gap: isMobile ? 9 : 12,
        opacity: isExiting ? 0 : 1,
        transform: isExiting ? 'translateY(10px)' : 'translateY(0)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        cursor: isMobile ? 'pointer' : 'default',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif',
      }}
    >
      {/* Circled information mark: explanatory notice, not visibility toggle. */}
      <div
        aria-label="Information"
        style={{
          flexShrink: 0,
          width: 20,
          height: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="infoCircle" size={20} color="#d8a84e" />
      </div>

      {/* Message */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: '#e8e2d4',
            marginBottom: !isMobile || isExpanded ? 4 : 0,
            whiteSpace: isMobile && !isExpanded ? 'nowrap' : 'normal',
          }}
        >
          {hasRedactions
            ? 'Redactions are not applied'
            : (isMobile ? 'Unsupported annotation' : 'Some annotations aren’t displayed')}
        </div>
        {(!isMobile || isExpanded) && (
          <div
            style={{
              fontSize: 12,
              color: '#8d96a6',
              lineHeight: 1.4,
            }}
          >
            {message}
          </div>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={(event) => { event.stopPropagation(); handleDismiss(); }}
        style={{
          flexShrink: 0,
          background: 'none',
          border: 'none',
          padding: 4,
          cursor: 'pointer',
          color: '#5a6473',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title="Dismiss"
        aria-label="Dismiss"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
};

export default UnsupportedAnnotationsNotice;
