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
 * Only genuinely-invisible types trigger it; annotations imported as visible
 * (even locked) proxies — sticky notes, underline/strikeout/squiggly — never
 * do. No action buttons; auto-dismisses after 12s or on the X.
 *
 * Default export UnsupportedAnnotationsNotice takes `unsupportedCounts`
 * ({ Stamp: 2, ... } from the importer) and `onDismiss`.
 */
import { useEffect, useState } from 'react';
import { formatUnsupportedAnnotationNotice } from '../utils/unsupportedAnnotationNotice';

const UnsupportedAnnotationsNotice = ({ unsupportedCounts, onDismiss }) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches
  ));

  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 720px)');
    if (!query) return undefined;
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    // Auto-dismiss after 12 seconds — the message is a full sentence with
    // counts, so it gets a little longer on screen than a one-liner toast.
    if (isExpanded) return undefined;
    const timer = setTimeout(() => {
      handleDismiss();
    }, 12000);

    return () => clearTimeout(timer);
  }, [isExpanded]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      setIsVisible(false);
      if (onDismiss) {
        onDismiss();
      }
    }, 300); // Match animation duration
  };

  const message = formatUnsupportedAnnotationNotice(unsupportedCounts);
  if (!isVisible || !message) {
    return null;
  }

  return (
    <div
      role={isMobile && !isExpanded ? 'button' : undefined}
      tabIndex={isMobile && !isExpanded ? 0 : undefined}
      aria-expanded={isMobile ? isExpanded : undefined}
      aria-label={isMobile && !isExpanded ? 'Unsupported annotation. Show details' : undefined}
      onClick={() => { if (isMobile && !isExpanded) setIsExpanded(true); }}
      onKeyDown={(event) => {
        if (!isMobile || isExpanded || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        setIsExpanded(true);
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
        cursor: isMobile && !isExpanded ? 'pointer' : 'default',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif',
      }}
    >
      {/* Eye = the PDF content is preserved but cannot currently be shown. */}
      <div
        style={{
          flexShrink: 0,
          width: 20,
          height: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M2 10C4.1 6.6 6.8 4.9 10 4.9S15.9 6.6 18 10c-2.1 3.4-4.8 5.1-8 5.1S4.1 13.4 2 10Z" stroke="#d8a84e" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="2.5" stroke="#d8a84e" strokeWidth="1.5" />
        </svg>
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
          {isMobile ? 'Unsupported annotation' : 'Some annotations aren’t displayed'}
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
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4 4L12 12M12 4L4 12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
};

export default UnsupportedAnnotationsNotice;
