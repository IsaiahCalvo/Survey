/**
 * OneDriveFolderBrowser.jsx — folder picker for My OneDrive and SharePoint document libraries.
 *
 * Default-exports OneDriveFolderBrowser. Drives navigation via excelGraphService
 * (listFolders / listDriveItems / listSharePointSites / listSiteDocumentLibraries),
 * with tabbed My-Drive vs SharePoint browsing, breadcrumbs, and loading/error states,
 * reporting the chosen destination through onFolderSelect. Embedded in OneDriveFileSaveModal.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { COLORS, TYPOGRAPHY, BORDERS } from '../theme';
import {
  listFolders,
  listDriveItems,
  listSharePointSites,
  listSiteDocumentLibraries
} from '../services/excelGraphService';

// Navigation source types
const SOURCE_TYPES = {
  MY_DRIVE: 'myDrive',
  SHAREPOINT: 'sharepoint',
  SHARED: 'shared'
};

// Icons and back button live at module scope so they keep a stable component
// identity across OneDriveFolderBrowser renders (defining them inside the body
// gave React a new type every render, remounting the whole tree).
const FolderIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.text.muted} strokeWidth="2">
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SiteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.text.muted} strokeWidth="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round"/>
    <polyline points="9,22 9,12 15,12 15,22" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const LibraryIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.text.muted} strokeWidth="2">
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const BackButton = ({ onClick, label }) => (
  <button
    onClick={onClick}
    onMouseEnter={(e) => {
      e.currentTarget.style.color = COLORS.modal.borderActive;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.color = COLORS.modal.textMuted;
    }}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 12px',
      background: 'transparent',
      border: 'none',
      color: COLORS.modal.textMuted,
      fontSize: TYPOGRAPHY.fontSize.sm,
      fontFamily: TYPOGRAPHY.fontFamily.default,
      cursor: 'pointer',
      marginBottom: '8px',
    }}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
    {label}
  </button>
);

const OneDriveFolderBrowser = ({
  graphClient,
  onFolderSelect,
  selectedPath = null,
  initialSource = SOURCE_TYPES.MY_DRIVE,
  ensureFreshToken,
}) => {
  const [activeSource, setActiveSource] = useState(initialSource);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Navigation state for My Drive
  const [currentPath, setCurrentPath] = useState('/');
  const [pathHistory, setPathHistory] = useState([{ path: '/', name: 'My files' }]);
  const [folders, setFolders] = useState([]);

  // Navigation state for SharePoint
  const [sharePointSites, setSharePointSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const [siteLibraries, setSiteLibraries] = useState([]);
  const [selectedLibrary, setSelectedLibrary] = useState(null);
  const [libraryFolders, setLibraryFolders] = useState([]);
  const [libraryPath, setLibraryPath] = useState([]);

  // Current selection info
  const [selectedFolder, setSelectedFolder] = useState(null);

  const refreshTokenOrThrow = useCallback(async () => {
    if (typeof ensureFreshToken !== 'function') return;
    let ok = false;
    try { ok = await ensureFreshToken(); } catch { ok = false; }
    if (!ok) throw new Error('Microsoft session expired. Reconnect and try again.');
  }, [ensureFreshToken]);

  // Load My Drive folders
  const loadMyDriveFolders = useCallback(async (path = '/') => {
    if (!graphClient) return;

    setLoading(true);
    setError(null);

    try {
      await refreshTokenOrThrow();
      const folderList = await listFolders(graphClient, path);
      setFolders(folderList);
      setCurrentPath(path);
    } catch (err) {
      console.error('Error loading folders:', err);
      setError('Failed to load folders. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [graphClient, refreshTokenOrThrow]);

  // Load SharePoint sites
  const loadSharePointSites = useCallback(async () => {
    if (!graphClient) return;

    setLoading(true);
    setError(null);

    try {
      await refreshTokenOrThrow();
      const sites = await listSharePointSites(graphClient);
      setSharePointSites(sites);
    } catch (err) {
      // Check if it's a personal Microsoft account (MSA) error - expected, no need to log
      if (err.message?.includes('MSA') || err.message?.includes('not supported')) {
        setError('SharePoint is not available for personal Microsoft accounts. Please use "My OneDrive" instead, or sign in with a Microsoft 365 Business account.');
      } else if (err.message?.includes('Access') || err.message?.includes('403') || err.message?.includes('denied')) {
        setError('SharePoint access not available. This feature requires a Microsoft 365 Business account.');
      } else {
        setError('Failed to load SharePoint sites. You may not have access to any sites.');
      }
      setSharePointSites([]);
    } finally {
      setLoading(false);
    }
  }, [graphClient, refreshTokenOrThrow]);

  // Load document libraries for a site
  const loadSiteLibraries = useCallback(async (siteId) => {
    if (!graphClient) return;

    setLoading(true);
    setError(null);

    try {
      await refreshTokenOrThrow();
      const libraries = await listSiteDocumentLibraries(graphClient, siteId);
      setSiteLibraries(libraries);
      setSelectedLibrary(null);
      setLibraryFolders([]);
      setLibraryPath([]);
    } catch (err) {
      console.error('Error loading document libraries:', err);
      setError('Failed to load document libraries. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [graphClient, refreshTokenOrThrow]);

  // Load folders within a library
  const loadLibraryFolders = useCallback(async (driveId, folderId = 'root') => {
    if (!graphClient) return;

    setLoading(true);
    setError(null);

    try {
      await refreshTokenOrThrow();
      const items = await listDriveItems(graphClient, driveId, folderId, true);
      setLibraryFolders(items);
    } catch (err) {
      console.error('Error loading library folders:', err);
      setError('Failed to load folders. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [graphClient, refreshTokenOrThrow]);

  // Initial load based on source
  useEffect(() => {
    if (activeSource === SOURCE_TYPES.MY_DRIVE) {
      loadMyDriveFolders('/');
    } else if (activeSource === SOURCE_TYPES.SHAREPOINT) {
      loadSharePointSites();
    }
  }, [activeSource, loadMyDriveFolders, loadSharePointSites]);

  // Handle folder click in My Drive
  const handleMyDriveFolderClick = (folder) => {
    const newPath = currentPath === '/' ? `/${folder.name}` : `${currentPath}/${folder.name}`;
    setPathHistory([...pathHistory, { path: newPath, name: folder.name }]);
    loadMyDriveFolders(newPath);

    // Update selection
    setSelectedFolder({
      type: SOURCE_TYPES.MY_DRIVE,
      path: newPath,
      name: folder.name,
      id: folder.id
    });

    if (onFolderSelect) {
      onFolderSelect({
        type: SOURCE_TYPES.MY_DRIVE,
        driveId: null,
        folderId: folder.id,
        folderPath: newPath,
        folderName: folder.name
      });
    }
  };

  // Handle breadcrumb click in My Drive
  const handleBreadcrumbClick = (index) => {
    const newHistory = pathHistory.slice(0, index + 1);
    const targetPath = newHistory[newHistory.length - 1].path;
    setPathHistory(newHistory);
    loadMyDriveFolders(targetPath);

    // Update selection
    if (index > 0) {
      setSelectedFolder({
        type: SOURCE_TYPES.MY_DRIVE,
        path: targetPath,
        name: newHistory[newHistory.length - 1].name
      });
    } else {
      setSelectedFolder({
        type: SOURCE_TYPES.MY_DRIVE,
        path: '/',
        name: 'My files'
      });
    }

    if (onFolderSelect) {
      onFolderSelect({
        type: SOURCE_TYPES.MY_DRIVE,
        driveId: null,
        folderId: null,
        folderPath: targetPath,
        folderName: newHistory[newHistory.length - 1].name
      });
    }
  };

  // Handle SharePoint site selection
  const handleSiteSelect = (site) => {
    setSelectedSite(site);
    loadSiteLibraries(site.id);
  };

  // Handle document library selection
  const handleLibrarySelect = (library) => {
    setSelectedLibrary(library);
    setLibraryPath([{ id: 'root', name: library.name }]);
    loadLibraryFolders(library.id, 'root');

    // Update selection
    setSelectedFolder({
      type: SOURCE_TYPES.SHAREPOINT,
      siteId: selectedSite.id,
      driveId: library.id,
      folderId: 'root',
      name: library.name
    });

    if (onFolderSelect) {
      onFolderSelect({
        type: SOURCE_TYPES.SHAREPOINT,
        siteId: selectedSite.id,
        siteName: selectedSite.displayName || selectedSite.name,
        driveId: library.id,
        driveName: library.name,
        folderId: 'root',
        folderPath: '/',
        folderName: library.name
      });
    }
  };

  // Handle folder click within a library
  const handleLibraryFolderClick = (folder) => {
    const newPath = [...libraryPath, { id: folder.id, name: folder.name }];
    setLibraryPath(newPath);
    loadLibraryFolders(selectedLibrary.id, folder.id);

    // Update selection
    setSelectedFolder({
      type: SOURCE_TYPES.SHAREPOINT,
      siteId: selectedSite.id,
      driveId: selectedLibrary.id,
      folderId: folder.id,
      name: folder.name
    });

    if (onFolderSelect) {
      onFolderSelect({
        type: SOURCE_TYPES.SHAREPOINT,
        siteId: selectedSite.id,
        siteName: selectedSite.displayName || selectedSite.name,
        driveId: selectedLibrary.id,
        driveName: selectedLibrary.name,
        folderId: folder.id,
        folderPath: newPath.map(p => p.name).join('/'),
        folderName: folder.name
      });
    }
  };

  // Handle library breadcrumb click
  const handleLibraryBreadcrumbClick = (index) => {
    const newPath = libraryPath.slice(0, index + 1);
    setLibraryPath(newPath);
    const targetFolderId = newPath[newPath.length - 1].id;
    loadLibraryFolders(selectedLibrary.id, targetFolderId);

    // Update selection
    setSelectedFolder({
      type: SOURCE_TYPES.SHAREPOINT,
      siteId: selectedSite.id,
      driveId: selectedLibrary.id,
      folderId: targetFolderId,
      name: newPath[newPath.length - 1].name
    });

    if (onFolderSelect) {
      onFolderSelect({
        type: SOURCE_TYPES.SHAREPOINT,
        siteId: selectedSite.id,
        siteName: selectedSite.displayName || selectedSite.name,
        driveId: selectedLibrary.id,
        driveName: selectedLibrary.name,
        folderId: targetFolderId,
        folderPath: newPath.map(p => p.name).join('/'),
        folderName: newPath[newPath.length - 1].name
      });
    }
  };

  // Go back to sites list
  const handleBackToSites = () => {
    setSelectedSite(null);
    setSiteLibraries([]);
    setSelectedLibrary(null);
    setLibraryFolders([]);
    setLibraryPath([]);
  };

  // Go back to libraries list
  const handleBackToLibraries = () => {
    setSelectedLibrary(null);
    setLibraryFolders([]);
    setLibraryPath([]);
  };

  return (
    <div style={{
      background: COLORS.background.tertiary,
      borderRadius: BORDERS.radius.md,
      overflow: 'hidden',
    }}>
      {/* Source tabs */}
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${COLORS.border.default}`,
      }}>
        <button
          onClick={() => setActiveSource(SOURCE_TYPES.MY_DRIVE)}
          onMouseEnter={(e) => {
            if (activeSource !== SOURCE_TYPES.MY_DRIVE) {
              e.currentTarget.style.borderBottom = `2px solid ${COLORS.modal.borderActive}`;
            }
          }}
          onMouseLeave={(e) => {
            if (activeSource !== SOURCE_TYPES.MY_DRIVE) {
              e.currentTarget.style.borderBottom = '2px solid transparent';
            }
          }}
          style={{
            flex: 1,
            padding: '12px',
            background: activeSource === SOURCE_TYPES.MY_DRIVE ? COLORS.background.elevated : 'transparent',
            border: 'none',
            borderBottom: activeSource === SOURCE_TYPES.MY_DRIVE ? `2px solid ${COLORS.modal.borderActive}` : '2px solid transparent',
            color: activeSource === SOURCE_TYPES.MY_DRIVE ? COLORS.text.secondary : COLORS.text.muted,
            fontSize: TYPOGRAPHY.fontSize.sm,
            fontWeight: TYPOGRAPHY.fontWeight.medium,
            fontFamily: TYPOGRAPHY.fontFamily.default,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          My OneDrive
        </button>
        <button
          onClick={() => setActiveSource(SOURCE_TYPES.SHAREPOINT)}
          onMouseEnter={(e) => {
            if (activeSource !== SOURCE_TYPES.SHAREPOINT) {
              e.currentTarget.style.borderBottom = `2px solid ${COLORS.modal.borderActive}`;
            }
          }}
          onMouseLeave={(e) => {
            if (activeSource !== SOURCE_TYPES.SHAREPOINT) {
              e.currentTarget.style.borderBottom = '2px solid transparent';
            }
          }}
          style={{
            flex: 1,
            padding: '12px',
            background: activeSource === SOURCE_TYPES.SHAREPOINT ? COLORS.background.elevated : 'transparent',
            border: 'none',
            borderBottom: activeSource === SOURCE_TYPES.SHAREPOINT ? `2px solid ${COLORS.modal.borderActive}` : '2px solid transparent',
            color: activeSource === SOURCE_TYPES.SHAREPOINT ? COLORS.text.secondary : COLORS.text.muted,
            fontSize: TYPOGRAPHY.fontSize.sm,
            fontWeight: TYPOGRAPHY.fontWeight.medium,
            fontFamily: TYPOGRAPHY.fontFamily.default,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          SharePoint sites
        </button>
      </div>

      {/* Content area */}
      <div style={{ minHeight: '300px', maxHeight: '400px', overflowY: 'auto' }}>
        {/* Error display */}
        {error && (
          <div style={{
            padding: '12px',
            margin: '12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: BORDERS.radius.md,
            color: '#ef4444',
            fontSize: TYPOGRAPHY.fontSize.sm,
            fontFamily: TYPOGRAPHY.fontFamily.default,
          }}>
            {error}
          </div>
        )}

        {/* Loading indicator */}
        {loading && (
          <div style={{
            padding: '40px',
            textAlign: 'center',
            color: COLORS.text.muted,
            fontSize: TYPOGRAPHY.fontSize.sm,
            fontFamily: TYPOGRAPHY.fontFamily.default,
          }}>
            Loading...
          </div>
        )}

        {/* My Drive content */}
        {!loading && activeSource === SOURCE_TYPES.MY_DRIVE && (
          <div style={{ padding: '12px' }}>
            {/* Breadcrumb */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginBottom: '12px',
              flexWrap: 'wrap',
            }}>
              {pathHistory.map((item, index) => (
                <React.Fragment key={item.path}>
                  {index > 0 && (
                    <span style={{ color: COLORS.text.muted }}>/</span>
                  )}
                  <button
                    onClick={() => handleBreadcrumbClick(index)}
                    onMouseEnter={(e) => {
                      if (index !== pathHistory.length - 1) {
                        e.currentTarget.style.color = COLORS.modal.borderActive;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (index !== pathHistory.length - 1) {
                        e.currentTarget.style.color = COLORS.modal.textMuted;
                      }
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: index === pathHistory.length - 1 ? COLORS.text.secondary : COLORS.modal.textMuted,
                      fontSize: TYPOGRAPHY.fontSize.sm,
                      fontFamily: TYPOGRAPHY.fontFamily.default,
                      cursor: 'pointer',
                      padding: '4px 8px',
                      borderRadius: BORDERS.radius.sm,
                    }}
                  >
                    {item.name}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {/* Folder list */}
            {folders.length === 0 ? (
              <div style={{
                padding: '40px',
                textAlign: 'center',
                color: COLORS.text.muted,
                fontSize: TYPOGRAPHY.fontSize.sm,
                fontFamily: TYPOGRAPHY.fontFamily.default,
              }}>
                No folders found
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => handleMyDriveFolderClick(folder)}
                    onMouseEnter={(e) => {
                      if (selectedFolder?.id !== folder.id) {
                        e.currentTarget.style.background = COLORS.modal.panelHover;
                        e.currentTarget.style.borderColor = COLORS.modal.borderActive;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedFolder?.id !== folder.id) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.borderColor = 'transparent';
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 12px',
                      background: selectedFolder?.id === folder.id ? COLORS.modal.optionSelectedBg : 'transparent',
                      border: `1px solid ${selectedFolder?.id === folder.id ? COLORS.modal.optionSelectedBorder : 'transparent'}`,
                      borderRadius: BORDERS.radius.md,
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <FolderIcon />
                    <span style={{
                      color: COLORS.text.secondary,
                      fontSize: TYPOGRAPHY.fontSize.md,
                      fontFamily: TYPOGRAPHY.fontFamily.default,
                    }}>
                      {folder.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SharePoint content */}
        {!loading && activeSource === SOURCE_TYPES.SHAREPOINT && (
          <div style={{ padding: '12px' }}>
            {/* Sites list */}
            {!selectedSite && (
              <>
                {sharePointSites.length === 0 && !error ? (
                  <div style={{
                    padding: '40px',
                    textAlign: 'center',
                    color: COLORS.text.muted,
                    fontSize: TYPOGRAPHY.fontSize.sm,
                    fontFamily: TYPOGRAPHY.fontFamily.default,
                  }}>
                    <div style={{ marginBottom: '8px' }}>No SharePoint sites available</div>
                    <div style={{ fontSize: TYPOGRAPHY.fontSize.xs, opacity: 0.7 }}>
                      SharePoint requires a Microsoft 365 Business account.
                      <br />
                      Use "My OneDrive" for personal accounts.
                    </div>
                  </div>
                ) : sharePointSites.length === 0 ? null : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {sharePointSites.map((site) => (
                      <button
                        key={site.id}
                        onClick={() => handleSiteSelect(site)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = COLORS.modal.panelHover;
                          e.currentTarget.style.borderColor = COLORS.modal.borderActive;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.borderColor = 'transparent';
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '10px 12px',
                          background: 'transparent',
                          border: '1px solid transparent',
                          borderRadius: BORDERS.radius.md,
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <SiteIcon />
                        <span style={{
                          color: COLORS.text.secondary,
                          fontSize: TYPOGRAPHY.fontSize.md,
                          fontFamily: TYPOGRAPHY.fontFamily.default,
                        }}>
                          {site.displayName || site.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Libraries list */}
            {selectedSite && !selectedLibrary && (
              <>
                <BackButton onClick={handleBackToSites} label="Back to sites" />
                <div style={{
                  fontSize: TYPOGRAPHY.fontSize.sm,
                  fontWeight: TYPOGRAPHY.fontWeight.medium,
                  color: COLORS.text.muted,
                  marginBottom: '12px',
                  fontFamily: TYPOGRAPHY.fontFamily.default,
                }}>
                  {selectedSite.displayName || selectedSite.name} - Document Libraries
                </div>
                {siteLibraries.length === 0 ? (
                  <div style={{
                    padding: '40px',
                    textAlign: 'center',
                    color: COLORS.text.muted,
                    fontSize: TYPOGRAPHY.fontSize.sm,
                    fontFamily: TYPOGRAPHY.fontFamily.default,
                  }}>
                    No document libraries found
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {siteLibraries.map((library) => (
                      <button
                        key={library.id}
                        onClick={() => handleLibrarySelect(library)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = COLORS.modal.panelHover;
                          e.currentTarget.style.borderColor = COLORS.modal.borderActive;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.borderColor = 'transparent';
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '10px 12px',
                          background: 'transparent',
                          border: '1px solid transparent',
                          borderRadius: BORDERS.radius.md,
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <LibraryIcon />
                        <span style={{
                          color: COLORS.text.secondary,
                          fontSize: TYPOGRAPHY.fontSize.md,
                          fontFamily: TYPOGRAPHY.fontFamily.default,
                        }}>
                          {library.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Folders within a library */}
            {selectedLibrary && (
              <>
                <BackButton onClick={handleBackToLibraries} label="Back to libraries" />

                {/* Library breadcrumb */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginBottom: '12px',
                  flexWrap: 'wrap',
                }}>
                  {libraryPath.map((item, index) => (
                    <React.Fragment key={item.id}>
                      {index > 0 && (
                        <span style={{ color: COLORS.text.muted }}>/</span>
                      )}
                      <button
                        onClick={() => handleLibraryBreadcrumbClick(index)}
                        onMouseEnter={(e) => {
                          if (index !== libraryPath.length - 1) {
                            e.currentTarget.style.color = COLORS.modal.borderActive;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (index !== libraryPath.length - 1) {
                            e.currentTarget.style.color = COLORS.modal.textMuted;
                          }
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: index === libraryPath.length - 1 ? COLORS.text.secondary : COLORS.modal.textMuted,
                          fontSize: TYPOGRAPHY.fontSize.sm,
                          fontFamily: TYPOGRAPHY.fontFamily.default,
                          cursor: 'pointer',
                          padding: '4px 8px',
                          borderRadius: BORDERS.radius.sm,
                        }}
                      >
                        {item.name}
                      </button>
                    </React.Fragment>
                  ))}
                </div>

                {/* Folder list */}
                {libraryFolders.length === 0 ? (
                  <div style={{
                    padding: '40px',
                    textAlign: 'center',
                    color: COLORS.text.muted,
                    fontSize: TYPOGRAPHY.fontSize.sm,
                    fontFamily: TYPOGRAPHY.fontFamily.default,
                  }}>
                    No folders found - you can save here
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {libraryFolders.map((folder) => (
                      <button
                        key={folder.id}
                        onClick={() => handleLibraryFolderClick(folder)}
                        onMouseEnter={(e) => {
                          if (selectedFolder?.folderId !== folder.id) {
                            e.currentTarget.style.background = COLORS.modal.panelHover;
                            e.currentTarget.style.borderColor = COLORS.modal.borderActive;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (selectedFolder?.folderId !== folder.id) {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.borderColor = 'transparent';
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '10px 12px',
                          background: selectedFolder?.folderId === folder.id ? COLORS.modal.optionSelectedBg : 'transparent',
                          border: `1px solid ${selectedFolder?.folderId === folder.id ? COLORS.modal.optionSelectedBorder : 'transparent'}`,
                          borderRadius: BORDERS.radius.md,
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <FolderIcon />
                        <span style={{
                          color: COLORS.text.secondary,
                          fontSize: TYPOGRAPHY.fontSize.md,
                          fontFamily: TYPOGRAPHY.fontFamily.default,
                        }}>
                          {folder.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default OneDriveFolderBrowser;
