import React, { useEffect, useRef } from 'react';
import Icon from '../../Icons';

const CalloutContextMenu = ({ visible, x, y, onClose, onCut, onCopy, onPaste, onDelete, onEdit, hasClipboard, onDeselect }) => {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e) => {
      // Don't close if clicking on the menu or any button inside it
      if (menuRef.current && menuRef.current.contains(e.target)) {
        return; // Let button handlers process the click
      }
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        // If clicking outside, deselect the callout (if callback provided) and close the menu
        if (onDeselect) {
          onDeselect();
        }
        onClose();
      }
    };

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Longer delay to ensure button clicks register first
    const timeout = setTimeout(() => {
      document.addEventListener('click', handleClickOutside, true); // Use capture phase
      document.addEventListener('contextmenu', handleClickOutside, true);
    }, 100); // Increased delay

    document.addEventListener('keydown', handleEscape);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener('click', handleClickOutside, true);
      document.removeEventListener('contextmenu', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [visible, onClose, onDeselect]);

  if (!visible) return null;

  // Adjust position to stay within viewport
  const getAdjustedPosition = () => {
    const menuWidth = 180;
    const menuHeight = 300; // Approximate height
    const padding = 10;

    let adjustedX = x;
    let adjustedY = y;

    if (x + menuWidth > window.innerWidth - padding) {
      adjustedX = window.innerWidth - menuWidth - padding;
    }
    if (x < padding) {
      adjustedX = padding;
    }
    if (y + menuHeight > window.innerHeight - padding) {
      adjustedY = window.innerHeight - menuHeight - padding;
    }
    if (y < padding) {
      adjustedY = padding;
    }

    return { x: adjustedX, y: adjustedY };
  };

  const position = getAdjustedPosition();

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        background: '#333',
        border: '1px solid #444',
        borderRadius: '6px',
        padding: '4px',
        zIndex: 10000,
        minWidth: '180px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif'
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        onClick={() => { onCut(); onClose(); }}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          borderRadius: '4px',
          fontSize: '13px',
          textAlign: 'left',
          cursor: 'pointer',
          color: '#ddd',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <Icon name="scissors" size={14} color="#999" />
        Cut
      </button>
      <button
        onClick={() => { onCopy(); onClose(); }}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          borderRadius: '4px',
          fontSize: '13px',
          textAlign: 'left',
          cursor: 'pointer',
          color: '#ddd',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <Icon name="copy" size={14} color="#999" />
        Copy
      </button>
      <button
        onClick={() => { onPaste(); onClose(); }}
        disabled={!hasClipboard}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          borderRadius: '4px',
          fontSize: '13px',
          textAlign: 'left',
          cursor: hasClipboard ? 'pointer' : 'not-allowed',
          color: hasClipboard ? '#ddd' : '#666',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          opacity: hasClipboard ? 1 : 0.5
        }}
        onMouseEnter={(e) => {
          if (hasClipboard) {
            e.currentTarget.style.background = '#3a3a3a';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <Icon name="paste" size={14} color={hasClipboard ? "#999" : "#555"} />
        Paste
      </button>
      <div style={{
        height: '1px',
        background: '#444',
        margin: '4px 0'
      }} />
      <button
        onClick={() => { onDelete(); onClose(); }}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          borderRadius: '4px',
          fontSize: '13px',
          textAlign: 'left',
          cursor: 'pointer',
          color: '#ddd',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <Icon name="trash" size={14} color="#999" />
        Delete
      </button>
      <div style={{
        height: '1px',
        background: '#444',
        margin: '4px 0'
      }} />
      <button
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onEdit();
          // Use requestAnimationFrame to ensure state update happens before closing
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              onClose();
            });
          });
        }}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          borderRadius: '4px',
          fontSize: '13px',
          textAlign: 'left',
          cursor: 'pointer',
          color: '#ddd',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <Icon name="edit" size={14} color="#999" />
        Edit...
      </button>
    </div>
  );
};

export default CalloutContextMenu;

