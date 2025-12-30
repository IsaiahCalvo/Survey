import React, { useEffect, useRef } from 'react';
import Icon from '../../Icons';

const CalloutContextMenu = ({ visible, x, y, onClose, onCut, onCopy, onPaste, onDelete, onEdit, hasClipboard }) => {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e) => {
      // Don't close if clicking on the menu or any button inside it
      if (menuRef.current && menuRef.current.contains(e.target)) {
        return; // Let button handlers process the click
      }
      if (menuRef.current && !menuRef.current.contains(e.target)) {
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
  }, [visible, onClose]);

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
          // Use onMouseDown to catch the event earlier, before click-outside handler
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          // #region agent log
          console.log('[DEBUG] Edit button clicked', e);
          fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CalloutContextMenu.jsx:193',message:'Edit button clicked',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'A,C'})}).catch((e)=>console.error('Log error:',e));
          // #endregion
          e.stopPropagation();
          e.preventDefault();
          // Call onEdit first, then close after a small delay to allow state update
          console.log('[DEBUG] About to call onEdit');
          onEdit();
          // #region agent log
          console.log('[DEBUG] onEdit called, scheduling onClose');
          fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CalloutContextMenu.jsx:201',message:'onEdit called, scheduling onClose',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'A,C'})}).catch((e)=>console.error('Log error:',e));
          // #endregion
          // Use requestAnimationFrame to ensure state update happens before closing
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              console.log('[DEBUG] Calling onClose after animation frames');
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

