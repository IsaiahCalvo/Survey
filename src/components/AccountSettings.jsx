import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useMSGraph } from '../contexts/MSGraphContext';
import { supabase } from '../supabaseClient';
import Icon from '../Icons';
import StripeCheckout from './StripeCheckout';
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

  // Subscription state
  const [subscription, setSubscription] = useState(null);
  const [loadingSubscription, setLoadingSubscription] = useState(true);
  const [billingPeriod, setBillingPeriod] = useState('monthly');

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

  // Fetch subscription data
  const fetchSubscription = async () => {
    if (!user) return;

    setLoadingSubscription(true);
    try {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error) {
        console.error('Error fetching subscription:', error);
        // User might not have a subscription row yet (shouldn't happen after migration)
        setSubscription({ tier: 'free', status: 'active' });
      } else {
        setSubscription(data);
      }
    } catch (err) {
      console.error('Error:', err);
      setSubscription({ tier: 'free', status: 'active' });
    } finally {
      setLoadingSubscription(false);
    }
  };

  // Fetch subscription when modal opens
  useEffect(() => {
    if (isOpen && user) {
      fetchSubscription();
    }
  }, [isOpen, user]);

  // Refetch subscription when window regains focus (user returns from Stripe checkout)
  useEffect(() => {
    const handleFocus = () => {
      if (isOpen && user) {
        console.log('Window focused, refetching subscription data...');
        fetchSubscription();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isOpen, user]);

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
      <div className="account-settings-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="account-settings-header">
          <h2>Settings</h2>
          <button className="account-settings-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="account-settings-body">
          {/* Sidebar */}
          <div className="account-settings-sidebar">
            <button
              onClick={() => setActiveTab('general')}
              className={`account-sidebar-btn ${activeTab === 'general' ? 'active' : ''}`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab('connected-services')}
              className={`account-sidebar-btn ${activeTab === 'connected-services' ? 'active' : ''}`}
            >
              Connected Services
            </button>
            <button
              onClick={() => setActiveTab('subscription')}
              className={`account-sidebar-btn ${activeTab === 'subscription' ? 'active' : ''}`}
            >
              Manage Subscription
            </button>
          </div>

          {/* Content */}
          <div className="account-settings-content">
            {error && <div className="account-error">{error}</div>}
            {message && <div className="account-message">{message}</div>}

            {activeTab === 'general' && (
              <>
                {/* Profile Section */}
                <section className="account-section" style={{ height: '308px' }}>
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

                {loadingSubscription ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#888', fontSize: '13px' }}>
                    Loading subscription...
                  </div>
                ) : (
                  <>
                    {/* Consolidated Subscription Status Banner */}
                    {subscription && subscription.tier !== 'free' && (
                      <div style={{
                        background: subscription.tier === 'developer' ? 'rgba(147, 51, 234, 0.08)' : subscription.status === 'trialing' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(34, 197, 94, 0.08)',
                        border: `1px solid ${subscription.tier === 'developer' ? 'rgba(147, 51, 234, 0.2)' : subscription.status === 'trialing' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(34, 197, 94, 0.2)'}`,
                        borderRadius: '6px',
                        padding: '10px 14px',
                        marginBottom: '16px',
                        fontSize: '12px',
                        lineHeight: '1.5'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: subscription.status === 'trialing' && subscription.trial_ends_at ? '4px' : '0' }}>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: subscription.tier === 'developer' ? '#a855f7' : subscription.status === 'trialing' ? '#3b82f6' : '#22c55e' }}>
                            {subscription.tier === 'developer' ? '🔧 Developer Account' : subscription.status === 'trialing' ? '🎉 Trial Active' : '✅ Active Subscription'}
                          </span>
                          <span style={{ color: '#888', fontSize: '12px' }}>
                            {subscription.tier === 'developer' ? (
                              'Unlimited access for testing and development'
                            ) : subscription.status === 'trialing' && subscription.trial_ends_at ? (
                              `Trial ends ${(() => {
                                const daysLeft = Math.ceil((new Date(subscription.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24));
                                return daysLeft > 0 ? `in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}` : 'today';
                              })()}`
                            ) : (
                              `${subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1)} Plan${subscription.status === 'past_due' ? ' • Payment Failed' : ''}`
                            )}
                          </span>
                        </div>
                        {subscription.status === 'trialing' && subscription.trial_ends_at && (
                          <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                            No payment required yet. You'll only be charged if you don't cancel before {new Date(subscription.trial_ends_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Billing Period Toggle (only show for paid users selecting new plan) */}
                    {subscription?.tier === 'free' && (
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '16px', background: '#222', padding: '4px', borderRadius: '8px', width: 'fit-content', margin: '0 auto 16px auto' }}>
                        <button
                          onClick={() => setBillingPeriod('monthly')}
                          style={{
                            padding: '8px 24px',
                            border: 'none',
                            borderRadius: '6px',
                            background: billingPeriod === 'monthly' ? '#4A90E2' : 'transparent',
                            color: billingPeriod === 'monthly' ? '#fff' : '#aaa',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: '500',
                            transition: 'all 0.2s'
                          }}
                        >
                          Monthly
                        </button>
                        <button
                          onClick={() => setBillingPeriod('annual')}
                          style={{
                            padding: '8px 24px',
                            border: 'none',
                            borderRadius: '6px',
                            background: billingPeriod === 'annual' ? '#4A90E2' : 'transparent',
                            color: billingPeriod === 'annual' ? '#fff' : '#aaa',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: '500',
                            transition: 'all 0.2s',
                            position: 'relative'
                          }}
                        >
                          Annual
                          <span style={{
                            fontSize: '11px',
                            marginLeft: '6px',
                            padding: '2px 6px',
                            background: 'rgba(34, 197, 94, 0.2)',
                            color: '#22c55e',
                            borderRadius: '4px',
                            fontWeight: '600'
                          }}>
                            Save 17%
                          </span>
                        </button>
                      </div>
                    )}

                    <div className="account-subscription-grid">
                      {/* Free Plan */}
                      <div className="account-subscription-card" style={{
                        border: subscription?.tier === 'free' ? '2px solid #22c55e' : '1px solid #333',
                        opacity: subscription?.tier === 'free' ? 1 : 0.7
                      }}>
                        <div className="account-subscription-header">
                          <div className="account-plan-name">Free</div>
                          <div className="account-subscription-price">
                            <span className="price-amount">$0</span>
                            <span className="price-period">/month</span>
                          </div>
                        </div>
                        <div className="account-subscription-features">
                          <ul>
                            <li>1 Project</li>
                            <li>5 Documents</li>
                            <li>100MB Storage</li>
                            <li>Basic Annotations</li>
                            <li>PDF Viewer</li>
                          </ul>
                        </div>
                        <div className="account-subscription-actions">
                          {subscription?.tier === 'free' ? (
                            <button className="account-btn-outline-green" disabled>
                              Current Plan
                            </button>
                          ) : subscription?.tier === 'developer' ? (
                            <button className="account-btn-secondary" disabled style={{ opacity: 0.5 }}>
                              Developer Account
                            </button>
                          ) : (
                            <button className="account-btn-secondary" disabled style={{ opacity: 0.5 }}>
                              Downgrade Available
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Pro Plan */}
                      <div className="account-subscription-card" style={{
                        border: (subscription?.tier === 'pro' || subscription?.status === 'trialing') ? '2px solid #4A90E2' : '1px solid #333',
                        opacity: (subscription?.tier === 'free' || subscription?.tier === 'enterprise' || subscription?.tier === 'developer') ? (subscription?.tier === 'free' ? 1 : 0.7) : 1
                      }}>
                        <div className="account-subscription-header">
                          <div className="account-plan-info-row">
                            <span className="account-plan-name">Pro</span>
                            {subscription?.tier !== 'pro' && subscription?.tier !== 'enterprise' && subscription?.tier !== 'developer' && (
                              <span className="account-plan-badge-text">(Recommended)</span>
                            )}
                          </div>
                          <div className="account-subscription-price">
                            {billingPeriod === 'annual' && subscription?.tier === 'free' ? (
                              <>
                                <span className="price-amount">$99</span>
                                <span className="price-period">/year</span>
                                <div style={{ fontSize: '12px', color: '#888', marginTop: '4px', whiteSpace: 'nowrap' }}>
                                  <span style={{ textDecoration: 'line-through' }}>$119.88</span> Save $20
                                </div>
                              </>
                            ) : (
                              <>
                                <span className="price-amount">$9.99</span>
                                <span className="price-period">/month</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="account-subscription-features">
                          <ul>
                            <li>Unlimited Projects</li>
                            <li>Unlimited Documents</li>
                            <li>10GB Storage</li>
                            <li>Survey Tools</li>
                            <li>Templates & Regions</li>
                            <li>Excel Export</li>
                            <li>OneDrive Integration</li>
                          </ul>
                        </div>
                        <div className="account-subscription-actions">
                          {subscription?.tier === 'pro' ? (
                            <button className="account-btn-outline-green" disabled>
                              Current Plan
                            </button>
                          ) : subscription?.tier === 'developer' ? (
                            <button className="account-btn-secondary" disabled style={{ opacity: 0.5 }}>
                              Developer Account
                            </button>
                          ) : subscription?.tier === 'enterprise' ? (
                            <button className="account-btn-secondary" disabled style={{ opacity: 0.5 }}>
                              On Higher Plan
                            </button>
                          ) : (
                            <StripeCheckout
                              tier="pro"
                              billingPeriod={billingPeriod}
                              className="account-btn-purple"
                            >
                              {billingPeriod === 'annual' ? 'Start Annual Trial' : 'Start 7-Day Trial'}
                            </StripeCheckout>
                          )}
                        </div>
                      </div>

                      {/* Enterprise Plan */}
                      <div className="account-subscription-card" style={{
                        opacity: subscription?.tier === 'enterprise' ? 1 : subscription?.tier === 'developer' ? 0.7 : 1
                      }}>
                        <div className="account-subscription-header">
                          <div className="account-plan-name">Enterprise</div>
                          <div className="account-subscription-price">
                            <span className="price-amount">$20</span>
                            <span className="price-period">/user/mo</span>
                            <div style={{ fontSize: '12px', color: '#888', marginTop: '4px', whiteSpace: 'nowrap' }}>
                              Minimum 3 users
                            </div>
                          </div>
                        </div>
                        <div className="account-subscription-features">
                          <ul>
                            <li>Everything in Pro</li>
                            <li>Team Collaboration</li>
                            <li>Real-time Editing</li>
                            <li>1TB Team Storage</li>
                            <li>SSO & Admin Tools</li>
                            <li>Priority Support</li>
                            <li>Custom Integrations</li>
                          </ul>
                        </div>
                        <div className="account-subscription-actions">
                          {subscription?.tier === 'enterprise' ? (
                            <button className="account-btn-outline-green" disabled>
                              Current Plan
                            </button>
                          ) : subscription?.tier === 'developer' ? (
                            <button className="account-btn-secondary" disabled style={{ opacity: 0.5 }}>
                              Developer Account
                            </button>
                          ) : (
                            <button
                              className="account-btn-secondary"
                              onClick={() => window.open('mailto:support@yourcompany.com?subject=Enterprise Plan Inquiry', '_blank')}
                            >
                              Contact Sales
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
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

