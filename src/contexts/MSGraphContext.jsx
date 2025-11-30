import React, { createContext, useContext, useState, useEffect } from 'react';
import { PublicClientApplication } from '@azure/msal-browser';
import { Client } from '@microsoft/microsoft-graph-client';
import { msalConfig, loginRequest } from '../authConfig';

const MSGraphContext = createContext({});

export const useMSGraph = () => {
    const context = useContext(MSGraphContext);
    if (!context) {
        throw new Error('useMSGraph must be used within a MSGraphProvider');
    }
    return context;
};

export const MSGraphProvider = ({ children }) => {
    const [msalInstance, setMsalInstance] = useState(null);
    const [account, setAccount] = useState(null);
    const [graphClient, setGraphClient] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // Initialize MSAL
    useEffect(() => {
        const initializeMsal = async () => {
            try {
                const pca = new PublicClientApplication(msalConfig);
                await pca.initialize();
                setMsalInstance(pca);

                // Check if user is already signed in
                const accounts = pca.getAllAccounts();
                if (accounts.length > 0) {
                    setAccount(accounts[0]);
                    setIsAuthenticated(true);
                    initializeGraphClient(pca, accounts[0]);
                }
            } catch (err) {
                console.error("MSAL Initialization Error:", err);
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        initializeMsal();
    }, []);

    const initializeGraphClient = (pca, account) => {
        const client = Client.init({
            authProvider: async (done) => {
                try {
                    const response = await pca.acquireTokenSilent({
                        ...loginRequest,
                        account: account
                    });
                    done(null, response.accessToken);
                } catch (error) {
                    console.error("Silent token acquisition failed, trying popup", error);
                    try {
                        const response = await pca.acquireTokenPopup({
                            ...loginRequest,
                            account: account
                        });
                        done(null, response.accessToken);
                    } catch (err) {
                        console.error("Popup token acquisition failed", err);
                        done(err, null);
                    }
                }
            }
        });
        setGraphClient(client);
    };

    const login = async () => {
        if (!msalInstance) return;
        try {
            const response = await msalInstance.loginPopup(loginRequest);
            if (response && response.account) {
                setAccount(response.account);
                setIsAuthenticated(true);
                initializeGraphClient(msalInstance, response.account);
            }
        } catch (err) {
            console.error("Login failed", err);
            setError(err.message);
        }
    };

    const logout = async () => {
        if (!msalInstance) return;
        try {
            await msalInstance.logoutPopup({
                postLogoutRedirectUri: window.location.origin
            });
            setAccount(null);
            setIsAuthenticated(false);
            setGraphClient(null);
        } catch (err) {
            console.error("Logout failed", err);
            setError(err.message);
        }
    };

    const value = {
        msalInstance,
        account,
        graphClient,
        isAuthenticated,
        isLoading,
        error,
        login,
        logout
    };

    return <MSGraphContext.Provider value={value}>{children}</MSGraphContext.Provider>;
};
