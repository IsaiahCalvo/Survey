/**
 * AccountSettings.jsx — modal for profile, connected services, and subscription management.
 *
 * Named export `AccountSettings` ({ isOpen, onClose }); a tabbed modal driven
 * by useAuth + useMSGraph. General tab edits name/password and deletes account;
 * Connected Services links Microsoft/Google; Subscription shows Free/Pro/
 * Enterprise plans, reads `user_subscriptions` from Supabase, and launches
 * StripeCheckout / the billing portal. Embeds <UsageIndicator/> on the Usage tab.
 */
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useMSGraph } from '../contexts/MSGraphContext';
import { getSupabaseSession, supabase } from '../supabaseClient';
import StripeCheckout from './StripeCheckout';
import UsageIndicator from './UsageIndicator';
import './AccountSettings.css';
import PasswordRequirements from './PasswordRequirements';
import Spinner from './Spinner';
import { passwordMeetsRequirements } from './authFlow';
import TurnstileWidget, { TURNSTILE_ENABLED } from './TurnstileWidget';
import Icon from '../Icons';
import {
  buildBillingReturnUrl,
  canUnlinkProvider,
  openDeferredExternalDestination,
  resolveSubscriptionQuery,
} from '../utils/accountPlatform';

const SURVEY_SUPPORT_EMAIL = 'isaiahcalvo123@gmail.com';
const SUBSCRIPTION_TIMEOUT_MS = 10_000;

export const AccountSettings = ({ isOpen, onClose }) => {
  const {
    user,
    updateProfile,
    updatePassword,
    signIn,
    signOut,
    signInWithGoogle,
    unlinkProvider,
    deleteAccount,
    resetPassword,
    refreshSubscriptionTier,
  } = useAuth();
  const { isAuthenticated: isMSAuthenticated, login: msLogin, logout: msLogout, account: msAccount, needsReconnect: msNeedsReconnect } = useMSGraph();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [subscriptionViewTab, setSubscriptionViewTab] = useState('manage'); // 'manage' or 'usage'
  const dialogRef = useRef(null);

  // Accessibility: the shared focus trap keeps Tab inside the dialog, closes
  // it on Escape, and returns focus to whatever opened it.
  useFocusTrap(dialogRef, isOpen, { onEscape: onClose });

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Cloudflare Turnstile — shared by the password-change re-auth and the
  // "email me a reset link" button (both hit captcha-protected endpoints).
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const [captchaBroken, setCaptchaBroken] = useState(false);
  const resetCaptcha = () => { setCaptchaToken(''); setCaptchaNonce((n) => n + 1); };

  // Subscription state
  const [subscription, setSubscription] = useState(null);
  const [loadingSubscription, setLoadingSubscription] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState('');
  const [billingPeriod, setBillingPeriod] = useState('monthly');
  // In-flight guard for the billing portal button: opening a portal session
  // takes a few seconds (function cold start + Stripe round trip). Without
  // this, users click repeatedly and the racing duplicate requests surface a
  // spurious failure banner (owner-reported 2026-08-20).
  const [portalOpening, setPortalOpening] = useState(false);
  const subscriptionRequestRef = useRef(0);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      // UX (KAL-68): Account Settings ALWAYS opens on General — deliberate, do
      // not "fix" this by persisting the last-active tab. This modal is opened
      // rarely and most visits address a different concern, so restoring a
      // remembered tab produces a "why am I on this weird screen?" moment days
      // later. Landing on General every time is predictable.
      setActiveTab('general');
      setSubscriptionViewTab('manage');
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
    if (!user) {
      setLoadingSubscription(false);
      return;
    }

    const requestId = ++subscriptionRequestRef.current;
    setLoadingSubscription(true);
    setSubscriptionError('');
    try {
      const request = supabase
          .from('user_subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();
      const data = await resolveSubscriptionQuery(
        request,
        SUBSCRIPTION_TIMEOUT_MS,
      );
      if (requestId !== subscriptionRequestRef.current) return;
      setSubscription(data);
    } catch (err) {
      if (requestId !== subscriptionRequestRef.current) return;
      console.error('Error:', err);
      setSubscriptionError(err?.message || 'Could not load subscription status.');
    } finally {
      if (requestId === subscriptionRequestRef.current) setLoadingSubscription(false);
    }
  };

  // Fetch subscription when modal opens
  useEffect(() => {
    if (isOpen && user) {
      fetchSubscription();
    }
    return () => { subscriptionRequestRef.current += 1; };
  }, [isOpen, user]);

  // Refetch subscription when window regains focus (user returns from Stripe checkout)
  useEffect(() => {
    const handleFocus = () => {
      if (isOpen && user) {
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

  if (!isOpen || !user) return null;

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

        if (!passwordMeetsRequirements(newPassword, { email, firstName, lastName })) {
          setError('Password does not meet requirements');
          setLoading(false);
          return;
        }

        if (newPassword === currentPassword) {
          setError('Your new password must be different from your current password');
          setLoading(false);
          return;
        }

        // Bot check gates the re-auth (a captcha-protected endpoint).
        if (TURNSTILE_ENABLED && !captchaToken && !captchaBroken) {
          setError('Please complete the "I\'m human" check below, then save again.');
          setLoading(false);
          return;
        }

        // Verify the current password server-side before changing anything —
        // a live session alone must not authorize a password change (e.g. an
        // unattended machine). A correct password just refreshes the session.
        try {
          await signIn(user.email, currentPassword, captchaToken);
        } catch (reauthErr) {
          resetCaptcha(); // single-use token is now spent
          const rmsg = (reauthErr?.message || '').toLowerCase();
          setError(/captcha|verification|human/.test(rmsg)
            ? 'Verification failed — please redo the "I\'m human" check and save again.'
            : 'Current password is incorrect');
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

      // Send email notification about changed fields. The success copy below
      // only claims delivery when the function actually accepted the request.
      let notificationSent = false;
      try {
        const session = await getSupabaseSession('AccountSettings.profileNotification');

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
          } else {
            notificationSent = true;
          }
        }
      } catch (emailError) {
        console.error('Error sending notification email:', emailError);
        // Don't fail the whole operation if email fails
      }

      const changedText = changedFields.join(' and ');
      setMessage(notificationSent
        ? `Your ${changedText} has been updated successfully. A confirmation email has been sent.`
        : `Your ${changedText} has been updated successfully.`);

      // Reset form
      setIsEditing(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      resetCaptcha();
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
    resetCaptcha();
  };

  const handleDeleteAccount = async () => {
    setError('');
    setLoading(true);

    try {
      await deleteAccount();
      onClose();
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

  const handleSendResetLink = async () => {
    setError('');
    setMessage('');
    if (!email) { setError('No email on file to send a reset link to.'); return; }
    if (TURNSTILE_ENABLED && !captchaToken && !captchaBroken) {
      setError('Please complete the "I\'m human" check below, then request the link.');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(email, captchaToken);
      setMessage(`A password reset link has been sent to ${email}. Check your inbox and follow the link to set a new password.`);
      resetCaptcha();
    } catch (err) {
      resetCaptcha(); // single-use token is now spent
      const rmsg = (err?.message || '').toLowerCase();
      setError(/captcha|verification|human/.test(rmsg)
        ? 'Verification failed — please redo the "I\'m human" check and try again.'
        : (err?.message || 'Could not send a reset link. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="account-settings-overlay" onClick={onClose}>
      <div
        className="account-settings-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >

        {/* Header */}
        <div className="account-settings-header">
          <h2>Settings</h2>
          <button className="account-settings-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="account-settings-body">
          {/* Sidebar */}
          <div className="account-settings-sidebar" role="tablist" aria-label="Settings sections">
            <button
              onClick={() => setActiveTab('general')}
              className={`account-sidebar-btn ${activeTab === 'general' ? 'active' : ''}`}
              role="tab"
              aria-selected={activeTab === 'general'}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab('connected-services')}
              className={`account-sidebar-btn ${activeTab === 'connected-services' ? 'active' : ''}`}
              role="tab"
              aria-selected={activeTab === 'connected-services'}
            >
              Connected services
            </button>
            <button
              onClick={() => setActiveTab('subscription')}
              className={`account-sidebar-btn ${activeTab === 'subscription' ? 'active' : ''}`}
              role="tab"
              aria-selected={activeTab === 'subscription'}
            >
              {/* UX (KAL-68): "Subscription", not "Manage subscription". The longer
                  label ran to ~175px inside the 200px sidebar, so at a 1.25x OS
                  scale or a narrow window it wrapped or overflowed. One word — the
                  tab still opens the same Manage subscription content, which keeps
                  its own longer label on the sub-tab inside. */}
              Subscription
            </button>
          </div>

          {/* Content */}
          <div className="account-settings-content">
            {error && <div className="account-error">{error}</div>}
            {message && <div className="account-message">{message}</div>}

            {activeTab === 'general' && (
              <>
                {/* Profile Section */}
                <section className="account-section">
                  <h3>Profile information</h3>

                  {!isEditing ? (
                    /* View Mode */
                    <div>
                      <div className="account-form-group">
                        <label>First name</label>
                        <div className={`account-field-display ${!firstName ? 'account-field-display-empty' : ''}`}>
                          {firstName || 'Not set'}
                        </div>
                      </div>

                      <div className="account-form-group">
                        <label>Last name</label>
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
                        Edit profile
                      </button>
                    </div>
                  ) : (
                    /* Edit Mode */
                    <form onSubmit={handleSaveChanges}>
                      <div className="account-form-row">
                        <div className="account-form-group">
                          <label htmlFor="firstName">First name</label>
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
                          <label htmlFor="lastName">Last name</label>
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
                          <div className="account-subsection-title">Change password (optional)</div>
                          <p className="account-subsection-description">
                            Leave blank if you don't want to change your password
                          </p>
                        </div>

                        <div className="account-form-group">
                          <label htmlFor="currentPassword">Current password</label>
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
                          <label htmlFor="newPassword">New password</label>
                          <input
                            id="newPassword"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="••••••••"
                            disabled={loading}
                            autoComplete="new-password"
                          />
                          <div style={{ marginTop: 6 }}>
                            <PasswordRequirements password={newPassword} email={email} firstName={firstName} lastName={lastName} />
                          </div>
                        </div>

                        <div className="account-form-group">
                          <label htmlFor="confirmPassword">Confirm new password</label>
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

                        <button
                          type="button"
                          onClick={handleSendResetLink}
                          disabled={loading}
                          style={{ display: 'inline-block', background: 'none', border: 'none', color: 'var(--accent)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: '2px 0', textDecoration: 'underline' }}
                        >
                          Forgot your current password? Email me a reset link
                        </button>

                        {TURNSTILE_ENABLED && (
                          <TurnstileWidget
                            key={captchaNonce}
                            onToken={setCaptchaToken}
                            onError={() => setCaptchaBroken(true)}
                            action="account"
                          />
                        )}
                      </div>

                      <div className="account-btn-group">
                        {/* UX (KAL-73): saving the profile is a network round-trip
                            over 500ms, so it takes the shared button loading
                            treatment — 14px ring left of a present-participle
                            label, disabled until the save resolves. */}
                        <button type="submit" className="account-btn-primary" disabled={loading}>
                          {loading && <Spinner size={14} color="var(--accent-text)" trackColor="rgba(21,17,10,0.25)" />}
                          {loading ? 'Saving…' : 'Save changes'}
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

                {!isEditing && (
                  <>
                {/* Danger Zone */}
                <section className="account-section account-danger-zone">
                  {/* UX (KAL-68): self-serve account deletion is NOT built — there
                      is no server-side delete endpoint behind this. The control
                      stays visible so the user knows deletion exists as a concept,
                      but it is permanently disabled and says so up front.
                      It used to be a live two-step confirm whose final button set
                      a red error reading "Account deletion must be implemented on
                      the server" — which read as "your deletion just failed", not
                      "this feature isn't finished". Announcing the limitation
                      before the click is honest; a red failure after it is not.
                      When a real delete endpoint ships, re-enable this button and
                      restore a confirm gate using the shared ConfirmModal. */}
                  <button
                    className="account-btn-danger"
                    type="button"
                    disabled
                    title="Account deletion isn't self-serve yet — contact support"
                    aria-label="Account deletion isn't self-serve yet — contact support"
                  >
                    Delete account
                  </button>
                  <p className="account-danger-zone-description">
                    Account deletion isn&apos;t self-serve yet — contact support and
                    we&apos;ll remove your account and all associated data.
                  </p>
                </section>

                {/* Sign Out Section */}
                <section className="account-section">
                  <button
                    className="account-btn-secondary account-btn-secondary-full"
                    onClick={handleSignOut}
                  >
                    Sign out
                  </button>
                </section>
                  </>
                )}
              </>
            )}

            {activeTab === 'subscription' && (
              <>
                {/* Subscription View Tabs - Always visible when subscription tab is active */}
                <div className="account-subscription-tabs" style={{ marginBottom: '16px' }}>
                  <button
                    onClick={() => setSubscriptionViewTab('manage')}
                    className={`account-subscription-tab ${subscriptionViewTab === 'manage' ? 'active' : ''}`}
                  >
                    Manage subscription
                  </button>
                  <button
                    onClick={() => setSubscriptionViewTab('usage')}
                    className={`account-subscription-tab ${subscriptionViewTab === 'usage' ? 'active' : ''}`}
                  >
                    Usage
                  </button>
                </div>

                <section className="account-section" style={{ display: subscriptionViewTab === 'manage' ? 'block' : 'none' }}>
                    {loadingSubscription ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-disabled)', fontSize: '13px' }}>
                    Loading subscription...
                  </div>
                ) : subscriptionError ? (
                  <div role="alert" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-3)', fontSize: '13px' }}>
                    <div>{subscriptionError}</div>
                    <button type="button" className="account-btn-secondary" onClick={fetchSubscription} style={{ marginTop: 10 }}>
                      Retry
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Subscription status line.
                        UX (owner request 2026-08-20): NO banners on this tab — no
                        colored boxes, no emoji. The plan cards and buttons carry
                        the state; this single muted line carries only the facts a
                        card cannot: when a trial converts to a charge, that a
                        payment failed, or (for 7 days after it lands) that a
                        cancellation completed. */}
                    {(() => {
                      if (!subscription) return null;
                      const fmt = (d) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                      let text = null;
                      if (subscription.tier === 'free' && subscription.status === 'canceled') {
                        const endedAt = Date.parse(subscription.current_period_end || subscription.updated_at || '');
                        if (Number.isFinite(endedAt) && (Date.now() - endedAt) < 7 * 24 * 60 * 60 * 1000) {
                          text = "Your subscription was canceled and you're on the Free plan.";
                        }
                      } else if (subscription.tier === 'developer') {
                        text = 'Developer account — unlimited access for testing.';
                      } else if (subscription.status === 'trialing' && subscription.trial_ends_at) {
                        text = `Pro trial — you won't be charged if you cancel before ${fmt(subscription.trial_ends_at)}.`;
                      } else if (subscription.status === 'past_due') {
                        text = 'Your last payment failed — update your card in Manage Billing & Payments.';
                      } else if (subscription.status === 'active' && subscription.metadata?.cancel_at) {
                        // Cancellation scheduled: saying "renews" here would be
                        // false — the user cancelled (owner-hit 2026-08-30).
                        const tierName = subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1);
                        text = `${tierName} plan — ends ${fmt(subscription.metadata.cancel_at)} and won't renew.`;
                      } else if (subscription.status === 'active' && subscription.current_period_end) {
                        const tierName = subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1);
                        text = `${tierName} plan — renews ${fmt(subscription.current_period_end)}.`;
                      }
                      if (!text) return null;
                      return (
                        <div style={{ color: 'var(--text-3)', fontSize: '12px', marginBottom: '14px' }}>
                          {text}
                        </div>
                      );
                    })()}

                    {/* Manage Billing Button (for users with active subscriptions) */}
                    {subscription && subscription.tier !== 'free' && subscription.stripe_customer_id && (
                      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                        <button
                          onClick={async () => {
                            if (portalOpening) return; // ignore repeat clicks while working
                            setPortalOpening(true);
                            setError('');
                            // Claim the tab NOW, inside the click gesture — see
                            // openDeferredExternalDestination for why.
                            const tab = openDeferredExternalDestination();
                            try {
                              const { data, error } = await supabase.functions.invoke('create-portal-session', {
                                body: { returnUrl: buildBillingReturnUrl() },
                              });
                              if (error) throw error;
                              if (!data?.url) throw new Error('No billing portal URL returned');
                              await tab.navigate(data.url);
                            } catch (err) {
                              tab.cancel();
                              console.error('Error opening billing portal:', err);
                              setError('Failed to open billing portal. Please try again.');
                            } finally {
                              setPortalOpening(false);
                            }
                          }}
                          disabled={portalOpening}
                          style={{
                            padding: '10px 20px',
                            background: 'transparent',
                            border: '1px solid var(--accent)',
                            borderRadius: '6px',
                            color: 'var(--accent)',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: '500',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            e.target.style.background = 'var(--accent-soft)';
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.background = 'transparent';
                          }}
                        >
                          {portalOpening ? 'Opening billing…' : 'Manage Billing & Payments'}
                        </button>
                      </div>
                    )}

                    {/* Billing Period Toggle (only show for paid users selecting new plan) */}
                    {subscription?.tier === 'free' && (
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '16px', background: 'var(--surface-1)', padding: '4px', borderRadius: '8px', width: 'fit-content', margin: '0 auto 16px auto' }}>
                        <button
                          onClick={() => setBillingPeriod('monthly')}
                          style={{
                            padding: '8px 24px',
                            border: 'none',
                            borderRadius: '6px',
                            background: billingPeriod === 'monthly' ? 'var(--accent)' : 'transparent',
                            // A label sitting ON gold is --accent-text; white on gold is 2.0:1.
                            color: billingPeriod === 'monthly' ? 'var(--accent-text)' : 'var(--text-3)',
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
                            background: billingPeriod === 'annual' ? 'var(--accent)' : 'transparent',
                            color: billingPeriod === 'annual' ? 'var(--accent-text)' : 'var(--text-3)',
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
                            background: 'var(--accent-soft)',
                            color: 'var(--accent)',
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
                        border: subscription?.tier === 'free' ? '2px solid var(--accent)' : '1px solid var(--border)',
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
                            <li>1 project</li>
                            <li>5 documents</li>
                            <li>100MB storage</li>
                            <li>Basic annotations</li>
                            <li>PDF viewer</li>
                          </ul>
                        </div>
                        <div className="account-subscription-actions">
                          {subscription?.tier === 'free' ? (
                            <button className="account-btn-outline-green" disabled>
                              Current plan
                            </button>
                          ) : subscription?.tier === 'developer' ? (
                            <button className="account-btn-secondary" disabled style={{ opacity: 0.5 }}>
                              Developer account
                            </button>
                          ) : (
                            <button className="account-btn-secondary" disabled style={{ opacity: 0.5 }}>
                              Downgrade available
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Pro Plan */}
                      <div className="account-subscription-card" style={{
                        // UX 2026-09-17: the current plan is marked with a gold edge, the
                        // same mark the Free and Enterprise cards use. Pro alone wore a
                        // #4A90E2 blue, so "this is your plan" looked like two different
                        // things depending on which plan you were on.
                        border: (subscription?.tier === 'pro' || subscription?.status === 'trialing') ? '2px solid var(--accent)' : '1px solid var(--border)',
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
                                <div style={{ fontSize: '12px', color: 'var(--text-disabled)', marginTop: '4px', whiteSpace: 'nowrap' }}>
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
                            <li>Unlimited projects</li>
                            <li>Unlimited documents</li>
                            <li>10GB Storage</li>
                            <li>Survey tools</li>
                            <li>Templates & Regions</li>
                            <li>Excel export</li>
                            <li>OneDrive integration</li>
                          </ul>
                        </div>
                        <div className="account-subscription-actions">
                          {subscription?.tier === 'pro' ? (
                            <button className="account-btn-outline-blue" disabled>
                              Current plan
                            </button>
                          ) : subscription?.tier === 'developer' ? (
                            <button className="account-btn-secondary" disabled style={{ opacity: 0.5 }}>
                              Developer account
                            </button>
                          ) : subscription?.tier === 'enterprise' ? (
                            <button className="account-btn-secondary" disabled style={{ opacity: 0.5 }}>
                              On higher plan
                            </button>
                          ) : (
                            <StripeCheckout
                              tier="pro"
                              billingPeriod={billingPeriod}
                              className="account-btn-purple"
                            >
                              {billingPeriod === 'annual' ? 'Start annual trial' : 'Start 7-day trial'}
                            </StripeCheckout>
                          )}
                        </div>
                      </div>

                      {/* Enterprise Plan */}
                      <div className="account-subscription-card" style={{
                        border: subscription?.tier === 'enterprise' ? '2px solid var(--accent)' : '1px solid var(--border)',
                        opacity: subscription?.tier === 'enterprise' ? 1 : subscription?.tier === 'developer' ? 0.7 : 1
                      }}>
                        <div className="account-subscription-header">
                          <div className="account-plan-name">Enterprise</div>
                          <div className="account-subscription-price">
                            <span className="price-amount">$20</span>
                            <span className="price-period">/user/mo</span>
                            <div style={{ fontSize: '12px', color: 'var(--text-disabled)', marginTop: '4px', whiteSpace: 'nowrap' }}>
                              Minimum 3 users
                            </div>
                          </div>
                        </div>
                        <div className="account-subscription-features">
                          <ul>
                            <li>Everything in Pro</li>
                            <li>Team collaboration</li>
                            <li>Real-time Editing</li>
                            <li>1TB Team Storage</li>
                            <li>SSO & Admin Tools</li>
                            <li>Priority support</li>
                            <li>Custom integrations</li>
                          </ul>
                        </div>
                        <div className="account-subscription-actions">
                          {subscription?.tier === 'enterprise' ? (
                            <button className="account-btn-outline-gold" disabled>
                              Current plan
                            </button>
                          ) : subscription?.tier === 'developer' ? (
                            <button className="account-btn-secondary" disabled style={{ opacity: 0.5 }}>
                              Developer account
                            </button>
                          ) : (
                            <button
                              className="account-btn-secondary"
                              onClick={() => window.open(`mailto:${SURVEY_SUPPORT_EMAIL}?subject=Enterprise Plan Inquiry`, '_blank')}
                            >
                              Contact sales
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    </>
                  )}
                </section>

                <section className="account-section" style={{ display: subscriptionViewTab === 'usage' ? 'block' : 'none' }}>
                  <UsageIndicator />
                </section>
              </>
            )}

            {activeTab === 'connected-services' && (
              <section className="account-section">
                <h3>Connected services</h3>
                <p className="account-section-description">
                  Manage your connections to external services.
                </p>

                {/* Microsoft OneDrive */}
                <div className="account-connected-account">
                  <div className="account-connected-account-info">
                    <div className="account-connected-account-icon">
                      <Icon name="oneDrive" size={24} />
                    </div>
                    <div className="account-connected-account-details">
                      <div className="account-connected-account-name">Microsoft</div>
                      {isMSAuthenticated ? (
                        <div className="account-connected-account-status account-connected-account-status-connected">
                          Connected as {msAccount?.username || msAccount?.email || msAccount?.name}
                        </div>
                      ) : msNeedsReconnect ? (
                        <div className="account-connected-account-status" style={{ color: 'var(--warning)' }}>
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
                        style={msNeedsReconnect ? { backgroundColor: 'var(--warning)', borderColor: 'var(--warning)' } : {}}
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
                      <Icon name="google" size={24} />
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
                      onClick={async () => {
                        const googleConnected = Boolean(user?.app_metadata?.provider === 'google'
                          || user?.identities?.some((id) => id.provider === 'google'));
                        try {
                          if (!googleConnected) {
                            await signInWithGoogle();
                            return;
                          }
                          const check = canUnlinkProvider(user, 'google');
                          if (!check.allowed && check.reason === 'last-sign-in-method') {
                            throw new Error('Add another sign-in method before disconnecting Google.');
                          }
                          await unlinkProvider('google');
                          setMessage('Google has been disconnected.');
                        } catch (err) {
                          setError(err?.message || 'Failed to update Google connection.');
                        }
                      }}
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
