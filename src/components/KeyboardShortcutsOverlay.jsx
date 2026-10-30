/**
 * KeyboardShortcutsOverlay.jsx — self-toggling keyboard-shortcuts reference modal.
 *
 * Default-exports the KeyboardShortcutsOverlay component: holds its own open
 * state. Opens on "?" or Cmd/Ctrl+/ (only when focus is not in a text field —
 * typing a question mark into a text box, the Survey panel or search must stay
 * a question mark), on the OPEN_SHORTCUTS_EVENT window event (the viewer's
 * left-rail keyboard button, the Home account menu), and on the desktop app's
 * Help > Keyboard Shortcuts menu item. Escape, the X, the backdrop, "?" again
 * or Cmd/Ctrl+/ again close it. The rows come from src/utils/keyboardShortcuts.js,
 * which a test keeps in step with the real key handlers. Stops wheel/touch
 * events from reaching the PDF handler so the list scrolls natively. Renders
 * null when closed (after a 120 ms exit through MotionPresence).
 */
import React from 'react';
import { assignShortcut, canAssignShortcut, eventChord, installShortcutRemapping, resetShortcut, shortcutBinding } from '../utils/customKeyboardShortcuts.js';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';
import Icon from '../Icons';
import { useFocusTrap } from '../hooks/useFocusTrap';
import MotionPresence from './MotionPresence.jsx';
import { isTypingTarget } from '../utils/typingTarget.js';
import {
  OPEN_SHORTCUTS_EVENT,
  chordKeycaps,
  isShortcutsSheetKey,
  shortcutSectionsFor,
} from '../utils/keyboardShortcuts';

const KeyboardShortcutsOverlay = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [editingChord, setEditingChord] = React.useState(null);
  const [bindingTick, setBindingTick] = React.useState(0);
  const [bindingError, setBindingError] = React.useState('');
  React.useEffect(() => installShortcutRemapping(), []);
  const modalContentRef = React.useRef(null);
  const isOpenRef = React.useRef(isOpen);
  isOpenRef.current = isOpen;

  // KAL-444: the sheet is mounted on Home AND in the viewer, so its key needs
  // the same "not while typing" guard the arrow-key nudge and the other
  // single-key shortcuts obey (isTypingTarget: inputs, text areas,
  // contentEditable editors, Fabric's hidden textarea, and menus and other
  // widgets that own their keys). Once the sheet is open the key always closes
  // it, even though focus is inside it.
  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (editingChord) return;
      if (!isShortcutsSheetKey(event)) return;
      if (!isOpenRef.current && isTypingTarget(document.activeElement)) return;
      event.preventDefault();
      if (event.repeat) return;
      setIsOpen((prev) => !prev);
    };
    const open = () => setIsOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, open);
    // Desktop app: Help > Keyboard Shortcuts.
    const unsubscribeMenu = typeof window.electronAPI?.onKeyboardShortcutsMenu === 'function'
      ? window.electronAPI.onKeyboardShortcutsMenu(open)
      : null;
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, open);
      if (typeof unsubscribeMenu === 'function') unsubscribeMenu();
    };
  }, [editingChord]);

  // Accessibility: Tab stays inside the overlay, Escape closes it (this replaces
  // the old useKeyPress('Escape') — the trap listens in the capture phase so it
  // has to own Escape), and focus returns to whatever was focused before '?'.
  const closeOverlay = React.useCallback(() => setIsOpen(false), []);
  useFocusTrap(modalContentRef, isOpen, { avoidTextFields: true, onEscape: () => { if (editingChord) document.activeElement?.blur(); else closeOverlay(); } });

  // No floating hint pill — the overlay stays reachable via the '?' key, but
  // the bottom-right "Press ? for keyboard shortcuts" prompt is not shown.
  // Closed: MotionPresence plays the sheet's exit (motion.css), then nothing.
  if (!isOpen) {
    return <MotionPresence open={false} />;
  }

  const isMac = typeof navigator !== 'undefined' && /(Mac|iPhone|iPod|iPad)/i.test(`${navigator.platform || ''} ${navigator.userAgent || ''}`);
  // Keys only the desktop app's menu provides (Open, Export) are left off the
  // web sheet, where the browser keeps those keys for itself.
  const isDesktopApp = typeof window !== 'undefined' && Boolean(window.electronAPI);
  const shortcuts = shortcutSectionsFor({ isDesktopApp }).map((section) => ({
    category: section.title,
    items: section.items.map((item) => ({
      chords: item.chords,
      keyGroups: item.chords.map((chord) => chordKeycaps(shortcutBinding(chord), { isMac })),
      description: item.label,
    })),
  }));

  return (
    <MotionPresence open>
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
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        style={{
          background: COLORS.background.secondary,
          borderRadius: BORDERS.radius.dialog,
          padding: '24px',
          width: 'min(620px, calc(100vw - 32px))',
          boxSizing: 'border-box',
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
            type="button"
            aria-label="Close keyboard shortcuts"
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
        {/* KAL-444: the list grew from 6 honest-ish rows to every key the app
            answers to, so rows are compact enough to scan instead of scroll. */}
        <p style={{ color: COLORS.text.muted, margin: '0 0 16px', fontSize: '13px' }}>Click a key field, then press your new shortcut.</p>
        {bindingError && <p role="alert" style={{ color: 'var(--danger)' }}>{bindingError}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {shortcuts.map((section, idx) => (
            <div key={idx}>
              <h3
                style={{
                  margin: '0 0 10px 0',
                  fontWeight: TYPOGRAPHY.fontWeight.semibold,
                  color: COLORS.text.tertiary,
                  fontFamily: TYPOGRAPHY.fontFamily.default,
                  fontSize: TYPOGRAPHY.fontSize.sm,
                }}
              >
                {section.category}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {section.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '8px 12px',
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
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {item.keyGroups.map((keys, groupIdx) => (
                        <React.Fragment key={groupIdx}>
                          {canAssignShortcut(item.chords[groupIdx]) ? (
                            <input
                              aria-label={`Shortcut for ${item.description}`}
                              readOnly
                              value={editingChord === item.chords[groupIdx] ? 'Press keys…' : item.keyGroups[groupIdx].join(' + ')}
                              onFocus={() => { setEditingChord(item.chords[groupIdx]); setBindingError(''); }}
                              onBlur={() => setEditingChord(null)}
                              onKeyDown={(event) => {
                                event.preventDefault(); event.stopPropagation();
                                if (event.key === 'Escape') { event.currentTarget.blur(); return; }
                                const chord = eventChord(event);
                                if (!chord) return;
                                const error = assignShortcut(item.chords[groupIdx], chord);
                                setBindingError(error || '');
                                if (!error) { setBindingTick(bindingTick + 1); event.currentTarget.blur(); }
                              }}
                              style={{ width: '132px', border: '1px solid var(--border-1)', borderRadius: '6px', background: 'var(--surface-1)', color: 'var(--text-1)', padding: '7px', textAlign: 'center', cursor: 'pointer', fontSize: '12px' }}
                            />
                          ) : keys.map((key, keyIdx) => <kbd key={keyIdx} style={{ padding: '2px 7px', color: COLORS.text.secondary }}>{key}</kbd>)}
                          {shortcutBinding(item.chords[groupIdx]) !== item.chords[groupIdx] && <button type="button" aria-label={`Reset shortcut for ${item.description}`} onClick={() => { setBindingError(resetShortcut(item.chords[groupIdx]) || ''); setBindingTick(bindingTick + 1); }}>Reset</button>}
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
    </MotionPresence>
  );
};

export default KeyboardShortcutsOverlay;
