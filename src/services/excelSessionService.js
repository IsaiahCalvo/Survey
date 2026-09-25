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
import { RetryHandlerOptions } from '@microsoft/microsoft-graph-client';

// The SDK otherwise replays buffered POST/PATCH/PUT after 503/504. A write
// may already have landed, so callers must inspect/reconcile before retrying.
export function withoutGraphWriteRetry(request) {
  return request.middlewareOptions?.([new RetryHandlerOptions(0, 0)]) || request;
}

/** Base Graph item path for a workbook, scoped to the correct drive.
 *  Exported so rowIdGraphWriteback (the single-cell Row ID writer) shares the
 *  exact same drive-scoping rule instead of re-deriving it. */
export const workbookItemBase = (fileId, driveId) =>
  driveId ? `/drives/${driveId}/items/${fileId}` : `/me/drive/items/${fileId}`;

// OData quotes are escaped before URL encoding. encodeURIComponent alone
// leaves apostrophes unchanged and breaks names such as Owner's Plan.
export const encodeGraphString = (value) => encodeURIComponent(String(value).replace(/'/g, "''")).replace(/'/g, '%27');

export function graphServiceError(message, error) {
  const wrapped = new Error(message, { cause: error });
  for (const key of ['statusCode', 'status', 'code', 'body', 'headers', 'requestId']) {
    if (error?.[key] !== undefined) wrapped[key] = error[key];
  }
  return wrapped;
}

const workbookWrites = new WeakMap();
const workbookCooldowns = new WeakMap();
// Microsoft recommends sequential requests to the same workbook. Keep a
// verified cell's read/check/write/read cycle together with other local writes;
// never retry a failed operation or let its rejection block later explicit work.
export function withWorkbookWrite(graphClient, fileId, driveId, operation) {
  let writes = workbookWrites.get(graphClient);
  if (!writes) { writes = new Map(); workbookWrites.set(graphClient, writes); }
  const key = JSON.stringify([driveId ?? null, fileId]);
  let cooldowns = workbookCooldowns.get(graphClient);
  if (!cooldowns) { cooldowns = new Map(); workbookCooldowns.set(graphClient, cooldowns); }
  for (const [scope, blocked] of cooldowns) if (blocked.until <= Date.now()) cooldowns.delete(scope);
  const previous = writes.get(key) || Promise.resolve();
  const pending = previous.catch(() => undefined).then(async () => {
    const blocked = cooldowns.get(key);
    if (blocked && blocked.until > Date.now()) throw blocked.error;
    try {
      return await operation();
    } catch (error) {
      const raw = error?.headers?.get?.('Retry-After') ?? error?.headers?.['Retry-After'] ?? error?.headers?.['retry-after'];
      const seconds = raw == null ? NaN : Number(raw);
      const until = Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds) * 1000 : Date.parse(raw);
      if (Number.isFinite(until) && until > Date.now()) cooldowns.set(key, { until, error });
      throw error;
    }
  });
  writes.set(key, pending);
  const cleanup = () => { if (writes.get(key) === pending) writes.delete(key); };
  pending.then(cleanup, cleanup);
  return pending;
}

// Follow the server's cursor without replaying $select/$filter or retaining a
// partial list on failure. Never send auth/session headers to an arbitrary URL.
export async function readGraphCollection(graphClient, requestBuilder, sessionId) {
  const rows = [];
  const visited = new Set();
  for (;;) {
    if (sessionId) requestBuilder.header('workbook-session-id', sessionId);
    const response = await requestBuilder.get();
    if (!Array.isArray(response?.value)) throw new Error('Invalid Graph collection response');
    rows.push(...response.value);
    const next = response['@odata.nextLink'];
    if (!next) return rows;
    if (visited.size >= 1000) throw new Error('Graph collection exceeded its page safety limit');
    const url = new URL(next, 'https://graph.microsoft.com');
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['graph.microsoft.com', 'graph.microsoft.us', 'dod-graph.microsoft.us', 'microsoftgraph.chinacloudapi.cn'].includes(url.hostname)) {
      throw new Error('Untrusted Graph continuation URL');
    }
    if (visited.has(url.href)) throw new Error('Graph continuation cursor repeated');
    visited.add(url.href);
    // The SDK's parser does not resolve relative strings like URL does. Only
    // pass the canonical URL we validated, never the untrusted raw cursor.
    requestBuilder = graphClient.api(url.href);
  }
}

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
    throw graphServiceError(`Failed to get file ID: ${error.message}`, error);
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
    const response = await withoutGraphWriteRetry(graphClient
      .api(`${workbookItemBase(fileId, driveId)}/workbook/createSession`))
      .post({
        persistChanges: persistChanges
      });

    if (typeof response?.id !== 'string' || !response.id) throw new Error('Graph returned no workbook session ID');
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
      throw graphServiceError('Excel session API requires Microsoft 365 Business account. Personal OneDrive accounts are not supported for live sync.', error);
    }
    if (error.statusCode === 404) {
      throw graphServiceError('Excel file not found in OneDrive.', error);
    }

    throw graphServiceError(`Failed to create session: ${error.message}`, error);
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
    await withoutGraphWriteRetry(graphClient
      .api(`${workbookItemBase(fileId, driveId)}/workbook/closeSession`)
      .header('workbook-session-id', sessionId))
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
    // Refresh without fetching the entire worksheet list.
    await withoutGraphWriteRetry(graphClient
      .api(`${workbookItemBase(fileId, driveId)}/workbook/refreshSession`)
      .header('workbook-session-id', sessionId))
      .post();

    const expiresAt = new Date(Date.now() + 4 * 60 * 1000);
    return {
      sessionId: sessionId,
      expiresAt: expiresAt
    };
  } catch (error) {
    console.error('Failed to refresh session:', error);
    throw graphServiceError(`Session refresh failed: ${error.message}`, error);
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
  if (!graphClient) throw new Error('Not authenticated with Microsoft. Please sign in first.');
  return withWorkbookWrite(graphClient, fileId, driveId, () =>
    updateCellRangeNow(graphClient, fileId, sessionId, sheetName, range, values, driveId));
}

async function updateCellRangeNow(graphClient, fileId, sessionId, sheetName, range, values, driveId) {
  if (!graphClient) {
    throw new Error('Not authenticated with Microsoft. Please sign in first.');
  }

  try {
    // URL encode the sheet name to handle special characters
    const encodedSheetName = encodeGraphString(sheetName);

    const requestBuilder = graphClient
      .api(`${workbookItemBase(fileId, driveId)}/workbook/worksheets('${encodedSheetName}')/range(address='${encodeGraphString(range)}')`);

    // Add session header if provided
    if (sessionId) {
      requestBuilder.header('workbook-session-id', sessionId);
    }

    const response = await withoutGraphWriteRetry(requestBuilder).patch({
      values: values
    });

    return response;
  } catch (error) {
    console.error('Failed to update cell range:', error);
    throw graphServiceError(`Failed to update cells: ${error.message}`, error);
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

    return await readGraphCollection(graphClient, requestBuilder.select('id,name,position'), sessionId);
  } catch (error) {
    console.error('Failed to get worksheets:', error);
    throw graphServiceError(`Failed to get worksheets: ${error.message}`, error);
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
    const encodedSheetName = encodeGraphString(sheetName);

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
    throw graphServiceError(`Failed to get used range: ${error.message}`, error);
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
    const response = await withoutGraphWriteRetry(graphClient
      .api(`${workbookItemBase(fileId, driveId)}/workbook/createSession`))
      .post({ persistChanges: false });

    if (typeof response?.id !== 'string' || !response.id) throw new Error('Graph returned no workbook session ID');
    // Close the test session immediately
    if (response.id) {
      try {
        await withoutGraphWriteRetry(graphClient
          .api(`${workbookItemBase(fileId, driveId)}/workbook/closeSession`)
          .header('workbook-session-id', response.id))
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
