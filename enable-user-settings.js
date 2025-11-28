// Run this in your browser console AFTER creating the user_settings table
// This will re-enable the user_settings feature

localStorage.setItem('userSettingsTableUnavailable', 'false');
console.log('✅ User settings re-enabled! Reload the page to activate.');
location.reload();
