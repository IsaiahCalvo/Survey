/**
 * Excel Graph Service
 * Handles Excel file operations using Microsoft Graph API
 * Works with Excel files stored in OneDrive or SharePoint
 */

/**
 * Upload or update an entire Excel file to OneDrive/SharePoint
 * @param {Object} graphClient - Microsoft Graph client from useMSGraph hook
 * @param {string} filePath - Path in OneDrive (e.g., '/Documents/survey.xlsx')
 * @param {ArrayBuffer} fileContent - Excel file content
 * @returns {Promise<Object>} - Upload result with file metadata
 */
export async function uploadExcelFile(graphClient, filePath, fileContent) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    // Upload file to OneDrive
    const response = await graphClient
      .api(`/me/drive/root:${filePath}:/content`)
      .put(fileContent);

    console.log('Excel file uploaded to OneDrive:', response);
    return response;
  } catch (error) {
    console.error('Failed to upload Excel file:', error);
    throw new Error(`Failed to upload Excel file: ${error.message}`);
  }
}

/**
 * Update a specific range in an Excel file (for real-time updates)
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - The OneDrive item ID of the Excel file
 * @param {string} worksheetName - Name of the worksheet
 * @param {string} range - Cell range (e.g., 'A1:D10')
 * @param {Array<Array>} values - 2D array of values to update
 * @returns {Promise<Object>} - Update result
 */
export async function updateExcelRange(graphClient, fileId, worksheetName, range, values) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    const response = await graphClient
      .api(`/me/drive/items/${fileId}/workbook/worksheets/${worksheetName}/range(address='${range}')`)
      .patch({
        values: values
      });

    console.log('Excel range updated:', response);
    return response;
  } catch (error) {
    console.error('Failed to update Excel range:', error);
    throw new Error(`Failed to update Excel range: ${error.message}`);
  }
}

/**
 * Get file metadata from OneDrive by path
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} filePath - Path in OneDrive (e.g., '/Documents/survey.xlsx')
 * @returns {Promise<Object>} - File metadata including ID
 */
export async function getFileMetadata(graphClient, filePath) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    const response = await graphClient
      .api(`/me/drive/root:${filePath}`)
      .get();

    return response;
  } catch (error) {
    console.error('Failed to get file metadata:', error);
    throw new Error(`Failed to get file metadata: ${error.message}`);
  }
}

/**
 * List files in a OneDrive folder
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} folderPath - Path to folder (e.g., '/Documents')
 * @returns {Promise<Array>} - Array of files
 */
export async function listFiles(graphClient, folderPath = '/') {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    const response = await graphClient
      .api(`/me/drive/root:${folderPath}:/children`)
      .filter("file ne null")
      .get();

    return response.value || [];
  } catch (error) {
    console.error('Failed to list files:', error);
    throw new Error(`Failed to list files: ${error.message}`);
  }
}

/**
 * Download an Excel file from OneDrive
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - The OneDrive item ID
 * @returns {Promise<ArrayBuffer>} - File content as ArrayBuffer
 */
export async function downloadExcelFile(graphClient, fileId) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    const response = await graphClient
      .api(`/me/drive/items/${fileId}/content`)
      .get();

    return response;
  } catch (error) {
    console.error('Failed to download Excel file:', error);
    throw new Error(`Failed to download Excel file: ${error.message}`);
  }
}
