/**
 * CreateCategoryModal.jsx — modal opened by the survey rail's create-category
 * plus button (desktop "Categories" heading row).
 *
 * Default-exports the CreateCategoryModal component. Asks for a category name
 * (required, trimmed, duplicate-checked against the selected module's existing
 * categories), then offers the same two-option template decision as
 * NewColumnsModal: modify the current template (blocked when
 * getOtherSurveysUsingTemplate reports other surveys depend on it) or save the
 * result as a new template (name validated against existingTemplateNames).
 * Calls onConfirm(option, { categoryName, newTemplateName }) or onClose (Cancel).
 * Structure/theme/a11y modeled closely on NewColumnsModal.jsx.
 */
import { useState, useEffect } from 'react';
import DialogCard from './DialogCard.jsx';
import { keyboardControlProps } from '../utils/keyboardActivation.js';
import { COLORS, TYPOGRAPHY, BORDERS } from '../theme';
import { getOtherSurveysUsingTemplate } from '../hooks/useDatabase';
import { showToast } from '../utils/toast';

const CreateCategoryModal = ({
  isOpen,
  onClose,
  onConfirm,
  moduleName = '', // Selected module's display name (context copy only)
  templateName = '',
  existingCategoryNames = [], // Names already used in the selected module (duplicate validation)
  existingTemplateNames = [], // Array of existing template names for duplicate validation
  templateId = null, // Current template's Supabase ID for checking usage
  currentSurveyId = null // Current survey/document ID to exclude from usage check
}) => {
  const [categoryName, setCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [selectedOption, setSelectedOption] = useState(null); // 'modifyTemplate' | 'newTemplate'
  const [newTemplateName, setNewTemplateName] = useState('');
  const [nameError, setNameError] = useState('');
  const [otherSurveys, setOtherSurveys] = useState([]);
  const [isCheckingUsage, setIsCheckingUsage] = useState(false);


  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCategoryName('');
      setCategoryError('');
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

  // Duplicate checks (case-insensitive, trimmed)
  const isDuplicateCategoryName = (name) => {
    const trimmedName = name.trim().toLowerCase();
    return existingCategoryNames.some(
      (existingName) => String(existingName).toLowerCase() === trimmedName
    );
  };

  const isDuplicateTemplateName = (name) => {
    const trimmedName = name.trim().toLowerCase();
    return existingTemplateNames.some(
      (existingName) => String(existingName).toLowerCase() === trimmedName
    );
  };

  const handleCategoryNameChange = (e) => {
    const value = e.target.value;
    setCategoryName(value);

    if (value.trim() && isDuplicateCategoryName(value)) {
      setCategoryError('A category with this name already exists in this module. Please choose a different name.');
    } else {
      setCategoryError('');
    }
  };

  const handleTemplateNameChange = (e) => {
    const value = e.target.value;
    setNewTemplateName(value);

    if (value.trim() && isDuplicateTemplateName(value)) {
      setNameError('A template with this name already exists. Please choose a different name.');
    } else {
      setNameError('');
    }
  };

  if (!isOpen) return null;

  const categoryNameValid = Boolean(categoryName.trim()) && !categoryError;
  const canConfirm = categoryNameValid
    && Boolean(selectedOption)
    && (selectedOption !== 'newTemplate' || (Boolean(newTemplateName.trim()) && !nameError));

  const handleConfirm = () => {
    if (!categoryName.trim()) {
      showToast('Please enter a name for the new category.', 'warn');
      return;
    }
    if (isDuplicateCategoryName(categoryName)) {
      setCategoryError('A category with this name already exists in this module. Please choose a different name.');
      return;
    }
    if (!selectedOption) {
      showToast('Please select an option.', 'warn');
      return;
    }
    if (selectedOption === 'newTemplate') {
      if (!newTemplateName.trim()) {
        showToast('Please enter a name for the new template.', 'warn');
        return;
      }
      if (isDuplicateTemplateName(newTemplateName)) {
        setNameError('A template with this name already exists. Please choose a different name.');
        return;
      }
    }
    onConfirm(selectedOption, {
      categoryName: categoryName.trim(),
      newTemplateName: newTemplateName.trim()
    });
  };

  // The app's one dialog shell (src/components/DialogCard.jsx, owner
  // 2026-10-26: every dialog follows the same design).
  return (
    <DialogCard
      title="Create category"
      message={moduleName
        ? `Name the new category for ${moduleName}, then choose where to save it.`
        : 'Name the new category, then choose where to save it.'}
      onClose={onClose}
      width={460}
      zIndex={10000}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={handleConfirm} disabled={!canConfirm}>Create category</button>
        </>
      )}
    >
        {/* Category name input */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: TYPOGRAPHY.fontSize.sm,
            fontWeight: TYPOGRAPHY.fontWeight.medium,
            color: COLORS.text.muted,
            marginBottom: '4px',
            fontFamily: TYPOGRAPHY.fontFamily.default,
          }}>
            Category name
          </div>
          <input
            type="text"
            value={categoryName}
            onChange={handleCategoryNameChange}
            placeholder="Enter category name..."
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: BORDERS.radius.md,
              border: `1px solid ${categoryError ? 'var(--danger)' : COLORS.border.default}`,
              background: COLORS.background.dark,
              color: COLORS.text.secondary,
              fontSize: TYPOGRAPHY.fontSize.md,
              fontFamily: TYPOGRAPHY.fontFamily.default,
              outline: 'none',
              boxSizing: 'border-box',
            }}
            autoFocus
          />
          {categoryError && (
            <div style={{
              marginTop: '6px',
              fontSize: TYPOGRAPHY.fontSize.sm,
              color: 'var(--danger-text)',
              fontFamily: TYPOGRAPHY.fontFamily.default,
            }}>
              {categoryError}
            </div>
          )}
        </div>

        {/* Option selection */}
        <div role="radiogroup" aria-label="Where should the new category be saved?" style={{ marginBottom: '24px' }}>
          <div style={{
            fontSize: TYPOGRAPHY.fontSize.sm,
            fontWeight: TYPOGRAPHY.fontWeight.medium,
            color: COLORS.text.muted,
            marginBottom: '8px',
            fontFamily: TYPOGRAPHY.fontFamily.default,
          }}>
            Where should the new category be saved?
          </div>

          {/* Option A: Modify current template */}
          <div
            onClick={() => canModifyTemplate && setSelectedOption('modifyTemplate')}
            {...keyboardControlProps(null, { role: 'radio', checked: selectedOption === 'modifyTemplate', disabled: !canModifyTemplate })}
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
              marginBottom: '8px',
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
              Modify current template
            </div>
            <div style={{
              fontSize: TYPOGRAPHY.fontSize.sm,
              color: COLORS.text.muted,
              fontFamily: TYPOGRAPHY.fontFamily.default,
            }}>
              {canModifyTemplate
                ? 'Adds the category to this template.'
                : 'Cannot modify - this template is used by other surveys.'}
            </div>

            {/* Show warning when other surveys use this template */}
            {!canModifyTemplate && otherSurveys.length > 0 && (
              <div style={{
                marginTop: '10px',
                padding: '10px',
                // The app's warning box (tokens.css --alert-warning-*), not a
                // hand-typed amber that read as the gold accent.
                background: 'var(--alert-warning-bg)',
                border: 'var(--alert-warning-border)',
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

          {/* Option B: Save as new template */}
          <div
            onClick={() => setSelectedOption('newTemplate')}
            {...keyboardControlProps(null, { role: 'radio', checked: selectedOption === 'newTemplate' })}
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
              Save as new template
            </div>
            <div style={{
              fontSize: TYPOGRAPHY.fontSize.sm,
              color: COLORS.text.muted,
              fontFamily: TYPOGRAPHY.fontFamily.default,
              marginBottom: selectedOption === 'newTemplate' ? '12px' : '0',
            }}>
              Creates a new template with the added category. Original template remains unchanged.
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
        </div>
    </DialogCard>
  );
};

export default CreateCategoryModal;
