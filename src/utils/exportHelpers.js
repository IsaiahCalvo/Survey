// Export helpers — export error message mapping + file-lock detection. Lifted verbatim from PDFViewer; all capture-free.

export function getExportErrorMessage(error) {
    const msg = error?.message?.toLowerCase() || '';

    if (msg.includes('name already exists') || msg.includes('409')) {
      return 'A file with this name already exists and may be open in another application. Please close the file and try again.';
    }
    if (msg.includes('locked') || msg.includes('in use')) {
      return 'The file is currently open in another application. Please close it and try again.';
    }
    if (msg.includes('authentication') || msg.includes('unauthorized') || msg.includes('401')) {
      return 'Your session has expired. Please reconnect your Microsoft account.';
    }
    if (msg.includes('forbidden') || msg.includes('403')) {
      return 'You don\'t have permission to save to this location. Please check your OneDrive access.';
    }
    if (msg.includes('not found') || msg.includes('404')) {
      return 'The destination folder could not be found in OneDrive.';
    }
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('offline')) {
      return 'Network connection issue. Please check your internet connection and try again.';
    }
    if (msg.includes('quota') || msg.includes('storage')) {
      return 'Your OneDrive storage is full. Please free up space and try again.';
    }

    return 'Unable to save to OneDrive. Please try again or save to your computer instead.';
  }

export function isFileLocked(error) {
    const msg = error?.message?.toLowerCase() || '';
    return msg.includes('locked') || msg.includes('423') || msg.includes('in use');
  }
