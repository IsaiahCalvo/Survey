/**
 * Excel Session Service
 * Handles real-time Excel co-authoring using Microsoft Graph API session-based editing.
 * This enables live sync where changes appear in Excel without closing/reopening.
 *
 * NOTE: Session-based Excel APIs only work with Microsoft 365 Business/Work accounts.
 * Personal OneDrive (consumer) accounts do not support this feature.
 *
 * DRIVE SCOPING: a file in the user's own OneDrive lives under `/me/drive`, but a file in
 * a SharePoint document library or a Teams channel (SharePoint behind the scenes) lives in
 * a DIFFERENT drive — addressing it via `/me/drive/items/{id}` 404s. When the caller knows
 * the SharePoint drive id, pass it through as `driveId` and every call targets
 * `/drives/{driveId}/items/{id}/...` instead. Omitting driveId preserves the OneDrive path.
 */

/** Base Graph item path for a workbook, scoped to the correct drive.
 *  Exported so rowIdGraphWriteback (the single-cell Row ID writer) shares the
 *  exact same drive-scoping rule instead of re-deriving it. */
export const workbookItemBase = (fileId, driveId) =>
  driveId ? `/drives/${driveId}/items/${fileId}` : `/me/drive/items/${fileId}`;

/**
 * Get OneDrive item ID from file path
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} filePath - Path in OneDrive (e.g., '/Documents/survey.xlsx')
 * @returns {Promise<string>} - OneDrive item ID
 */
export async function getFileIdFromPath(graphClient, filePath, driveId) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    const rootPath = driveId ? `/drives/${driveId}/root:${filePath}` : `/me/drive/root:${filePath}`;
    const response = await graphClient
      .api(rootPath)
      .select('id')
      .get();

    return response.id;
  } catch (error) {
    console.error('Failed to get file ID:', error);
    throw new Error(`Failed to get file ID: ${error.message}`);
  }
}

/**
 * Create a workbook session for real-time editing
 * Sessions allow multiple users/apps to edit simultaneously (co-authoring)
 *
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - OneDrive item ID
 * @param {boolean} persistChanges - If true, changes are saved immediately (default: true)
 * @returns {Promise<{sessionId: string, expiresAt: Date}>} - Session info
 */
export async function createWorkbookSession(graphClient, fileId, persistChanges = true, driveId) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    const response = await graphClient
      .api(`${workbookItemBase(fileId, driveId)}/workbook/createSession`)
      .post({
        persistChanges: persistChanges
      });

    // Sessions typically expire after 5 minutes of inactivity
    const expiresAt = new Date(Date.now() + 4 * 60 * 1000); // 4 min to be safe

    return {
      sessionId: response.id,
      expiresAt: expiresAt
    };
  } catch (error) {
    console.error('Failed to create workbook session:', error);

    // Check for common errors
    if (error.statusCode === 403 || error.code === 'AccessDenied') {
      throw new Error('Excel session API requires Microsoft 365 Business account. Personal OneDrive accounts are not supported for live sync.');
    }
    if (error.statusCode === 404) {
      throw new Error('Excel file not found in OneDrive.');
    }

    throw new Error(`Failed to create session: ${error.message}`);
  }
}

/**
 * Close a workbook session
 * Always close sessions when done to free resources
 *
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - OneDrive item ID
 * @param {string} sessionId - Session ID to close
 */
export async function closeWorkbookSession(graphClient, fileId, sessionId, driveId) {
  if (!graphClient || !sessionId) {
    return;
  }

  try {
    await graphClient
      .api(`${workbookItemBase(fileId, driveId)}/workbook/closeSession`)
      .header('workbook-session-id', sessionId)
      .post({});

  } catch (error) {
    // Don't throw on close errors - session may have already expired
    console.warn('Failed to close workbook session (may have expired):', error.message);
  }
}

/**
 * Refresh/keep-alive a workbook session
 * Call this periodically to prevent session timeout (before 5 min expires)
 *
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - OneDrive item ID
 * @param {string} sessionId - Current session ID
 * @returns {Promise<{sessionId: string, expiresAt: Date}>} - Refreshed session info
 */
export async function refreshWorkbookSession(graphClient, fileId, sessionId, driveId) {
  if (!graphClient || !sessionId) {
    throw new Error('Missing graphClient or sessionId');
  }

  try {
    // The API doesn't have a dedicated refresh endpoint
    // Making any API call with the session ID keeps it alive
    // We'll use a lightweight operation - get worksheets
    await graphClient
      .api(`${workbookItemBase(fileId, driveId)}/workbook/worksheets`)
      .header('workbook-session-id', sessionId)
      .select('id,name')
      .get();

    const expiresAt = new Date(Date.now() + 4 * 60 * 1000);
    return {
      sessionId: sessionId,
      expiresAt: expiresAt
    };
  } catch (error) {
    console.error('Failed to refresh session:', error);
    throw new Error(`Session refresh failed: ${error.message}`);
  }
}

/**
 * Update a cell range in Excel workbook (with session for real-time sync)
 * Changes appear immediately in Excel for other users/viewers
 *
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - OneDrive item ID
 * @param {string} sessionId - Workbook session ID
 * @param {string} sheetName - Worksheet name
 * @param {string} range - Cell range (e.g., 'A1:D10')
 * @param {Array<Array>} values - 2D array of cell values
 * @returns {Promise<Object>} - Updated range info
 */
export async function updateCellRange(graphClient, fileId, sessionId, sheetName, range, values, driveId) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    // URL encode the sheet name to handle special characters
    const encodedSheetName = encodeURIComponent(sheetName);

    const requestBuilder = graphClient
      .api(`${workbookItemBase(fileId, driveId)}/workbook/worksheets('${encodedSheetName}')/range(address='${range}')`);

    // Add session header if provided
    if (sessionId) {
      requestBuilder.header('workbook-session-id', sessionId);
    }

    const response = await requestBuilder.patch({
      values: values
    });

    return response;
  } catch (error) {
    console.error('Failed to update cell range:', error);
    throw new Error(`Failed to update cells: ${error.message}`);
  }
}

/**
 * Get all worksheets in a workbook
 *
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - OneDrive item ID
 * @param {string} sessionId - Workbook session ID (optional)
 * @returns {Promise<Array<{id: string, name: string, position: number}>>} - List of worksheets
 */
export async function getWorksheets(graphClient, fileId, sessionId, driveId) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    const requestBuilder = graphClient
      .api(`${workbookItemBase(fileId, driveId)}/workbook/worksheets`);

    if (sessionId) {
      requestBuilder.header('workbook-session-id', sessionId);
    }

    const response = await requestBuilder
      .select('id,name,position')
      .get();

    return response.value || [];
  } catch (error) {
    console.error('Failed to get worksheets:', error);
    throw new Error(`Failed to get worksheets: ${error.message}`);
  }
}

/**
 * Get used range of a worksheet (to know how much data exists)
 *
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - OneDrive item ID
 * @param {string} sessionId - Workbook session ID (optional)
 * @param {string} sheetName - Worksheet name
 * @returns {Promise<{values: Array<Array>, address: string}>} - Used range data
 */
export async function getUsedRange(graphClient, fileId, sessionId, sheetName, driveId) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    const encodedSheetName = encodeURIComponent(sheetName);

    const requestBuilder = graphClient
      .api(`${workbookItemBase(fileId, driveId)}/workbook/worksheets('${encodedSheetName}')/usedRange`);

    if (sessionId) {
      requestBuilder.header('workbook-session-id', sessionId);
    }

    const response = await requestBuilder
      .select('values,address,rowCount,columnCount')
      .get();

    return {
      values: response.values,
      address: response.address,
      rowCount: response.rowCount,
      columnCount: response.columnCount
    };
  } catch (error) {
    console.error('Failed to get used range:', error);
    throw new Error(`Failed to get used range: ${error.message}`);
  }
}

/**
 * Check if the current account supports Excel session APIs
 * Personal OneDrive accounts will fail with 403/AccessDenied
 *
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} fileId - OneDrive item ID to test with
 * @returns {Promise<{supported: boolean, error?: string}>}
 */
export async function checkSessionSupport(graphClient, fileId, driveId) {
  if (!graphClient || !fileId) {
    return { supported: false, error: 'Missing graphClient or fileId' };
  }

  try {
    // Try to create a non-persistent session to test support
    const response = await graphClient
      .api(`${workbookItemBase(fileId, driveId)}/workbook/createSession`)
      .post({ persistChanges: false });

    // Close the test session immediately
    if (response.id) {
      try {
        await graphClient
          .api(`${workbookItemBase(fileId, driveId)}/workbook/closeSession`)
          .header('workbook-session-id', response.id)
          .post({});
      } catch (e) {
        // Ignore close errors
      }
    }

    return { supported: true };
  } catch (error) {
    if (error.statusCode === 403 || error.code === 'AccessDenied') {
      return {
        supported: false,
        error: 'Excel session APIs require Microsoft 365 Business account. Personal OneDrive is not supported.'
      };
    }
    return {
      supported: false,
      error: error.message
    };
  }
}
