import React, { useState, useEffect } from 'react';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';

const NewColumnsModal = ({
  isOpen,
  onClose,
  onConfirm,
  newColumnsByCategory = {}, // { categoryId: { displayName, columns: [{ columnIndex, text }] } }
  templateName = ''
}) => {
  const [selectedOption, setSelectedOption] = useState(null); // 'newTemplate' | 'surveyOnly'

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedOption(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const totalNewColumns = Object.values(newColumnsByCategory)
    .reduce((sum, cat) => sum + (cat.columns?.length || 0), 0);

  const handleConfirm = () => {
    if (!selectedOption) {
      alert('Please select an option.');
      return;
    }
    onConfirm(selectedOption);
  };

  const handleSkip = () => {
    onClose();
  };

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
      onClick={handleSkip}
    >
      <div
        style={{
          background: COLORS.background.quaternary,
          borderRadius: BORDERS.radius.xl,
          padding: '24px',
          maxWidth: '500px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
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
            New Columns Detected
          </h3>
          <p style={{
            margin: 0,
            fontSize: TYPOGRAPHY.fontSize.md,
            color: COLORS.text.muted,
            fontFamily: TYPOGRAPHY.fontFamily.default,
            lineHeight: TYPOGRAPHY.lineHeight.normal,
          }}>
            Found {totalNewColumns} new column{totalNewColumns !== 1 ? 's' : ''} in the Excel file that {totalNewColumns !== 1 ? "don't" : "doesn't"} match existing checklist items.
          </p>
        </div>

        {/* List of new columns by category */}
        <div style={{
          background: COLORS.background.tertiary,
          borderRadius: BORDERS.radius.md,
          padding: '12px',
          marginBottom: '16px',
          maxHeight: '200px',
          overflowY: 'auto'
        }}>
          {Object.entries(newColumnsByCategory).map(([categoryId, { displayName, columns }]) => (
            <div key={categoryId} style={{ marginBottom: '12px' }}>
              <div style={{
                fontSize: TYPOGRAPHY.fontSize.sm,
                fontWeight: TYPOGRAPHY.fontWeight.semibold,
                color: COLORS.text.muted,
                marginBottom: '6px',
                fontFamily: TYPOGRAPHY.fontFamily.default,
              }}>
                {displayName}
              </div>
              {columns.map((col, idx) => (
                <div key={idx} style={{
                  fontSize: TYPOGRAPHY.fontSize.md,
                  color: COLORS.text.secondary,
                  padding: '4px 8px',
                  background: COLORS.background.elevated,
                  borderRadius: BORDERS.radius.sm,
                  marginBottom: '4px',
                  fontFamily: TYPOGRAPHY.fontFamily.default,
                }}>
                  {col.text}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Option selection */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{
            fontSize: TYPOGRAPHY.fontSize.sm,
            fontWeight: TYPOGRAPHY.fontWeight.medium,
            color: COLORS.text.muted,
            marginBottom: '8px',
            fontFamily: TYPOGRAPHY.fontFamily.default,
          }}>
            How would you like to handle these new columns?
          </div>

          {/* Option A: Create new template */}
          <div
            onClick={() => setSelectedOption('newTemplate')}
            style={{
              padding: '12px',
              background: selectedOption === 'newTemplate' ? COLORS.accent.primary + '20' : COLORS.background.tertiary,
              border: `2px solid ${selectedOption === 'newTemplate' ? COLORS.accent.primary : COLORS.border.default}`,
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
              Create New Template
            </div>
            <div style={{
              fontSize: TYPOGRAPHY.fontSize.sm,
              color: COLORS.text.muted,
              fontFamily: TYPOGRAPHY.fontFamily.default,
            }}>
              Creates a new template "{templateName} (Updated)" with the added checklist items. Original template remains unchanged.
            </div>
          </div>

          {/* Option B: Add for survey only */}
          <div
            onClick={() => setSelectedOption('surveyOnly')}
            style={{
              padding: '12px',
              background: selectedOption === 'surveyOnly' ? COLORS.accent.primary + '20' : COLORS.background.tertiary,
              border: `2px solid ${selectedOption === 'surveyOnly' ? COLORS.accent.primary : COLORS.border.default}`,
              borderRadius: BORDERS.radius.md,
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
              Add for This Survey Only
            </div>
            <div style={{
              fontSize: TYPOGRAPHY.fontSize.sm,
              color: COLORS.text.muted,
              fontFamily: TYPOGRAPHY.fontFamily.default,
            }}>
              Adds checklist items only to the current survey. Template remains unchanged.
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={handleSkip}
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
            Skip Import
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
            Continue Import
          </button>
        </div>
      </div>
    </div>
  );
};

export default NewColumnsModal;
