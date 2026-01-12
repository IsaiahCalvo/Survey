import React, { useState, useEffect } from 'react';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';
import OneDriveFolderBrowser from './OneDriveFolderBrowser';

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
      alert('Please select a destination folder');
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
          maxWidth: '600px',
          width: '90%',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
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
          }}>
            {title}
          </h3>
        </div>

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
              border: `1px solid ${fileNameError ? '#ef4444' : COLORS.border.default}`,
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
              color: '#ef4444',
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

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
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
            onClick={handleSave}
            disabled={!selectedFolder || !fileName.trim() || fileNameError}
            style={{
              padding: '10px 20px',
              background: (selectedFolder && fileName.trim() && !fileNameError) ? COLORS.accent.primary : COLORS.border.default,
              color: COLORS.text.primary,
              border: 'none',
              borderRadius: BORDERS.radius.md,
              fontSize: TYPOGRAPHY.fontSize.md,
              fontWeight: TYPOGRAPHY.fontWeight.medium,
              cursor: (selectedFolder && fileName.trim() && !fileNameError) ? 'pointer' : 'not-allowed',
              fontFamily: TYPOGRAPHY.fontFamily.default,
              transition: 'all 0.15s ease',
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default OneDriveFileSaveModal;
