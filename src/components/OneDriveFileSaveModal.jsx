/**
 * OneDriveFileSaveModal.jsx — modal for naming an .xlsx export and picking a OneDrive/SharePoint destination.
 *
 * Default-exports OneDriveFileSaveModal. Validates the filename (required, no invalid
 * chars, enforces .xlsx) and embeds OneDriveFolderBrowser for destination selection, then
 * calls onSave({ fileName, folder }). Used by the Excel export flow to save to OneDrive.
 */
import { useState, useEffect } from 'react';
import DialogCard from './DialogCard.jsx';
import { COLORS, TYPOGRAPHY, BORDERS } from '../theme';
import OneDriveFolderBrowser from './OneDriveFolderBrowser';
import { showToast } from '../utils/toast';

const OneDriveFileSaveModal = ({
  isOpen,
  onSave,
  onClose,
  graphClient,
  defaultFileName = 'export.xlsx',
  title = 'Save to OneDrive',
}) => {
  const [fileName, setFileName] = useState(defaultFileName);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [fileNameError, setFileNameError] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setFileName(defaultFileName);
      setSelectedFolder(null);
      setFileNameError('');
    }
  }, [isOpen, defaultFileName]);


  // Validate filename
  const validateFileName = (name) => {
    if (!name.trim()) {
      return 'File name is required';
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(name)) {
      return 'File name contains invalid characters';
    }

    // Ensure .xlsx extension
    if (!name.toLowerCase().endsWith('.xlsx')) {
      return 'File name must end with .xlsx';
    }

    return '';
  };

  const handleFileNameChange = (e) => {
    const value = e.target.value;
    setFileName(value);
    setFileNameError(validateFileName(value));
  };

  const handleFolderSelect = (folder) => {
    setSelectedFolder(folder);
  };

  const handleSave = () => {
    // Validate filename
    const error = validateFileName(fileName);
    if (error) {
      setFileNameError(error);
      return;
    }

    // Ensure folder is selected
    if (!selectedFolder) {
      showToast('Please select a destination folder', 'warn');
      return;
    }

    // Ensure filename has .xlsx extension
    let finalFileName = fileName.trim();
    if (!finalFileName.toLowerCase().endsWith('.xlsx')) {
      finalFileName += '.xlsx';
    }

    onSave({
      fileName: finalFileName,
      folder: selectedFolder
    });
  };

  if (!isOpen) return null;

  // Build display path for selected folder
  const getDisplayPath = () => {
    if (!selectedFolder) return 'No folder selected';

    if (selectedFolder.type === 'myDrive') {
      return `OneDrive${selectedFolder.folderPath}`;
    } else if (selectedFolder.type === 'sharepoint') {
      return `SharePoint: ${selectedFolder.siteName} > ${selectedFolder.driveName}${selectedFolder.folderPath ? ' > ' + selectedFolder.folderPath : ''}`;
    }

    return selectedFolder.folderName || 'Selected folder';
  };

  // The app's one dialog shell (src/components/DialogCard.jsx, owner
  // 2026-10-26: every dialog follows the same design).
  return (
    <DialogCard
      title={title}
      onClose={onClose}
      width={560}
      zIndex={10000}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={handleSave} disabled={!selectedFolder || !fileName.trim() || fileNameError}>Save</button>
        </>
      )}
    >
        {/* File name input */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: TYPOGRAPHY.fontSize.sm,
            fontWeight: TYPOGRAPHY.fontWeight.medium,
            color: COLORS.text.muted,
            marginBottom: '6px',
            fontFamily: TYPOGRAPHY.fontFamily.default,
          }}>
            File Name
          </div>
          <input
            type="text"
            value={fileName}
            onChange={handleFileNameChange}
            placeholder="Enter file name..."
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: BORDERS.radius.md,
              border: `1px solid ${fileNameError ? 'var(--danger)' : COLORS.border.default}`,
              background: COLORS.background.dark,
              color: COLORS.text.secondary,
              fontSize: TYPOGRAPHY.fontSize.md,
              fontFamily: TYPOGRAPHY.fontFamily.default,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {fileNameError && (
            <div style={{
              marginTop: '6px',
              fontSize: TYPOGRAPHY.fontSize.sm,
              color: 'var(--danger-text)',
              fontFamily: TYPOGRAPHY.fontFamily.default,
            }}>
              {fileNameError}
            </div>
          )}
        </div>

        {/* Folder selection label */}
        <div style={{
          fontSize: TYPOGRAPHY.fontSize.sm,
          fontWeight: TYPOGRAPHY.fontWeight.medium,
          color: COLORS.text.muted,
          marginBottom: '6px',
          fontFamily: TYPOGRAPHY.fontFamily.default,
        }}>
          Select Destination Folder
        </div>

        {/* Folder browser */}
        <div style={{ flex: 1, overflow: 'hidden', marginBottom: '16px' }}>
          <OneDriveFolderBrowser
            graphClient={graphClient}
            onFolderSelect={handleFolderSelect}
            selectedPath={selectedFolder?.folderPath}
          />
        </div>

        {/* Selected path display */}
        <div style={{
          background: COLORS.background.tertiary,
          borderRadius: BORDERS.radius.md,
          padding: '12px',
          marginBottom: '24px',
        }}>
          <div style={{
            fontSize: TYPOGRAPHY.fontSize.sm,
            fontWeight: TYPOGRAPHY.fontWeight.medium,
            color: COLORS.text.muted,
            marginBottom: '4px',
            fontFamily: TYPOGRAPHY.fontFamily.default,
          }}>
            Save Location
          </div>
          <div style={{
            fontSize: TYPOGRAPHY.fontSize.md,
            color: selectedFolder ? COLORS.text.secondary : COLORS.text.muted,
            fontFamily: TYPOGRAPHY.fontFamily.mono,
            wordBreak: 'break-all',
          }}>
            {getDisplayPath()}
          </div>
        </div>
    </DialogCard>
  );
};

export default OneDriveFileSaveModal;
