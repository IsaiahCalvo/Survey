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
    // Use @microsoft.graph.conflictBehavior=replace to overwrite existing files
    const response = await graphClient
      .api(`/me/drive/root:${filePath}:/content?@microsoft.graph.conflictBehavior=replace`)
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .put(blob);

    return response;
  } catch (error) {
    console.error('Failed to upload Excel file:', error);
    throw new Error(`Failed to upload Excel file: ${error.message}`);
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
 * Get file metadata by OneDrive item ID
 * This is useful for tracking files across moves/renames
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - The OneDrive item ID
 * @returns {Promise<Object|null>} - File metadata or null if not found
 */
export async function getFileById(graphClient, fileId) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  if (!fileId) {
    return null;
  }

  try {
    const response = await graphClient
      .api(`/me/drive/items/${fileId}`)
      .select('id,name,parentReference,webUrl,@microsoft.graph.downloadUrl')
      .get();

    return response;
  } catch (error) {
    // 404 means file was deleted
    if (error.statusCode === 404 || error.code === 'itemNotFound') {
      return null;
    }
    console.error('Failed to get file by ID:', error);
    throw error;
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

  if (!fileId) {
    throw new Error('File ID is required');
  }

  try {
    // First get the download URL (more reliable than direct /content endpoint)
    const metadata = await graphClient
      .api(`/me/drive/items/${fileId}`)
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
    // Extract detailed error info from Graph API errors
    const errorMessage = error.body?.error?.message || error.body?.message || error.message || 'Unknown error';
    const statusCode = error.statusCode || error.code || '';
    console.error('Failed to download Excel file:', { error, statusCode, errorMessage });
    throw new Error(`Failed to download Excel file: ${statusCode ? `[${statusCode}] ` : ''}${errorMessage}`);
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

/**
 * Get file metadata including ETag for change detection
 * This is efficient because it only fetches metadata, not file content
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - The OneDrive item ID
 * @returns {Promise<Object>} - Object containing eTag, lastModifiedDateTime, and other metadata
 */
export async function getFileETag(graphClient, fileId) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  if (!fileId) {
    throw new Error('File ID is required');
  }

  try {
    const response = await graphClient
      .api(`/me/drive/items/${fileId}`)
      .select('id,name,eTag,lastModifiedDateTime,size')
      .get();

    return {
      id: response.id,
      name: response.name,
      eTag: response.eTag,
      lastModifiedDateTime: response.lastModifiedDateTime,
      size: response.size
    };
  } catch (error) {
    // 404 means file was deleted
    if (error.statusCode === 404 || error.code === 'itemNotFound') {
      return null;
    }
    console.error('Failed to get file ETag:', error);
    throw new Error(`Failed to get file ETag: ${error.message}`);
  }
}

/**
 * Upload/update an Excel file to OneDrive by file ID
 * This is useful for updating existing files and works even when Excel has the file open
 * (because it updates the cloud version, not the local synced copy)
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - The OneDrive item ID
 * @param {ArrayBuffer|Uint8Array} fileContent - Excel file content
 * @returns {Promise<Object>} - Upload result with file metadata including new eTag
 */
export async function uploadFileContentById(graphClient, fileId, fileContent) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  if (!fileId) {
    throw new Error('File ID is required');
  }

  try {
    // Ensure fileContent is in proper binary format
    let binaryContent;
    if (fileContent instanceof ArrayBuffer) {
      binaryContent = new Uint8Array(fileContent);
    } else if (fileContent instanceof Uint8Array) {
      binaryContent = fileContent;
    } else if (fileContent && fileContent.buffer instanceof ArrayBuffer) {
      binaryContent = new Uint8Array(fileContent.buffer, fileContent.byteOffset, fileContent.byteLength);
    } else if (fileContent && typeof fileContent === 'object' && fileContent.type === 'Buffer' && Array.isArray(fileContent.data)) {
      binaryContent = new Uint8Array(fileContent.data);
    } else if (Array.isArray(fileContent)) {
      binaryContent = new Uint8Array(fileContent);
    } else {
      binaryContent = fileContent;
    }

    // Create a Blob with proper MIME type
    const blob = new Blob([binaryContent], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    // Upload file content by ID - this replaces the file content
    const response = await graphClient
      .api(`/me/drive/items/${fileId}/content`)
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .put(blob);

    return response;
  } catch (error) {
    console.error('Failed to upload file content by ID:', error);
    throw new Error(`Failed to upload file content: ${error.message}`);
  }
}

/**
 * List only folders in a OneDrive path
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} folderPath - Path to folder (e.g., '/Documents')
 * @returns {Promise<Array>} - Array of folder items
 */
export async function listFolders(graphClient, folderPath = '/') {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    let apiPath;
    if (folderPath === '/' || folderPath === '') {
      apiPath = '/me/drive/root/children';
    } else {
      apiPath = `/me/drive/root:${folderPath}:/children`;
    }

    const response = await graphClient
      .api(apiPath)
      .filter("folder ne null")
      .select('id,name,folder,parentReference,webUrl')
      .get();

    return response.value || [];
  } catch (error) {
    console.error('Failed to list folders:', error);
    throw new Error(`Failed to list folders: ${error.message}`);
  }
}

/**
 * List items in a specific drive (for SharePoint document libraries)
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} driveId - The drive ID
 * @param {string} folderId - Folder ID or 'root' for root folder
 * @param {boolean} foldersOnly - If true, only return folders
 * @returns {Promise<Array>} - Array of items
 */
export async function listDriveItems(graphClient, driveId, folderId = 'root', foldersOnly = false) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    let request = graphClient
      .api(`/drives/${driveId}/items/${folderId}/children`)
      .select('id,name,folder,file,parentReference,webUrl');

    if (foldersOnly) {
      request = request.filter("folder ne null");
    }

    const response = await request.get();
    return response.value || [];
  } catch (error) {
    console.error('Failed to list drive items:', error);
    throw new Error(`Failed to list drive items: ${error.message}`);
  }
}

/**
 * List user's SharePoint sites they have access to
 * @param {Object} graphClient - Microsoft Graph client
 * @returns {Promise<Array>} - Array of SharePoint sites
 */
export async function listSharePointSites(graphClient) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    // Search for all sites the user has access to
    const response = await graphClient
      .api('/sites?search=*')
      .select('id,name,displayName,webUrl')
      .top(100)
      .get();

    return response.value || [];
  } catch (error) {
    // Don't log MSA (personal account) errors - expected behavior
    if (!error.message?.includes('MSA') && !error.message?.includes('not supported')) {
      console.error('Failed to list SharePoint sites:', error);
    }
    throw new Error(`Failed to list SharePoint sites: ${error.message}`);
  }
}

/**
 * List document libraries (drives) in a SharePoint site
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} siteId - The SharePoint site ID
 * @returns {Promise<Array>} - Array of document libraries
 */
export async function listSiteDocumentLibraries(graphClient, siteId) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    const response = await graphClient
      .api(`/sites/${siteId}/drives`)
      .select('id,name,driveType,webUrl')
      .get();

    return response.value || [];
  } catch (error) {
    console.error('Failed to list site document libraries:', error);
    throw new Error(`Failed to list site document libraries: ${error.message}`);
  }
}

/**
 * Check if a file exists at a given path in OneDrive
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} folderPath - Folder path (e.g., '/Documents')
 * @param {string} fileName - Name of the file to check
 * @returns {Promise<{exists: boolean, fileId?: string}>} - Whether file exists and its ID
 */
export async function checkFileExists(graphClient, folderPath, fileName) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    const fullPath = folderPath === '/' ? `/${fileName}` : `${folderPath}/${fileName}`;
    const metadata = await graphClient
      .api(`/me/drive/root:${fullPath}`)
      .select('id,name')
      .get();

    return { exists: true, fileId: metadata.id };
  } catch (error) {
    if (error.statusCode === 404 || error.code === 'itemNotFound') {
      return { exists: false };
    }
    console.error('Failed to check file existence:', error);
    throw new Error(`Failed to check file existence: ${error.message}`);
  }
}

/**
 * Check if a file exists in a specific drive (for SharePoint)
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} driveId - The drive ID
 * @param {string} folderId - Folder ID
 * @param {string} fileName - Name of the file to check
 * @returns {Promise<{exists: boolean, fileId?: string}>} - Whether file exists and its ID
 */
export async function checkFileExistsInDrive(graphClient, driveId, folderId, fileName) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    // List children and find the file by name
    const response = await graphClient
      .api(`/drives/${driveId}/items/${folderId}/children`)
      .filter(`name eq '${fileName}'`)
      .select('id,name')
      .get();

    if (response.value && response.value.length > 0) {
      return { exists: true, fileId: response.value[0].id };
    }
    return { exists: false };
  } catch (error) {
    console.error('Failed to check file existence in drive:', error);
    throw new Error(`Failed to check file existence: ${error.message}`);
  }
}

/**
 * Read template metadata from an Excel file's hidden _SurveyMetadata sheet
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - The OneDrive file ID
 * @returns {Promise<{templateId: string, templateName: string}|null>} - Template metadata or null if not found
 */
export async function getTemplateIdFromExcel(graphClient, fileId) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    // Import ExcelJS dynamically to avoid issues if not available
    const ExcelJS = (await import('exceljs')).default;

    // Download the file
    const fileBuffer = await downloadExcelFile(graphClient, fileId);

    // Load with ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);

    // Find hidden metadata sheet
    const metaSheet = workbook.getWorksheet('_SurveyMetadata');
    if (!metaSheet) {
      return null;
    }

    const templateId = metaSheet.getCell('B1').value;
    const templateName = metaSheet.getCell('B2').value;

    return {
      templateId: templateId ? String(templateId) : null,
      templateName: templateName ? String(templateName) : null
    };
  } catch (error) {
    console.error('Failed to read template ID from Excel:', error);
    // Return null instead of throwing - file might not have metadata
    return null;
  }
}

/**
 * Upload file to a specific drive and folder (for SharePoint)
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} driveId - The drive ID
 * @param {string} folderId - The folder ID (use 'root' for root)
 * @param {string} fileName - Name for the uploaded file
 * @param {ArrayBuffer|Uint8Array} fileContent - File content
 * @returns {Promise<Object>} - Upload result with file metadata
 */
export async function uploadFileToDrive(graphClient, driveId, folderId, fileName, fileContent) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    // Ensure fileContent is in proper binary format
    let binaryContent;
    if (fileContent instanceof ArrayBuffer) {
      binaryContent = new Uint8Array(fileContent);
    } else if (fileContent instanceof Uint8Array) {
      binaryContent = fileContent;
    } else if (fileContent && fileContent.buffer instanceof ArrayBuffer) {
      binaryContent = new Uint8Array(fileContent.buffer, fileContent.byteOffset, fileContent.byteLength);
    } else if (fileContent && typeof fileContent === 'object' && fileContent.type === 'Buffer' && Array.isArray(fileContent.data)) {
      binaryContent = new Uint8Array(fileContent.data);
    } else if (Array.isArray(fileContent)) {
      binaryContent = new Uint8Array(fileContent);
    } else {
      binaryContent = fileContent;
    }

    // Create a Blob with proper MIME type
    const blob = new Blob([binaryContent], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    // Upload to the specific drive and folder
    const response = await graphClient
      .api(`/drives/${driveId}/items/${folderId}:/${fileName}:/content?@microsoft.graph.conflictBehavior=replace`)
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .put(blob);

    return response;
  } catch (error) {
    console.error('Failed to upload file to drive:', error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}
