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
    // Ensure fileContent is in proper binary format for upload
    // ExcelJS writeBuffer() returns ArrayBuffer/Buffer, but it may get serialized
    // when passed through React state. Convert to Uint8Array first.
    let binaryContent;
    if (fileContent instanceof ArrayBuffer) {
      binaryContent = new Uint8Array(fileContent);
    } else if (fileContent instanceof Uint8Array) {
      binaryContent = fileContent;
    } else if (fileContent && fileContent.buffer instanceof ArrayBuffer) {
      // Handle Buffer-like objects (e.g., Node.js Buffer view)
      binaryContent = new Uint8Array(fileContent.buffer, fileContent.byteOffset, fileContent.byteLength);
    } else if (fileContent && typeof fileContent === 'object' && fileContent.type === 'Buffer' && Array.isArray(fileContent.data)) {
      // Handle serialized Buffer object: {"type":"Buffer","data":[...]}
      binaryContent = new Uint8Array(fileContent.data);
    } else if (Array.isArray(fileContent)) {
      // Handle raw array of bytes
      binaryContent = new Uint8Array(fileContent);
    } else {
      // Fallback - assume it's already in a usable format
      binaryContent = fileContent;
    }

    // Create a Blob with proper MIME type to ensure binary upload
    // This prevents the Graph SDK from JSON-serializing the data
    const blob = new Blob([binaryContent], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    // Upload file to OneDrive with explicit content-type header
    const response = await graphClient
      .api(`/me/drive/root:${filePath}:/content`)
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .put(blob);

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
 * Download an Excel file from OneDrive by ID
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

/**
 * Download an Excel file from OneDrive by path
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} filePath - Path in OneDrive (e.g., '/Documents/survey.xlsx')
 * @returns {Promise<ArrayBuffer>} - File content as ArrayBuffer
 */
export async function downloadExcelFileByPath(graphClient, filePath) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    // First, get the file metadata to obtain the download URL
    const metadata = await graphClient
      .api(`/me/drive/root:${filePath}`)
      .select('@microsoft.graph.downloadUrl')
      .get();

    if (!metadata['@microsoft.graph.downloadUrl']) {
      throw new Error('Could not get download URL for the file');
    }

    // Fetch the file content directly from the download URL
    const response = await fetch(metadata['@microsoft.graph.downloadUrl']);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return arrayBuffer;
  } catch (error) {
    console.error('Failed to download Excel file by path:', error);
    // Extract more detailed error info from Graph API errors
    const errorMessage = error.body?.message || error.message || 'Unknown error';
    throw new Error(`Failed to download Excel file: ${errorMessage}`);
  }
}
