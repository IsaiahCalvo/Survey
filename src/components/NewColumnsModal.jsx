/**
 * NewColumnsModal.jsx — modal shown when an imported Excel file's columns differ from the saved template.
 *
 * Default-exports the NewColumnsModal component. Summarizes added/removed/reordered
 * columns per category and asks the user to either create a new template (with name
 * validation against existingTemplateNames) or modify the current one. Modification is
 * blocked when getOtherSurveysUsingTemplate reports other surveys depend on the template;
 * calls onConfirm(option, newTemplateName) or onClose (Skip Import).
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';
import { getOtherSurveysUsingTemplate } from '../hooks/useDatabase';
import { showToast } from '../utils/toast';

const NewColumnsModal = ({
  isOpen,
  onClose,
  onConfirm,
  newColumnsByCategory = {}, // { categoryId: { displayName, columns, excelColumnOrder, removedColumns, hasReordering } }
  templateName = '',
  existingTemplateNames = [], // Array of existing template names for duplicate validation
  templateId = null, // Current template's Supabase ID for checking usage
  currentSurveyId = null // Current survey/document ID to exclude from usage check
}) => {
  const [selectedOption, setSelectedOption] = useState(null); // 'newTemplate' | 'modifyTemplate'
  const [newTemplateName, setNewTemplateName] = useState('');
  const [nameError, setNameError] = useState('');
  const [otherSurveys, setOtherSurveys] = useState([]);
  const [isCheckingUsage, setIsCheckingUsage] = useState(false);
  const dialogRef = useRef(null);

  // Accessibility: the shared focus trap keeps Tab inside the dialog, closes
  // it on Escape, and returns focus to whatever opened it.
  useFocusTrap(dialogRef, isOpen, { onEscape: onClose });

  // Calculate totals for different change types
  const changeSummary = useMemo(() => {
    let totalNew = 0;
    let totalRemoved = 0;
    let hasReordering = false;

    Object.values(newColumnsByCategory).forEach(cat => {
      totalNew += cat.columns?.length || 0;
      totalRemoved += cat.removedColumns?.length || 0;
      if (cat.hasReordering) hasReordering = true;
    });

    return { totalNew, totalRemoved, hasReordering };
  }, [newColumnsByCategory]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedOption(null);
      setNewTemplateName(`${templateName} (Updated)`);
      setNameError('');
      setOtherSurveys([]);

      // Check if other surveys are using this template
      if (templateId) {
        checkTemplateUsage();
      }
    }
  }, [isOpen, templateName, templateId]);

  // Check template usage
  const checkTemplateUsage = async () => {
    if (!templateId) return;

    setIsCheckingUsage(true);
    try {
      const surveys = await getOtherSurveysUsingTemplate(templateId, currentSurveyId);
      setOtherSurveys(surveys);
    } catch (err) {
      console.error('Error checking template usage:', err);
      setOtherSurveys([]);
    } finally {
      setIsCheckingUsage(false);
    }
  };

  // Whether the template can be modified (no other surveys using it)
  const canModifyTemplate = otherSurveys.length === 0;

  // Check for duplicate name whenever template name changes
  const isDuplicateName = (name) => {
    const trimmedName = name.trim().toLowerCase();
    return existingTemplateNames.some(
      existingName => existingName.toLowerCase() === trimmedName
    );
  };

  // Handle template name change with validation
  const handleTemplateNameChange = (e) => {
    const value = e.target.value;
    setNewTemplateName(value);

    if (value.trim() && isDuplicateName(value)) {
      setNameError('A template with this name already exists. Please choose a different name.');
    } else {
      setNameError('');
    }
  };

  if (!isOpen) return null;

  const { totalNew, totalRemoved, hasReordering } = changeSummary;

  // Build dynamic title based on change types
  const getModalTitle = () => {
    const parts = [];
    if (totalNew > 0) parts.push('new columns');
    if (totalRemoved > 0) parts.push('removed columns');
    if (hasReordering) parts.push('reordering');
    if (parts.length === 0) return 'Column changes detected';
    const sentence = `${parts.join(', ')} detected`;
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  };

  // Build dynamic description
  const getModalDescription = () => {
    const parts = [];
    if (totalNew > 0) {
      parts.push(`${totalNew} new column${totalNew !== 1 ? 's' : ''} added`);
    }
    if (totalRemoved > 0) {
      parts.push(`${totalRemoved} column${totalRemoved !== 1 ? 's' : ''} removed`);
    }
    if (hasReordering) {
      parts.push('column order changed');
    }
    return parts.length > 0
      ? `Found ${parts.join(', ')} in the Excel file compared to the template.`
      : 'Changes detected in Excel file.';
  };

  const handleConfirm = () => {
    if (!selectedOption) {
      showToast('Please select an option.', 'warn');
      return;
    }
    if (selectedOption === 'newTemplate') {
      if (!newTemplateName.trim()) {
        showToast('Please enter a name for the new template.', 'warn');
        return;
      }
      if (isDuplicateName(newTemplateName)) {
        setNameError('A template with this name already exists. Please choose a different name.');
        return;
      }
    }
    // Pass both the decision and the template name
    onConfirm(selectedOption, newTemplateName.trim());
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
        background: COLORS.modal.overlay,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={handleSkip}
    >
      <div
        style={{
          background: COLORS.modal.surface,
          borderRadius: BORDERS.radius.dialog,
          padding: '24px',
          maxWidth: '500px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
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
            {getModalTitle()}
          </h3>
          <p style={{
            margin: 0,
            fontSize: TYPOGRAPHY.fontSize.md,
            color: COLORS.text.muted,
            fontFamily: TYPOGRAPHY.fontFamily.default,
            lineHeight: TYPOGRAPHY.lineHeight.normal,
          }}>
            {getModalDescription()}
          </p>
        </div>

        {/* List of column changes by category */}
        <div style={{
          background: COLORS.background.tertiary,
          borderRadius: BORDERS.radius.md,
          padding: '12px',
          marginBottom: '16px',
          maxHeight: '250px',
          overflowY: 'auto'
        }}>
          {Object.entries(newColumnsByCategory).map(([categoryId, { displayName, columns, removedColumns, hasReordering }]) => (
            <div key={categoryId} style={{ marginBottom: '16px' }}>
              <div style={{
                fontSize: TYPOGRAPHY.fontSize.sm,
                fontWeight: TYPOGRAPHY.fontWeight.semibold,
                color: COLORS.text.muted,
                marginBottom: '8px',
                fontFamily: TYPOGRAPHY.fontFamily.default,
              }}>
                {displayName}
              </div>

              {/* New columns */}
              {columns && columns.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{
                    fontSize: TYPOGRAPHY.fontSize.xs,
                    fontWeight: TYPOGRAPHY.fontWeight.medium,
                    color: 'var(--accent)',
                    marginBottom: '4px',
                    fontFamily: TYPOGRAPHY.fontFamily.default,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    + Added
                  </div>
                  {columns.map((col, idx) => (
                    <div key={`new-${idx}`} style={{
                      fontSize: TYPOGRAPHY.fontSize.md,
                      color: COLORS.text.secondary,
                      padding: '4px 8px',
                      background: 'rgba(34, 197, 94, 0.1)',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      borderRadius: BORDERS.radius.sm,
                      marginBottom: '4px',
                      fontFamily: TYPOGRAPHY.fontFamily.default,
                    }}>
                      {col.text}
                    </div>
                  ))}
                </div>
              )}

              {/* Removed columns */}
              {removedColumns && removedColumns.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{
                    fontSize: TYPOGRAPHY.fontSize.xs,
                    fontWeight: TYPOGRAPHY.fontWeight.medium,
                    color: 'var(--danger-text)',
                    marginBottom: '4px',
                    fontFamily: TYPOGRAPHY.fontFamily.default,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    - Removed
                  </div>
                  {removedColumns.map((col, idx) => (
                    <div key={`removed-${idx}`} style={{
                      fontSize: TYPOGRAPHY.fontSize.md,
                      color: COLORS.text.muted,
                      padding: '4px 8px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: BORDERS.radius.sm,
                      marginBottom: '4px',
                      fontFamily: TYPOGRAPHY.fontFamily.default,
                      textDecoration: 'line-through',
                    }}>
                      {col.text}
                    </div>
                  ))}
                </div>
              )}

              {/* Reordering indicator */}
              {hasReordering && (
                <div style={{
                  fontSize: TYPOGRAPHY.fontSize.sm,
                  color: 'var(--warning)',
                  padding: '6px 8px',
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: BORDERS.radius.sm,
                  fontFamily: TYPOGRAPHY.fontFamily.default,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}>
                  <span style={{ fontSize: '14px' }}>↕</span>
                  Column order will be updated to match Excel
                </div>
              )}
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
            onMouseEnter={(e) => {
              if (selectedOption !== 'newTemplate') {
                e.currentTarget.style.background = COLORS.modal.panelHover;
                e.currentTarget.style.borderColor = COLORS.modal.borderActive;
              }
            }}
            onMouseLeave={(e) => {
              if (selectedOption !== 'newTemplate') {
                e.currentTarget.style.background = COLORS.background.tertiary;
                e.currentTarget.style.borderColor = COLORS.border.default;
              }
            }}
            style={{
              padding: '12px',
              background: selectedOption === 'newTemplate' ? COLORS.modal.optionSelectedBg : COLORS.background.tertiary,
              border: `2px solid ${selectedOption === 'newTemplate' ? COLORS.modal.optionSelectedBorder : COLORS.border.default}`,
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
              Create new template
            </div>
            <div style={{
              fontSize: TYPOGRAPHY.fontSize.sm,
              color: COLORS.text.muted,
              fontFamily: TYPOGRAPHY.fontFamily.default,
              marginBottom: selectedOption === 'newTemplate' ? '12px' : '0',
            }}>
              Creates a new template with the added checklist items. Original template remains unchanged.
            </div>

            {/* Template name input - only shown when this option is selected */}
            {selectedOption === 'newTemplate' && (
              <div style={{ marginTop: '8px' }} onClick={(e) => e.stopPropagation()}>
                <div style={{
                  fontSize: TYPOGRAPHY.fontSize.sm,
                  fontWeight: TYPOGRAPHY.fontWeight.medium,
                  color: COLORS.text.muted,
                  marginBottom: '4px',
                  fontFamily: TYPOGRAPHY.fontFamily.default,
                }}>
                  New template name
                </div>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={handleTemplateNameChange}
                  placeholder="Enter template name..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: BORDERS.radius.md,
                    border: `1px solid ${nameError ? 'var(--danger)' : COLORS.border.default}`,
                    background: COLORS.background.dark,
                    color: COLORS.text.secondary,
                    fontSize: TYPOGRAPHY.fontSize.md,
                    fontFamily: TYPOGRAPHY.fontFamily.default,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  autoFocus
                />
                {nameError && (
                  <div style={{
                    marginTop: '6px',
                    fontSize: TYPOGRAPHY.fontSize.sm,
                    color: 'var(--danger-text)',
                    fontFamily: TYPOGRAPHY.fontFamily.default,
                  }}>
                    {nameError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Option B: Modify this template */}
          <div
            onClick={() => canModifyTemplate && setSelectedOption('modifyTemplate')}
            onMouseEnter={(e) => {
              if (canModifyTemplate && selectedOption !== 'modifyTemplate') {
                e.currentTarget.style.background = COLORS.modal.panelHover;
                e.currentTarget.style.borderColor = COLORS.modal.borderActive;
              }
            }}
            onMouseLeave={(e) => {
              if (canModifyTemplate && selectedOption !== 'modifyTemplate') {
                e.currentTarget.style.background = COLORS.background.tertiary;
                e.currentTarget.style.borderColor = COLORS.border.default;
              }
            }}
            style={{
              padding: '12px',
              background: selectedOption === 'modifyTemplate' ? COLORS.modal.optionSelectedBg : COLORS.background.tertiary,
              border: `2px solid ${selectedOption === 'modifyTemplate' ? COLORS.modal.optionSelectedBorder : COLORS.border.default}`,
              borderRadius: BORDERS.radius.md,
              cursor: canModifyTemplate ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s ease',
              opacity: canModifyTemplate ? 1 : 0.6,
            }}
          >
            <div style={{
              fontSize: TYPOGRAPHY.fontSize.md,
              fontWeight: TYPOGRAPHY.fontWeight.semibold,
              color: canModifyTemplate ? COLORS.text.secondary : COLORS.text.muted,
              marginBottom: '4px',
              fontFamily: TYPOGRAPHY.fontFamily.default,
            }}>
              Modify this template
            </div>
            <div style={{
              fontSize: TYPOGRAPHY.fontSize.sm,
              color: COLORS.text.muted,
              fontFamily: TYPOGRAPHY.fontFamily.default,
            }}>
              {canModifyTemplate
                ? 'Updates the current template with the new column structure.'
                : 'Cannot modify - this template is used by other surveys.'}
            </div>

            {/* Show warning when other surveys use this template */}
            {!canModifyTemplate && otherSurveys.length > 0 && (
              <div style={{
                marginTop: '10px',
                padding: '10px',
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: BORDERS.radius.sm,
              }}>
                <div style={{
                  fontSize: TYPOGRAPHY.fontSize.sm,
                  fontWeight: TYPOGRAPHY.fontWeight.medium,
                  color: 'var(--warning)',
                  marginBottom: '6px',
                  fontFamily: TYPOGRAPHY.fontFamily.default,
                }}>
                  Used by {otherSurveys.length} other survey{otherSurveys.length !== 1 ? 's' : ''}:
                </div>
                <div style={{
                  fontSize: TYPOGRAPHY.fontSize.sm,
                  color: COLORS.text.muted,
                  fontFamily: TYPOGRAPHY.fontFamily.default,
                  maxHeight: '60px',
                  overflowY: 'auto',
                }}>
                  {otherSurveys.slice(0, 5).map((survey, idx) => (
                    <div key={survey.id}>
                      {survey.name || `Survey ${idx + 1}`}
                    </div>
                  ))}
                  {otherSurveys.length > 5 && (
                    <div style={{ fontStyle: 'italic' }}>
                      ...and {otherSurveys.length - 5} more
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Show loading state */}
            {isCheckingUsage && (
              <div style={{
                marginTop: '8px',
                fontSize: TYPOGRAPHY.fontSize.sm,
                color: COLORS.text.muted,
                fontFamily: TYPOGRAPHY.fontFamily.default,
                fontStyle: 'italic',
              }}>
                Checking template usage...
              </div>
            )}
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
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.modal.secondaryButtonHover;
              e.currentTarget.style.borderColor = COLORS.modal.borderActive;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = COLORS.background.elevated;
              e.currentTarget.style.borderColor = COLORS.border.default;
            }}
          >
            Skip import
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedOption || (selectedOption === 'newTemplate' && (!newTemplateName.trim() || nameError))}
            style={{
              padding: '8px 16px',
              background: (selectedOption && (selectedOption !== 'newTemplate' || (newTemplateName.trim() && !nameError))) ? COLORS.modal.primaryButton : COLORS.modal.primaryButtonDisabled,
              color: COLORS.text.primary,
              border: `1px solid ${(selectedOption && (selectedOption !== 'newTemplate' || (newTemplateName.trim() && !nameError))) ? COLORS.modal.borderActive : COLORS.border.default}`,
              borderRadius: BORDERS.radius.md,
              fontSize: TYPOGRAPHY.fontSize.md,
              fontWeight: TYPOGRAPHY.fontWeight.medium,
              cursor: (selectedOption && (selectedOption !== 'newTemplate' || (newTemplateName.trim() && !nameError))) ? 'pointer' : 'not-allowed',
              fontFamily: TYPOGRAPHY.fontFamily.default,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!selectedOption || (selectedOption === 'newTemplate' && (!newTemplateName.trim() || nameError))) return;
              e.currentTarget.style.background = COLORS.modal.primaryButtonHover;
              e.currentTarget.style.boxShadow = COLORS.modal.hoverGlow;
            }}
            onMouseLeave={(e) => {
              if (!selectedOption || (selectedOption === 'newTemplate' && (!newTemplateName.trim() || nameError))) return;
              e.currentTarget.style.background = COLORS.modal.primaryButton;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            Continue import
          </button>
        </div>
      </div>
    </div>
  );
};

export default NewColumnsModal;
