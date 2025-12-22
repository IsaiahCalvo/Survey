import React, { useEffect, useState } from 'react';

/**
 * Non-blocking notification component that informs users about
 * unsupported PDF annotation types that cannot be edited.
 * Auto-dismisses after 8 seconds or on user click.
 */
const UnsupportedAnnotationsNotice = ({ unsupportedTypes, onDismiss }) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Auto-dismiss after 8 seconds
    const timer = setTimeout(() => {
      handleDismiss();
    }, 8000);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      setIsVisible(false);
      if (onDismiss) {
        onDismiss();
      }
    }, 300); // Match animation duration
  };

  if (!isVisible || !unsupportedTypes || unsupportedTypes.length === 0) {
    return null;
  }

  const typesList = unsupportedTypes.slice(0, 3).join(', ');
  const moreCount = unsupportedTypes.length > 3 ? unsupportedTypes.length - 3 : 0;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        maxWidth: 400,
        backgroundColor: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: 8,
        padding: '12px 16px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        opacity: isExiting ? 0 : 1,
        transform: isExiting ? 'translateY(10px)' : 'translateY(0)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif',
      }}
    >
      {/* Info icon */}
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
          <circle cx="10" cy="10" r="9" stroke="#4A90E2" strokeWidth="1.5" fill="none" />
          <path
            d="M10 6V6.5M10 9V14"
            stroke="#4A90E2"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Message */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: '#e0e0e0',
            marginBottom: 4,
          }}
        >
          Some annotations cannot be edited
        </div>
        <div
          style={{
            fontSize: 12,
            color: '#888',
            lineHeight: 1.4,
          }}
        >
          This PDF contains {unsupportedTypes.length} annotation type{unsupportedTypes.length > 1 ? 's' : ''} that cannot be edited: {typesList}
          {moreCount > 0 && ` and ${moreCount} more`}.
          {' '}They will be preserved when saving.
        </div>
      </div>

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        style={{
          flexShrink: 0,
          background: 'none',
          border: 'none',
          padding: 4,
          cursor: 'pointer',
          color: '#666',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title="Dismiss"
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
