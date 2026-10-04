/**
 * KeyboardShortcutsOverlay.jsx — self-toggling keyboard-shortcuts reference modal.
 *
 * Default-exports the KeyboardShortcutsOverlay component: holds its own open state,
 * toggled by '?' and closed by Escape (via useKeyPress). When open, renders an
 * overlay listing shortcuts grouped by Navigation/Actions/Interface, with the Find
 * modifier shown as ⌘ on Mac and Ctrl elsewhere. Stops wheel/touch events from
 * reaching the PDF handler so the list scrolls natively. Renders null when closed.
 */
import React from 'react';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';
import Icon from '../Icons';
import { useKeyPress } from '../utils/hooks';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { TOOL_SHORTCUTS } from '../utils/toolShortcuts';

/**
 * KeyboardShortcutsOverlay - Display keyboard shortcuts in an overlay
 * Press '?' to toggle
 */
const KeyboardShortcutsOverlay = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const modalContentRef = React.useRef(null);

  useKeyPress('?', () => {
    setIsOpen((prev) => !prev);
  });

  // Accessibility: Tab stays inside the overlay, Escape closes it (this replaces
  // the old useKeyPress('Escape') — the trap listens in the capture phase so it
  // has to own Escape), and focus returns to whatever was focused before '?'.
  const closeOverlay = React.useCallback(() => setIsOpen(false), []);
  useFocusTrap(modalContentRef, isOpen, { onEscape: closeOverlay });

  // No floating hint pill — the overlay stays reachable via the '?' key, but
  // the bottom-right "Press ? for keyboard shortcuts" prompt is not shown.
  if (!isOpen) {
    return null;
  }

  const isMac = typeof navigator !== 'undefined' && /(Mac|iPhone|iPod|iPad)/i.test(`${navigator.platform || ''} ${navigator.userAgent || ''}`);
  const findShortcutModifier = isMac ? '⌘' : 'Ctrl';

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
      { keys: [findShortcutModifier, 'F'], description: 'Search text' },
    ]},
    // KAL-239: the tool keys were never listed here, so text selection (Shift+V)
    // would have been undiscoverable from the keyboard. Intended UX: every
    // single-key tool shortcut the viewer listens for is documented in one place,
    // with the two Select modes shown together so the pairing is obvious.
    // UX 2026-09-16: this list is GENERATED from src/utils/toolShortcuts.js —
    // the same map the keyboard handler obeys and the tool tooltips print. A
    // hand-copied list drifts the first time a tool is added, and a help sheet
    // that lies is worse than no help sheet. Every letter's reasoning lives at
    // its entry in that module.
    { category: 'Tools', items: TOOL_SHORTCUTS.map((shortcut) => ({
      keys: shortcut.badge.split('+'),
      description: shortcut.label,
    })) },
    // UX: these keys only act while a polygon or polyline is being placed —
    // documented separately so they read as part of that flow, not as global
    // shortcuts.
    { category: 'Polygon & Polyline', items: [
      { keys: ['Click'], description: 'Place the next point' },
      { keys: ['Shift'], description: 'Constrain the next segment to 45°' },
      { keys: ['Enter'], description: 'Finish the shape' },
      { keys: ['Esc'], description: 'Discard the unfinished shape' },
    ]},
    // UX: these keys act during a lasso, so list them by result instead of
    // hiding them under the main tool shortcut.
    { category: 'Lasso Select', items: [
      { keys: ['Space'], description: 'Cycle Window, Crossing, and Fence' },
      { keys: ['Shift'], description: 'Add hits to the selection' },
      { keys: ['Alt'], description: 'Remove hits from the selection' },
    ]},
    { category: 'Interface', items: [
      { keys: ['?'], description: 'Toggle shortcuts' },
      { keys: ['Esc'], description: 'Close dialogs/cancel' },
      // Polish round 6: "B  Toggle sidebar" was listed here, but no key
      // handler for B exists anywhere in the app (the walkthrough pressed it:
      // nothing). The sheet only lists keys that work.
    ]},
  ];

  return (
    <div
      data-keyboard-shortcuts-modal="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: COLORS.background.overlay,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
      onClick={() => setIsOpen(false)}
    >
      <div
        ref={modalContentRef}
        style={{
          background: COLORS.background.secondary,
          borderRadius: BORDERS.radius.dialog,
          padding: '32px',
          maxWidth: '700px',
          width: '420px',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: SHADOWS.xl,
          border: `1px solid ${COLORS.border.default}`,
          scrollBehavior: 'smooth',
          WebkitOverflowScrolling: 'touch',
        }}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => {
          // Stop event from bubbling to PDF handler, but allow native smooth scrolling
          e.stopPropagation();
          // Don't preventDefault - let native browser scrolling work smoothly
          // The PDF handler already checks for modal and returns early, so this is safe
        }}
        onTouchMove={(e) => e.stopPropagation()}
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
            Keyboard shortcuts
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
