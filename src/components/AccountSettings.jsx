import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import './AccountSettings.css';

export const AccountSettings = ({ isOpen, onClose }) => {
  const { user, updateProfile, updatePassword, signOut } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Update form fields when user data changes or modal opens
  useEffect(() => {
    if (user && isOpen) {
      setFirstName(user?.user_metadata?.first_name || '');
      setLastName(user?.user_metadata?.last_name || '');
      setEmail(user?.email || '');
      setIsEditing(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setMessage('');
    }
  }, [user, isOpen]);

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
      <div className="account-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="account-settings-header">
          <h2>Account Settings</h2>
          <button className="account-settings-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="account-settings-content">
          {error && <div className="account-error">{error}</div>}
          {message && <div className="account-message">{message}</div>}

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
        </div>
      </div>
    </div>
  );
};
