// A drive link's names, for OneDrive / Google Drive save-back labels
// (Nightly flag 'drive-sync-back'; hooks/useDriveSyncBack.js).
const isGoogle = (link) => link?.provider === 'google';

/** 'Google Drive' or 'OneDrive', for a drive link. */
export const drivePlace = (link) => (isGoogle(link) ? 'Google Drive' : 'OneDrive');
/** The sign-in behind a drive link: 'Google' or 'Microsoft'. */
export const driveCompany = (link) => (isGoogle(link) ? 'Google' : 'Microsoft');
/** The Icons.jsx name for a drive link. */
export const driveIcon = (link) => (isGoogle(link) ? 'googleDrive' : 'oneDrive');
