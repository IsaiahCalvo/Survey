import React from 'react';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';
import Icon from '../Icons';
import { useKeyPress } from '../utils/hooks';

/**
 * KeyboardShortcutsOverlay - Display keyboard shortcuts in an overlay
 * Press '?' to toggle
 */
const KeyboardShortcutsOverlay = () => {
  const [isOpen, setIsOpen] = React.useState(false);

  useKeyPress('?', () => {
    setIsOpen((prev) => !prev);
  });

  useKeyPress('Escape', () => {
    if (isOpen) {
      setIsOpen(false);
    }
  });

  if (!isOpen) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: '16px',
          right: '16px',
          padding: '8px 12px',
          background: COLORS.background.tertiary,
          border: `1px solid ${COLORS.border.default}`,
          borderRadius: BORDERS.radius.md,
          fontSize: TYPOGRAPHY.fontSize.sm,
          color: COLORS.text.muted,
          fontFamily: TYPOGRAPHY.fontFamily.default,
          cursor: 'pointer',
          zIndex: 1000,
          boxShadow: SHADOWS.md,
          transition: 'all 0.15s ease',
        }}
        onClick={() => setIsOpen(true)}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = COLORS.background.elevated;
          e.currentTarget.style.color = COLORS.text.tertiary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = COLORS.background.tertiary;
          e.currentTarget.style.color = COLORS.text.muted;
        }}
      >
        Press <kbd style={{
          padding: '2px 6px',
          background: COLORS.background.dark,
          borderRadius: BORDERS.radius.sm,
          fontWeight: TYPOGRAPHY.fontWeight.semibold
        }}>?</kbd> for keyboard shortcuts
      </div>
    );
  }

  const shortcuts = [
    { category: 'Navigation', items: [
      { keys: ['←', '→'], description: 'Previous/Next page' },
      { keys: ['Home'], description: 'First page' },
      { keys: ['End'], description: 'Last page' },
      { keys: ['Ctrl', '+'], description: 'Zoom in' },
      { keys: ['Ctrl', '-'], description: 'Zoom out' },
      { keys: ['Ctrl', '0'], description: 'Reset zoom' },
    ]},
    { category: 'Actions', items: [
      { keys: ['Ctrl', 'O'], description: 'Open document' },
      { keys: ['Ctrl', 'W'], description: 'Close tab' },
      { keys: ['Ctrl', 'Tab'], description: 'Next tab' },
      { keys: ['Ctrl', 'Shift', 'Tab'], description: 'Previous tab' },
      { keys: ['Ctrl', 'F'], description: 'Search text' },
    ]},
    { category: 'Interface', items: [
      { keys: ['?'], description: 'Toggle shortcuts' },
      { keys: ['Esc'], description: 'Close dialogs/cancel' },
      { keys: ['B'], description: 'Toggle sidebar' },
    ]},
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: COLORS.background.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
        backdropFilter: 'blur(2px)',
      }}
      onClick={() => setIsOpen(false)}
    >
      <div
        style={{
          background: COLORS.background.secondary,
          borderRadius: BORDERS.radius.xl,
          padding: '32px',
          maxWidth: '700px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: SHADOWS.xl,
          border: `1px solid ${COLORS.border.default}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '24px',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: TYPOGRAPHY.fontSize['2xl'],
              fontWeight: TYPOGRAPHY.fontWeight.semibold,
              color: COLORS.text.secondary,
              fontFamily: TYPOGRAPHY.fontFamily.default,
            }}
          >
            Keyboard Shortcuts
          </h2>
          <button
            onClick={() => setIsOpen(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: COLORS.text.muted,
              cursor: 'pointer',
              padding: '4px',
              borderRadius: BORDERS.radius.sm,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.background.elevated;
              e.currentTarget.style.color = COLORS.text.tertiary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = COLORS.text.muted;
            }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Shortcuts List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {shortcuts.map((section, idx) => (
            <div key={idx}>
              <h3
                style={{
                  margin: '0 0 16px 0',
                  fontSize: TYPOGRAPHY.fontSize.lg,
                  fontWeight: TYPOGRAPHY.fontWeight.semibold,
                  color: COLORS.text.tertiary,
                  fontFamily: TYPOGRAPHY.fontFamily.default,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontSize: TYPOGRAPHY.fontSize.sm,
                }}
              >
                {section.category}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {section.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px',
                      background: COLORS.background.tertiary,
                      borderRadius: BORDERS.radius.md,
                      border: `1px solid ${COLORS.border.default}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: TYPOGRAPHY.fontSize.md,
                        color: COLORS.text.tertiary,
                        fontFamily: TYPOGRAPHY.fontFamily.default,
                      }}
                    >
                      {item.description}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {item.keys.map((key, keyIdx) => (
                        <React.Fragment key={keyIdx}>
                          {keyIdx > 0 && (
                            <span
                              style={{
                                color: COLORS.text.disabled,
                                fontSize: TYPOGRAPHY.fontSize.sm,
                                margin: '0 2px',
                              }}
                            >
                              +
                            </span>
                          )}
                          <kbd
                            style={{
                              padding: '4px 8px',
                              background: COLORS.background.dark,
                              border: `1px solid ${COLORS.border.default}`,
                              borderRadius: BORDERS.radius.sm,
                              fontSize: TYPOGRAPHY.fontSize.base,
                              fontWeight: TYPOGRAPHY.fontWeight.semibold,
                              color: COLORS.text.secondary,
                              fontFamily: TYPOGRAPHY.fontFamily.mono,
                              minWidth: '32px',
                              textAlign: 'center',
                            }}
                          >
                            {key}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsOverlay;
