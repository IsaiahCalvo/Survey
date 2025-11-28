import React from 'react';
import { useMSGraph } from '../contexts/MSGraphContext';

import oneDriveLogo from './onedrive-logo.png';

export const OneDriveConnectButton = ({ onConnect }) => {
    const { isAuthenticated, login, logout, account, isLoading } = useMSGraph();

    if (isLoading) {
        return <button disabled className="px-4 py-2 bg-gray-200 rounded text-gray-500">Loading...</button>;
    }

    if (isAuthenticated) {
        return (
            <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Connected as {account.name}</span>
                <button
                    onClick={onConnect}
                    className="px-3 py-1.5 text-sm bg-blue-50 text-blue-600 hover:bg-blue-100 rounded border border-blue-200 transition-colors"
                >
                    Select File
                </button>
                <button
                    onClick={logout}
                    className="px-3 py-1.5 text-sm bg-red-50 text-red-600 hover:bg-red-100 rounded border border-red-200 transition-colors"
                >
                    Disconnect
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={login}
            className="p-2 hover:opacity-80 transition-opacity"
            title="Connect to OneDrive"
        >
            <img
                src={oneDriveLogo}
                alt="OneDrive"
                className="w-10 h-10 object-contain"
                style={{ width: '40px', height: '40px', objectFit: 'contain' }}
            />
        </button>
    );
};
