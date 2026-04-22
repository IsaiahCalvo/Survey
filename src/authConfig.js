/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { LogLevel } from "@azure/msal-browser";

/**
 * Configuration object to be passed to MSAL instance on creation. 
 * For a full list of MSAL.js configuration parameters, visit:
 * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/configuration.md 
 */
export const msalConfig = {
    auth: {
        // TODO: Replace with your actual Client ID from Azure Portal
        clientId: "0da81a9e-2b05-46ee-b826-5efc5114c765",
        // TODO: Replace with your actual Tenant ID (or "common" for multi-tenant)
        authority: "https://login.microsoftonline.com/common",
        redirectUri: "http://localhost:5173", // Must match the one registered in Azure
        postLogoutRedirectUri: "http://localhost:5173", // Redirect after logout
        navigateToLoginRequestUrl: true, // Return to original page after login
    },
    cache: {
        cacheLocation: "localStorage", // This configures where your cache will be stored
        storeAuthStateInCookie: false, // Set this to "true" if you are having issues on IE11 or Edge
    },
    system: {
        allowNativeBroker: false, // Disable native broker to prevent COOP issues
        windowHashTimeout: 60000, // Increase timeout for popup hash response
        iframeHashTimeout: 10000, // Timeout for iframe hash response
        loadFrameTimeout: 6000, // Timeout for loading iframes
        asyncPopups: true, // Use async popup handling for better COOP compatibility
        loggerOptions: {
            loggerCallback: (level, message, containsPii) => {
                if (containsPii) {
                    return;
                }
                switch (level) {
                    case LogLevel.Error:
                        console.error(message);
                        return;
                    case LogLevel.Warning:
                        // Suppress common MSAL warnings about COOP and iframes
                        if (message.includes('Cross-Origin-Opener-Policy') ||
                            message.includes('iframe') ||
                            message.includes('sandbox')) {
                            return;
                        }
                        console.warn(message);
                        return;
                    // Suppress Info and Verbose logs
                    case LogLevel.Info:
                    case LogLevel.Verbose:
                    default:
                        return;
                }
            }
        }
    }
};

/**
 * Scopes you add here will be prompted for user consent during sign-in.
 * By default, MSAL.js will add OIDC scopes (openid, profile, email) to any login request.
 * For more information about OIDC scopes, visit: 
 * https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-permissions-and-consent#openid-connect-scopes
 */
export const loginRequest = {
    scopes: ["User.Read", "Files.ReadWrite.All", "Sites.ReadWrite.All"]
};

/**
 * Add here the scopes to request when obtaining an access token for MS Graph API. For more information, see:
 * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/resources-and-scopes.md
 */
export const graphConfig = {
    graphMeEndpoint: "https://graph.microsoft.com/v1.0/me",
    graphFilesEndpoint: "https://graph.microsoft.com/v1.0/me/drive/root/children"
};
