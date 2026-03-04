import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { calculateViewportSafePosition } from '../../utils/menuPositioning';

const CALLOUT_CONTEXT_MENU_Z_INDEX = 120000;

const CalloutContextMenu = ({ visible, x, y, onClose, onCut, onCopy, onPaste, onDelete, onEdit, hasClipboard, onDeselect }) => {
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    if (!visible) return;
    const initialPosition = calculateViewportSafePosition(x, y, {
      estimatedWidth: 180,
      estimatedHeight: 300,
      preferAbove: false
    });
    setPosition(initialPosition);
  }, [visible, x, y]);

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

  useEffect(() => {
    if (!visible || !menuRef.current) return;

    const frameId = requestAnimationFrame(() => {
      if (!menuRef.current) return;
      const rect = menuRef.current.getBoundingClientRect();
      const adjustedPosition = calculateViewportSafePosition(x, y, {
        estimatedWidth: rect.width,
        estimatedHeight: rect.height,
        preferAbove: false
      });
      if (adjustedPosition.x !== position.x || adjustedPosition.y !== position.y) {
        setPosition(adjustedPosition);
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [visible, x, y, position.x, position.y]);

  if (!visible) return null;

  const menuContent = (
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
        zIndex: CALLOUT_CONTEXT_MENU_Z_INDEX,
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
        Copy
      </button>
      {hasClipboard && (
        <button
          onClick={() => { onPaste(); onClose(); }}
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
          Paste
        </button>
      )}
      <div style={{ height: '1px', background: '#444', margin: '4px 0' }} />
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
        Properties
      </button>
      <div style={{ height: '1px', background: '#444', margin: '4px 0' }} />
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
          color: '#ff6b6b',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#3a3a3a'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        Delete
      </button>
    </div>
  );

  if (typeof document === 'undefined') {
    return menuContent;
  }

  return createPortal(menuContent, document.body);
};

export default CalloutContextMenu;
