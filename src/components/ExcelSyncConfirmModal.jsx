/**
 * ExcelSyncConfirmModal.jsx — asks whether a save should also update linked Excel.
 *
 * Default-exports the ExcelSyncConfirmModal component: presents three selectable
 * options — 'no' (save in Survey only), 'once' (update Excel this time), 'always'
 * (update and remember) — and calls onConfirm(choice) with the picked id. Continue
 * is disabled until an option is selected. Renders null unless isOpen. Part of the
 * Excel two-way sync flow.
 */
import { useState } from 'react';
import DialogCard from './DialogCard.jsx';
import { keyboardControlProps } from '../utils/keyboardActivation.js';
import { COLORS, TYPOGRAPHY, BORDERS } from '../theme';

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

  // The app's one dialog shell (src/components/DialogCard.jsx, owner
  // 2026-10-26: every dialog follows the same design).
  return (
    <DialogCard
      title="Update Excel file?"
      message="Would you like Survey data to update the linked Excel file?"
      onClose={onClose}
      width={440}
      zIndex={10000}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={handleConfirm} disabled={!selectedOption}>Continue</button>
        </>
      )}
    >
        {/* Options */}
        <div role="radiogroup" aria-label="Update Excel file?" style={{ marginBottom: '24px' }}>
          {options.map((option) => (
            <div
              key={option.id}
              onClick={() => setSelectedOption(option.id)}
              {...keyboardControlProps(null, { role: 'radio', checked: selectedOption === option.id })}
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
    </DialogCard>
  );
};

export default ExcelSyncConfirmModal;
