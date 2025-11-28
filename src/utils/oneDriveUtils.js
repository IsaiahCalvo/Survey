/**
 * Uploads a file to OneDrive (Drive Item)
 * @param {Object} graphClient - The authenticated Microsoft Graph client
 * @param {string} fileId - The ID of the file to update (or parent folder ID for new file)
 * @param {ArrayBuffer} content - The file content
 * @param {string} fileName - The name of the file (required if creating new)
 */
export const uploadFileToOneDrive = async (graphClient, fileId, content, fileName) => {
    if (!graphClient) throw new Error("Graph client not initialized");

    try {
        // If fileId is provided, we update that specific file
        // If we were creating a new file, we'd use the parent folder ID and /children
        // For now, we assume we are updating an existing selected file
        const endpoint = `/me/drive/items/${fileId}/content`;

        await graphClient.api(endpoint)
            .put(content);

        return { success: true };
    } catch (error) {
        console.error("Error uploading to OneDrive:", error);
        return { success: false, error };
    }
};

/**
 * Downloads a file from OneDrive
 * @param {Object} graphClient - The authenticated Microsoft Graph client
 * @param {string} fileId - The ID of the file to download
 * @returns {ArrayBuffer} The file content
 */
export const downloadFileFromOneDrive = async (graphClient, fileId) => {
    if (!graphClient) throw new Error("Graph client not initialized");

    try {
        const response = await graphClient.api(`/me/drive/items/${fileId}/content`)
            .responseType('arraybuffer') // Important for binary data
            .get();

        return response;
    } catch (error) {
        console.error("Error downloading from OneDrive:", error);
        throw error;
    }
};
