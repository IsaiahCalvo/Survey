import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useMSGraph } from '../contexts/MSGraphContext';
import { supabase } from '../supabaseClient';
import Icon from '../Icons';
import './AccountSettings.css';

export const AccountSettings = ({ isOpen, onClose }) => {
  const { user, updateProfile, updatePassword, signOut, signInWithGoogle } = useAuth();
  const { isAuthenticated: isMSAuthenticated, login: msLogin, logout: msLogout, account: msAccount, needsReconnect: msNeedsReconnect } = useMSGraph();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab('general');
      setIsEditing(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setMessage('');
    }
  }, [isOpen]);

  // Update form fields when user data changes
  useEffect(() => {
    if (user) {
      setFirstName(user?.user_metadata?.first_name || '');
      setLastName(user?.user_metadata?.last_name || '');
      setEmail(user?.email || '');
    }
  }, [user]);

  // Sync Microsoft account data if user profile is incomplete
  // Note: Microsoft connection persistence is now handled by MSGraphContext using the connected_services table
  useEffect(() => {
    if (isMSAuthenticated && msAccount && user) {
      const hasName = user.user_metadata?.first_name || user.user_metadata?.last_name;

      if (!hasName) {
        const msName = msAccount.name || msAccount.username;

        if (msName) {
          const parts = msName.split(' ');
          if (parts.length > 0) {
            const newFirstName = parts[0];
            const newLastName = parts.length > 1 ? parts[parts.length - 1] : '';

            updateProfile({
              first_name: newFirstName,
              last_name: newLastName,
              full_name: msName
            }).then(() => {
              setFirstName(newFirstName);
              setLastName(newLastName);
            }).catch(err => {
              console.error('Failed to sync Microsoft profile:', err);
            });
          }
        }
      }
    }
  }, [isMSAuthenticated, msAccount, user, updateProfile]);

  if (!isOpen) return null;

  const handleSaveChanges = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    const changedFields = [];

    try {
      // Check if name changed
      const nameChanged =
        firstName !== user?.user_metadata?.first_name ||
        lastName !== user?.user_metadata?.last_name;

      // Check if password fields are filled
      const passwordChanging = newPassword || confirmPassword || currentPassword;

      // Validate password change if attempting
      if (passwordChanging) {
        if (!currentPassword) {
          setError('Please enter your current password to change your password');
          setLoading(false);
          return;
        }

        if (!newPassword) {
          setError('Please enter a new password');
          setLoading(false);
          return;
        }

        if (newPassword !== confirmPassword) {
          setError('New passwords do not match');
          setLoading(false);
          return;
        }

        if (newPassword.length < 6) {
          setError('Password must be at least 6 characters');
          setLoading(false);
          return;
        }
      }

      // Update name if changed
      if (nameChanged) {
        await updateProfile({
          first_name: firstName,
          last_name: lastName,
          full_name: `${firstName} ${lastName}`
        });
        changedFields.push('name');
      }

      // Update password if changing
      if (passwordChanging) {
        await updatePassword(newPassword);
        changedFields.push('password');
      }

      if (changedFields.length === 0) {
        setError('No changes detected');
        setLoading(false);
        return;
      }

      // Send email notification about changed fields
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-profile-change-notification`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ changedFields }),
            }
          );

          if (!response.ok) {
            console.error('Failed to send notification email');
          }
        }
      } catch (emailError) {
        console.error('Error sending notification email:', emailError);
        // Don't fail the whole operation if email fails
      }

      const changedText = changedFields.join(' and ');
      setMessage(`Your ${changedText} has been updated successfully! A confirmation email has been sent.`);

      // Reset form
      setIsEditing(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelEdit = () => {
    // Reset to original values
    setFirstName(user?.user_metadata?.first_name || '');
    setLastName(user?.user_metadata?.last_name || '');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setIsEditing(false);
    setError('');
    setMessage('');
  };

  const handleDeleteAccount = async () => {
    setError('');
    setLoading(true);

    try {
      // Note: Supabase doesn't have a built-in user deletion from client
      // You'll need to create a Supabase Edge Function or use admin API
      // For now, we'll just sign out
      setError('Account deletion must be implemented on the server. Please contact support.');
      setShowDeleteConfirm(false);
    } catch (err) {
      setError(err.message || 'Failed to delete account');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to sign out');
    }
  };

  return (
    <div className="account-settings-overlay" onClick={onClose}>
      <div className="account-settings-modal" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', maxWidth: '800px', width: '90%', height: '80vh', maxHeight: '700px', padding: 0 }}>

        {/* Header */}
        <div className="account-settings-header" style={{ padding: '20px 24px', borderBottom: '1px solid #333' }}>
          <h2 style={{ margin: 0 }}>Settings</h2>
          <button className="account-settings-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar */}
          <div style={{ width: '200px', borderRight: '1px solid #333', background: '#252525', display: 'flex', flexDirection: 'column' }}>
            <button
              onClick={() => setActiveTab('general')}
              style={{
                padding: '12px 20px',
                textAlign: 'left',
                background: activeTab === 'general' ? 'rgba(255,255,255,0.05)' : 'transparent',
                border: 'none',
                borderLeft: activeTab === 'general' ? '3px solid #4A90E2' : '3px solid transparent',
                color: activeTab === 'general' ? '#fff' : '#aaa',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500'
              }}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab('connected-services')}
              style={{
                padding: '12px 20px',
                textAlign: 'left',
                background: activeTab === 'connected-services' ? 'rgba(255,255,255,0.05)' : 'transparent',
                border: 'none',
                borderLeft: activeTab === 'connected-services' ? '3px solid #4A90E2' : '3px solid transparent',
                color: activeTab === 'connected-services' ? '#fff' : '#aaa',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500'
              }}
            >
              Connected Services
            </button>
            <button
              onClick={() => setActiveTab('subscription')}
              style={{
                padding: '12px 20px',
                textAlign: 'left',
                background: activeTab === 'subscription' ? 'rgba(255,255,255,0.05)' : 'transparent',
                border: 'none',
                borderLeft: activeTab === 'subscription' ? '3px solid #4A90E2' : '3px solid transparent',
                color: activeTab === 'subscription' ? '#fff' : '#aaa',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500'
              }}
            >
              Manage Subscription
            </button>
          </div>

          {/* Content */}
          <div className="account-settings-content" style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
            {error && <div className="account-error">{error}</div>}
            {message && <div className="account-message">{message}</div>}

            {activeTab === 'general' && (
              <>
                {/* Profile Section */}
                <section className="account-section">
                  <h3>Profile Information</h3>

                  {!isEditing ? (
                    /* View Mode */
                    <div>
                      <div className="account-form-group">
                        <label>First Name</label>
                        <div className={`account-field-display ${!firstName ? 'account-field-display-empty' : ''}`}>
                          {firstName || 'Not set'}
                        </div>
                      </div>

                      <div className="account-form-group">
                        <label>Last Name</label>
                        <div className={`account-field-display ${!lastName ? 'account-field-display-empty' : ''}`}>
                          {lastName || 'Not set'}
                        </div>
                      </div>

                      <div className="account-form-group">
                        <label>Email</label>
                        <div className="account-field-display">
                          {email}
                        </div>
                        <div className="account-field-hint">
                          Email cannot be changed
                        </div>
                      </div>

                      <button
                        onClick={() => setIsEditing(true)}
                        className="account-btn-primary"
                      >
                        Edit Profile
                      </button>
                    </div>
                  ) : (
                    /* Edit Mode */
                    <form onSubmit={handleSaveChanges}>
                      <div className="account-form-row">
                        <div className="account-form-group">
                          <label htmlFor="firstName">First Name</label>
                          <input
                            id="firstName"
                            type="text"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            required
                            disabled={loading}
                            autoComplete="given-name"
                          />
                        </div>

                        <div className="account-form-group">
                          <label htmlFor="lastName">Last Name</label>
                          <input
                            id="lastName"
                            type="text"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            required
                            disabled={loading}
                            autoComplete="family-name"
                          />
                        </div>
                      </div>

                      <div className="account-form-group">
                        <label htmlFor="email">Email</label>
                        <input
                          id="email"
                          type="email"
                          value={email}
                          disabled
                          title="Email cannot be changed"
                          autoComplete="email"
                        />
                        <div className="account-field-hint">
                          Email cannot be changed
                        </div>
                      </div>

                      <hr className="account-divider" />

                      <div className="account-subsection">
                        <div className="account-subsection-header">
                          <div className="account-subsection-title">Change Password (Optional)</div>
                          <p className="account-subsection-description">
                            Leave blank if you don't want to change your password
                          </p>
                        </div>

                        <div className="account-form-group">
                          <label htmlFor="currentPassword">Current Password</label>
                          <input
                            id="currentPassword"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="Required to change password"
                            disabled={loading}
                            autoComplete="current-password"
                          />
                        </div>

                        <div className="account-form-group">
                          <label htmlFor="newPassword">New Password</label>
                          <input
                            id="newPassword"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="••••••••"
                            disabled={loading}
                            autoComplete="new-password"
                          />
                        </div>

                        <div className="account-form-group">
                          <label htmlFor="confirmPassword">Confirm New Password</label>
                          <input
                            id="confirmPassword"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="••••••••"
                            disabled={loading}
                            autoComplete="new-password"
                          />
                        </div>
                      </div>

                      <div className="account-btn-group">
                        <button type="submit" className="account-btn-primary" disabled={loading}>
                          {loading ? 'Saving...' : 'Save Changes'}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className="account-btn-secondary"
                          disabled={loading}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </section>

                {/* Danger Zone */}
                <section className="account-section account-danger-zone">
                  {!showDeleteConfirm ? (
                    <>
                      <button
                        className="account-btn-danger"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={loading}
                      >
                        Delete Account
                      </button>
                      <p className="account-danger-zone-description">
                        Permanently delete your account. This action cannot be undone.
                      </p>
                    </>
                  ) : (
                    <div className="account-delete-confirm">
                      <p className="account-delete-confirm-title">
                        Are you absolutely sure?
                      </p>
                      <p className="account-delete-confirm-description">
                        This will permanently delete your account and all associated data. This action cannot be undone.
                      </p>
                      <div className="account-delete-confirm-actions">
                        <button
                          className="account-btn-danger"
                          onClick={handleDeleteAccount}
                          disabled={loading}
                        >
                          Yes, Delete My Account
                        </button>
                        <button
                          className="account-btn-secondary"
                          onClick={() => setShowDeleteConfirm(false)}
                          disabled={loading}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {/* Sign Out Section */}
                <section className="account-section">
                  <button
                    className="account-btn-secondary account-btn-secondary-full"
                    onClick={handleSignOut}
                  >
                    Sign Out
                  </button>
                </section>
              </>
            )}

            {activeTab === 'subscription' && (
              <section className="account-section">
                <h3>Manage Subscription</h3>

                <div className="account-subscription-grid">
                  {/* Free Plan */}
                  <div className="account-subscription-card">
                    <div className="account-subscription-header">
                      <div className="account-plan-name">Free Plan</div>
                      <div className="account-subscription-price">
                        <span className="price-amount">$0</span>
                        <span className="price-period">/month</span>
                      </div>
                    </div>
                    <div className="account-subscription-features">
                      <ul>
                        <li>Basic survey features</li>
                        <li>Export to Excel</li>
                        <li>5 Projects limit</li>
                      </ul>
                    </div>
                    <div className="account-subscription-actions">
                      <button className="account-btn-outline-green" disabled>
                        Current Plan
                      </button>
                    </div>
                  </div>

                  {/* Pro Plan */}
                  <div className="account-subscription-card">
                    <div className="account-subscription-header">
                      <div className="account-plan-info-row">
                        <span className="account-plan-name">Pro Plan</span>
                        <span className="account-plan-badge-text">(Recommended)</span>
                      </div>
                      <div className="account-subscription-price">
                        <span className="price-amount">$29</span>
                        <span className="price-period">/month</span>
                      </div>
                    </div>
                    <div className="account-subscription-features">
                      <ul>
                        <li>Unlimited Projects</li>
                        <li>Advanced Analytics</li>
                        <li>Priority Support</li>
                        <li>Custom Branding</li>
                      </ul>
                    </div>
                    <div className="account-subscription-actions">
                      <button className="account-btn-purple">
                        Upgrade to Pro
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'connected-services' && (
              <section className="account-section">
                <h3>Connected Services</h3>
                <p className="account-section-description">
                  Manage your connections to external services.
                </p>

                {/* Microsoft OneDrive */}
                <div className="account-connected-account">
                  <div className="account-connected-account-info">
                    <div className="account-connected-account-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24">
                        <path fill="#f25022" d="M0 0h11.377v11.372H0z" />
                        <path fill="#00a4ef" d="M12.623 0H24v11.372H12.623z" />
                        <path fill="#7fba00" d="M0 12.628h11.377V24H0z" />
                        <path fill="#ffb900" d="M12.623 12.628H24V24H12.623z" />
                      </svg>
                    </div>
                    <div className="account-connected-account-details">
                      <div className="account-connected-account-name">Microsoft</div>
                      {isMSAuthenticated ? (
                        <div className="account-connected-account-status account-connected-account-status-connected">
                          Connected as {msAccount?.username || msAccount?.email || msAccount?.name}
                        </div>
                      ) : msNeedsReconnect ? (
                        <div className="account-connected-account-status" style={{ color: '#f59e0b' }}>
                          Session expired. Click Reconnect to restore access.
                        </div>
                      ) : (
                        <div className="account-connected-account-status">
                          Not connected. Connect to sync exported surveys
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="account-connected-account-actions">
                    {isMSAuthenticated ? (
                      <button
                        className="account-btn-secondary"
                        onClick={async () => {
                          try {
                            await msLogout();
                          } catch (err) {
                            setError('Failed to disconnect Microsoft account');
                          }
                        }}
                        disabled={loading}
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        className={msNeedsReconnect ? "account-btn-primary" : "account-btn-primary"}
                        onClick={async () => {
                          try {
                            await msLogin();
                          } catch (err) {
                            setError('Failed to connect Microsoft account');
                          }
                        }}
                        disabled={loading}
                        style={msNeedsReconnect ? { backgroundColor: '#f59e0b', borderColor: '#f59e0b' } : {}}
                      >
                        {msNeedsReconnect ? 'Reconnect' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Google Drive */}
                <div className="account-connected-account" style={{ marginTop: '16px' }}>
                  <div className="account-connected-account-info">
                    <div className="account-connected-account-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>
                    </div>
                    <div className="account-connected-account-details">
                      <div className="account-connected-account-name">Google</div>
                      {user?.app_metadata?.provider === 'google' || user?.identities?.some(id => id.provider === 'google') ? (
                        <div className="account-connected-account-status account-connected-account-status-connected">
                          Connected as {user.email}
                        </div>
                      ) : (
                        <div className="account-connected-account-status">
                          Not connected. Use as an alternative login method
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="account-connected-account-actions">
                    <button
                      className={user?.app_metadata?.provider === 'google' || user?.identities?.some(id => id.provider === 'google') ? "account-btn-secondary" : "account-btn-primary"}
                      onClick={user?.app_metadata?.provider === 'google' || user?.identities?.some(id => id.provider === 'google') ? signOut : signInWithGoogle}
                    >
                      {user?.app_metadata?.provider === 'google' || user?.identities?.some(id => id.provider === 'google') ? 'Disconnect' : 'Connect'}
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

