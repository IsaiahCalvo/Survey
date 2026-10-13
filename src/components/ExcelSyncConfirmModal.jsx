/**
 * ExcelSyncConfirmModal.jsx — asks whether a save should also update linked Excel.
 *
 * Default-exports the ExcelSyncConfirmModal component: presents three selectable
 * options — 'no' (save in Survey only), 'once' (update Excel this time), 'always'
 * (update and remember) — and calls onConfirm(choice) with the picked id. Continue
 * is disabled until an option is selected. Renders null unless isOpen. Part of the
 * Excel two-way sync flow.
 */
import { useRef, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';

const ExcelSyncConfirmModal = ({
  isOpen,
  onClose,
  onConfirm, // (choice: 'no' | 'once' | 'always') => void
  fileName = 'Excel file'
}) => {
  const [selectedOption, setSelectedOption] = useState(null);
  const dialogRef = useRef(null);

  // Accessibility: the shared focus trap keeps Tab inside the dialog, closes
  // it on Escape, and returns focus to whatever opened it.
  useFocusTrap(dialogRef, isOpen, { onEscape: onClose });

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!selectedOption) {
      return;
    }
    onConfirm(selectedOption);
  };

  const options = [
    {
      id: 'no',
      title: 'No, just save within Survey',
      description: 'Save changes only in the Survey app. Excel file will not be updated.',
    },
    {
      id: 'once',
      title: 'Yes, but just this one time',
      description: 'Update the Excel file now. You will be asked again next time.',
    },
    {
      id: 'always',
      title: 'Yes, and remember my answer',
      description: 'Always update the Excel file when saving. You can change this later in settings.',
    },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: COLORS.modal.overlay,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: COLORS.modal.surface,
          borderRadius: BORDERS.radius.dialog,
          padding: '24px',
          maxWidth: '480px',
          width: '90%',
          boxShadow: SHADOWS.xl,
          border: `1px solid ${COLORS.modal.border}`,
        }}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{
            margin: 0,
            fontSize: TYPOGRAPHY.fontSize['2xl'],
            fontWeight: TYPOGRAPHY.fontWeight.semibold,
            color: COLORS.text.secondary,
            fontFamily: TYPOGRAPHY.fontFamily.default,
            marginBottom: '8px',
          }}>
            Update Excel file?
          </h3>
          <p style={{
            margin: 0,
            fontSize: TYPOGRAPHY.fontSize.md,
            color: COLORS.text.muted,
            fontFamily: TYPOGRAPHY.fontFamily.default,
            lineHeight: TYPOGRAPHY.lineHeight.normal,
          }}>
            Would you like Survey data to update the linked Excel file?
          </p>
        </div>

        {/* Options */}
        <div style={{ marginBottom: '24px' }}>
          {options.map((option) => (
            <div
              key={option.id}
              onClick={() => setSelectedOption(option.id)}
              onMouseEnter={(e) => {
                if (selectedOption !== option.id) {
                  e.currentTarget.style.background = COLORS.modal.panelHover;
                  e.currentTarget.style.borderColor = COLORS.modal.borderActive;
                }
              }}
              onMouseLeave={(e) => {
                if (selectedOption !== option.id) {
                  e.currentTarget.style.background = COLORS.background.tertiary;
                  e.currentTarget.style.borderColor = COLORS.border.default;
                }
              }}
              style={{
                padding: '12px',
                background: selectedOption === option.id ? COLORS.modal.optionSelectedBg : COLORS.background.tertiary,
                border: `2px solid ${selectedOption === option.id ? COLORS.modal.optionSelectedBorder : COLORS.border.default}`,
                borderRadius: BORDERS.radius.md,
                marginBottom: '8px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{
                fontSize: TYPOGRAPHY.fontSize.md,
                fontWeight: TYPOGRAPHY.fontWeight.semibold,
                color: COLORS.text.secondary,
                marginBottom: '4px',
                fontFamily: TYPOGRAPHY.fontFamily.default,
              }}>
                {option.title}
              </div>
              <div style={{
                fontSize: TYPOGRAPHY.fontSize.sm,
                color: COLORS.text.muted,
                fontFamily: TYPOGRAPHY.fontFamily.default,
              }}>
                {option.description}
              </div>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              background: COLORS.background.elevated,
              color: COLORS.text.tertiary,
              border: `1px solid ${COLORS.border.default}`,
              borderRadius: BORDERS.radius.md,
              fontSize: TYPOGRAPHY.fontSize.md,
              fontWeight: TYPOGRAPHY.fontWeight.medium,
              cursor: 'pointer',
              fontFamily: TYPOGRAPHY.fontFamily.default,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.modal.secondaryButtonHover;
              e.currentTarget.style.borderColor = COLORS.modal.borderActive;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = COLORS.background.elevated;
              e.currentTarget.style.borderColor = COLORS.border.default;
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedOption}
            style={{
              padding: '8px 16px',
              background: selectedOption ? COLORS.modal.primaryButton : COLORS.modal.primaryButtonDisabled,
              color: COLORS.text.primary,
              border: `1px solid ${selectedOption ? COLORS.modal.borderActive : COLORS.border.default}`,
              borderRadius: BORDERS.radius.md,
              fontSize: TYPOGRAPHY.fontSize.md,
              fontWeight: TYPOGRAPHY.fontWeight.medium,
              cursor: selectedOption ? 'pointer' : 'not-allowed',
              fontFamily: TYPOGRAPHY.fontFamily.default,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!selectedOption) return;
              e.currentTarget.style.background = COLORS.modal.primaryButtonHover;
              e.currentTarget.style.boxShadow = COLORS.modal.hoverGlow;
            }}
            onMouseLeave={(e) => {
              if (!selectedOption) return;
              e.currentTarget.style.background = COLORS.modal.primaryButton;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExcelSyncConfirmModal;
