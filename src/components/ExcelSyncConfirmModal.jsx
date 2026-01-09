import React, { useState } from 'react';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';

const ExcelSyncConfirmModal = ({
  isOpen,
  onClose,
  onConfirm, // (choice: 'no' | 'once' | 'always') => void
  fileName = 'Excel file'
}) => {
  const [selectedOption, setSelectedOption] = useState(null);

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
        background: COLORS.background.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: COLORS.background.quaternary,
          borderRadius: BORDERS.radius.xl,
          padding: '24px',
          maxWidth: '480px',
          width: '90%',
          boxShadow: SHADOWS.xl,
          border: `1px solid ${COLORS.border.subtle}`,
        }}
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
            Update Excel File?
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
              style={{
                padding: '12px',
                background: selectedOption === option.id ? COLORS.accent.primary + '20' : COLORS.background.tertiary,
                border: `2px solid ${selectedOption === option.id ? COLORS.accent.primary : COLORS.border.default}`,
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
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedOption}
            style={{
              padding: '8px 16px',
              background: selectedOption ? COLORS.accent.primary : COLORS.border.default,
              color: COLORS.text.primary,
              border: 'none',
              borderRadius: BORDERS.radius.md,
              fontSize: TYPOGRAPHY.fontSize.md,
              fontWeight: TYPOGRAPHY.fontWeight.medium,
              cursor: selectedOption ? 'pointer' : 'not-allowed',
              fontFamily: TYPOGRAPHY.fontFamily.default,
              transition: 'all 0.15s ease',
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
