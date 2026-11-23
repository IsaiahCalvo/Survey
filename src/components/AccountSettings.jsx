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
import { useProLock } from '../hooks/useProLock.js';
import UsageIndicator from './UsageIndicator';
import './AccountSettings.css';
import PasswordRequirements from './PasswordRequirements';
import Spinner from './Spinner';
import { passwordMeetsRequirements } from './authFlow';
import TurnstileWidget, { TURNSTILE_ENABLED } from './TurnstileWidget';
import Icon from '../Icons';
import { useConfirmDialog, usePromptDialog } from './dialogPrompts';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  deleteAccountButtonState,
  isAccountDeletionConfirmed,
} from './accountDeletionConfirm';
import CrashReportsPanel from './CrashReportsPanel';
import CompanyPanel from './company/CompanyPanel.jsx';
import { isFeatureOn } from '../featureFlags.js';
import { makeSurveyAgentCaller } from '../agent/surveyAgentClient.js';
import { COMPANY_FLAG, getMyCompany } from '../services/companyService.js';
import { downloadMyData } from '../services/accountExport';
import {
  readAnnotationSnapping,
  writeAnnotationSnapping,
  readSnapAngle,
  writeSnapAngle,
  SNAP_ANGLE_CHOICES,
  readUnits,
  writeUnits,
  readTextboxAutoFit,
  writeTextboxAutoFit,
  subscribeAnnotationPreferences,
} from '../utils/annotationPreferences';
import {
  buildBillingReturnUrl,
  canUnlinkProvider,
  isGoogleSignInHidden,
  isPurchaseUiHidden,
  openDeferredExternalDestination,
  resolveSubscriptionQuery,
  SUBSCRIPTION_LOAD_FAILED_TEXT,
} from '../utils/accountPlatform';
import { readUsageStatsOff, writeUsageStatsOff } from '../utils/surveyAnalytics';
import { IMPROVE_SURVEY_POLICY_VERSION } from '../legal/legalVersions';
import { useTooltip } from './Tooltip';
import ButtonGroup from './ButtonGroup.jsx';
import { isSuiteLookOn, readAppearance, writeAppearance } from '../suiteLook.js';
import { SURVEY_SUPPORT_EMAIL } from '../services/supportContact.js';

const SUBSCRIPTION_TIMEOUT_MS = 10_000;

export const AccountSettings = ({ isOpen, onClose, initialTab = null }) => {
  const tip = useTooltip();
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
  const proLocked = useProLock();
  const [loading, setLoading] = useState(false);
  const [exportProgress, setExportProgress] = useState(null); // null, or { done, total }
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  // Read once per open, like every flag: a /flags change shows on reload.
  const [companyOn] = useState(() => isFeatureOn(COMPANY_FLAG));
  const [subscriptionViewTab, setSubscriptionViewTab] = useState('manage'); // 'manage' or 'usage'
  const dialogRef = useRef(null);
  const [deletionDialogOpen, setDeletionDialogOpen] = useState(false);
  // KAL-397 — Annotations tab. This device's setting (localStorage), read on
  // open and kept in step with other windows; an open document reads it at
  // the next text edit, so a change applies without a reload.
  const [annotationSnapping, setAnnotationSnapping] = useState(() => readAnnotationSnapping());
  const [textboxAutoFit, setTextboxAutoFit] = useState(() => readTextboxAutoFit());
  const [snapAngle, setSnapAngle] = useState(() => readSnapAngle());
  const [defaultUnitsOn] = useState(() => isFeatureOn('default-units'));
  const [units, setUnits] = useState(() => readUnits());
  // KAL-663 - the suite look's light and dark mode. This device's setting.
  const [suiteLookOn] = useState(() => isSuiteLookOn());
  const [appearance, setAppearance] = useState(() => readAppearance());
  // Privacy tab. Usage statistics are per device; the learning opt-in lives on
  // the account so the server can check it before using anything.
  const [usageStatsOn, setUsageStatsOn] = useState(() => !readUsageStatsOff());
  const improveSurveyOptIn = user?.user_metadata?.improve_survey_opt_in?.on === true;
  // KAL-532: what is left of this month's Survey agent allowance, from the
  // agent's own status (it holds the caps). null while unknown.
  const [agentLeft, setAgentLeft] = useState(null);
  useEffect(() => {
    if (!isOpen || activeTab !== 'privacy' || !user || !isFeatureOn('survey-agent')) return undefined;
    let live = true;
    makeSurveyAgentCaller(supabase)({ action: 'status' })
      .then((s) => { if (live) setAgentLeft(s?.usage_left || null); })
      .catch(() => { if (live) setAgentLeft(null); });
    return () => { live = false; };
  }, [isOpen, activeTab, user]);
  const handleImproveSurveyToggle = async () => {
    setError('');
    setLoading(true);
    try {
      await updateProfile({
        improve_survey_opt_in: { on: !improveSurveyOptIn, at: new Date().toISOString(), policy: IMPROVE_SURVEY_POLICY_VERSION },
      });
    } catch (err) {
      setError(err?.message || 'Could not save that setting. Try again.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!isOpen) return undefined;
    const refresh = () => { setTextboxAutoFit(readTextboxAutoFit()); setAnnotationSnapping(readAnnotationSnapping()); setSnapAngle(readSnapAngle()); setUnits(readUnits()); };
    refresh();
    return subscribeAnnotationPreferences(refresh);
  }, [isOpen]);

  // Accessibility: the shared focus trap keeps Tab inside the dialog, closes
  // it on Escape, and returns focus to whatever opened it.
  useFocusTrap(dialogRef, isOpen && !deletionDialogOpen, { onEscape: onClose });

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
  // A paid company seat lifts the plan to Enterprise without touching the
  // person's own subscription row: { name, paid } or null.
  const [companySeat, setCompanySeat] = useState(null);
  const viaCompany = Boolean(companySeat?.paid)
    && subscription?.tier !== 'enterprise' && subscription?.tier !== 'developer';
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
      // The one exception: a link that names a page (a company invite email
      // opens Company, a plan-limit toast opens Subscription).
      // The plan-limit toast's See plans opens Subscription.
      setActiveTab(initialTab === 'company' && isFeatureOn(COMPANY_FLAG)
        ? 'company'
        : initialTab === 'subscription' ? 'subscription' : 'general');
      setSubscriptionViewTab('manage');
      setIsEditing(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setMessage('');
    }
  }, [isOpen, initialTab]);

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
      // Best effort: no company (or an older database) just means no line.
      const companyRequest = getMyCompany().catch(() => null);
      const data = await resolveSubscriptionQuery(
        request,
        SUBSCRIPTION_TIMEOUT_MS,
      );
      const company = await companyRequest;
      if (requestId !== subscriptionRequestRef.current) return;
      setSubscription(data);
      setCompanySeat(company ? { name: company.name, paid: company.my_seat_paid === true } : null);
    } catch (err) {
      if (requestId !== subscriptionRequestRef.current) return;
      console.error('Could not load subscription:', err);
      setSubscriptionError(SUBSCRIPTION_LOAD_FAILED_TEXT);
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

  // Joining or leaving a company happens on the Company page of this same
  // window, so look again at the company seat whenever Subscription opens
  // (quietly: the plan cards stay put while it loads).
  useEffect(() => {
    if (!isOpen || !user || activeTab !== 'subscription') return undefined;
    let cancelled = false;
    getMyCompany().then((company) => {
      if (!cancelled) setCompanySeat(company ? { name: company.name, paid: company.my_seat_paid === true } : null);
    }, () => {});
    return () => { cancelled = true; };
  }, [isOpen, user, activeTab]);

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

  const [askConfirm, accountConfirmDialog] = useConfirmDialog();
  const [askPrompt, accountDeletePrompt] = usePromptDialog();
  if (!isOpen || !user) return null;

  /* Owner 2026-10-02: only a real change asks to be saved. A missing name in
     the profile and an empty field are the same thing, and stray spaces are
     not a change, so Save stays off until something actually differs. */
  const nameDiffers = (firstName || '').trim() !== (user?.user_metadata?.first_name || '').trim()
    || (lastName || '').trim() !== (user?.user_metadata?.last_name || '').trim();
  const hasProfileChanges = nameDiffers || !!(newPassword || confirmPassword || currentPassword);

  const handleSaveChanges = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    const changedFields = [];

    try {
      // Check if name changed
      const nameChanged = nameDiffers;

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
        await updatePassword(newPassword, { currentPassword });
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
    setDeletionDialogOpen(true);
    try {
      const typed = await askPrompt({
        title: 'Delete account',
        message: 'This permanently removes your account, your documents, projects, survey photos and audio. Documents other people own stay with them.',
        label: `Type ${ACCOUNT_DELETION_CONFIRMATION} to continue`,
        confirmLabel: 'Continue',
      });
      if (typed === null) return;
      if (!isAccountDeletionConfirmed(typed)) {
        setError(`Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm account deletion.`);
        return;
      }
      if (!(await askConfirm({
        title: 'Delete account?',
        message: 'This cannot be undone. Your account and its data will be removed and you will be signed out.',
        confirmLabel: 'Delete account',
        danger: true,
      }))) return;
    } finally { setDeletionDialogOpen(false); }
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
  const handleDownloadMyData = async () => {
    setError('');
    setMessage('');
    setExportProgress({ done: 0, total: 0 });
    try {
      const result = await downloadMyData({
        functionsClient: supabase.functions,
        onProgress: (progress) => setExportProgress(progress),
      });
      if (result.canceled) return;
      const saved = result.parts > 1 ? `Your data was saved as ${result.parts} ZIP files.` : 'Your data was saved as a ZIP file.';
      setMessage(result.failures.length
        ? `${saved} ${result.failures.length} file(s) could not be downloaded; the list is in errors.txt.`
        : saved);
    } catch (err) {
      setError(err.message || "Your data couldn't be downloaded.");
    } finally {
      setExportProgress(null);
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
      <span style={{ display: 'contents' }} onClick={(event) => event.stopPropagation()}>{accountDeletePrompt}{accountConfirmDialog}</span>
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
          <button className="account-settings-close" onClick={onClose} aria-label="Close" {...tip('Close', 'below')}>
            <Icon name="close" size={13} />
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
              onClick={() => setActiveTab('annotations')}
              className={`account-sidebar-btn ${activeTab === 'annotations' ? 'active' : ''}`}
              role="tab"
              aria-selected={activeTab === 'annotations'}
            >
              Annotations
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
            {/* Enterprise company workspace (beta, Nightly only). */}
            {companyOn && (
              <button
                onClick={() => setActiveTab('company')}
                className={`account-sidebar-btn ${activeTab === 'company' ? 'active' : ''}`}
                role="tab"
                aria-selected={activeTab === 'company'}
              >
                Company
              </button>
            )}
            {/* Crash hunt 2026-10-07: this device's crash notes, to copy to us. */}
            <button
              onClick={() => setActiveTab('crash-reports')}
              className={`account-sidebar-btn ${activeTab === 'crash-reports' ? 'active' : ''}`}
              role="tab"
              aria-selected={activeTab === 'crash-reports'}
            >
              Crash reports
            </button>
            {/* Learning opt-in and usage statistics. */}
            <button
              onClick={() => setActiveTab('privacy')}
              className={`account-sidebar-btn ${activeTab === 'privacy' ? 'active' : ''}`}
              role="tab"
              aria-selected={activeTab === 'privacy'}
            >
              Privacy
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
                  {!isEditing ? (
                    /* View Mode. Plain rows, not boxes: the old grey boxes looked
                       like fields you could type in, with an Edit button under
                       them (polish pass, KAL-652). */
                    <>
                      <div className="account-section-head">
                        <h3>Profile</h3>
                        <button
                          type="button"
                          onClick={() => setIsEditing(true)}
                          className="account-btn-secondary account-btn-sm"
                        >
                          Edit profile
                        </button>
                      </div>
                      <dl className="account-profile-list">
                        <div className="account-profile-row">
                          <dt>First name</dt>
                          <dd className={!firstName ? 'is-empty' : undefined}>{firstName || 'Not set'}</dd>
                        </div>
                        <div className="account-profile-row">
                          <dt>Last name</dt>
                          <dd className={!lastName ? 'is-empty' : undefined}>{lastName || 'Not set'}</dd>
                        </div>
                        <div className="account-profile-row">
                          <dt>Email</dt>
                          <dd>
                            <span className="account-profile-value">{email}</span>
                            <span className="account-field-hint">You can't change your email.</span>
                          </dd>
                        </div>
                      </dl>
                    </>
                  ) : (
                    /* Edit Mode */
                    <form onSubmit={handleSaveChanges}>
                      <h3>Profile</h3>
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
                          {...tip('Email cannot be changed', 'below')}
                          autoComplete="email"
                        />
                        <div className="account-field-hint">
                          You can't change your email.
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
                            disabled={loading}
                            autoComplete="new-password"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handleSendResetLink}
                          disabled={loading}
                          className="account-text-link"
                          style={{ display: 'inline-block', background: 'none', border: 'none', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: '2px 0', textDecoration: 'underline' }}
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
                        <button type="submit" className="account-btn-primary" disabled={loading || !hasProfileChanges}>
                          {loading && <Spinner size={14} color="var(--accent-text)" trackColor="var(--accent-text-track)" />}
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

                {/* KAL-663 - Appearance: light, dark, or follow the device. */}
                {suiteLookOn && (
                  <section className="account-section" aria-labelledby="account-appearance-heading">
                    <h3 id="account-appearance-heading">Appearance</h3>
                    <div className="account-pref-row">
                      <div className="account-pref-copy">
                        <div className="account-pref-title" id="account-pref-appearance">Light or dark</div>
                        <p className="account-pref-description">How Survey looks on this device. Match system follows your computer or phone. Pages keep their own paper colour.</p>
                      </div>
                      <ButtonGroup
                        size="sm"
                        labelledBy="account-pref-appearance"
                        className="account-pref-appearance"
                        value={appearance}
                        options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Match system' }]}
                        onChange={(next) => setAppearance(writeAppearance(next))}
                      />
                    </div>
                  </section>
                )}

                {!isEditing && (
                  <>
                {/* Account actions: one row each, words on the left and the
                    button on the right, as the Annotations tab lays out its
                    settings. Delete sits last, away from the everyday ones. */}
                <section className="account-section" aria-labelledby="account-actions-heading">
                  <h3 id="account-actions-heading">Account</h3>
                  <div className="account-pref-row account-action-row account-data-export">
                    <div className="account-pref-copy">
                      <div className="account-pref-title">Your data</div>
                      <p className="account-pref-description">
                        One ZIP file with your documents, annotations, survey photos and audio, and account details.
                      </p>
                    </div>
                    <button
                      className="account-btn-secondary account-btn-sm"
                      type="button"
                      disabled={loading || exportProgress !== null}
                      onClick={handleDownloadMyData}
                    >
                      {exportProgress !== null && <Spinner size={14} />}
                      {exportProgress === null
                        ? 'Download my data'
                        : exportProgress.total
                          ? `Downloading files ${exportProgress.done} of ${exportProgress.total}…`
                          : 'Gathering your data…'}
                    </button>
                  </div>
                  <div className="account-pref-row account-action-row">
                    <div className="account-pref-copy">
                      <div className="account-pref-title">Sign out</div>
                      <p className="account-pref-description">Sign out of Survey on this device.</p>
                    </div>
                    <button
                      className="account-btn-secondary account-btn-sm"
                      type="button"
                      onClick={handleSignOut}
                    >
                      Sign out
                    </button>
                  </div>
                  <div className="account-pref-row account-action-row account-danger-zone">
                    <div className="account-pref-copy">
                      <div className="account-pref-title">Delete account</div>
                      <p className="account-pref-description">Permanently remove your account and its data.</p>
                    </div>
                    <button
                      className="account-btn-danger account-btn-sm"
                      type="button"
                      disabled={deleteAccountButtonState({ loading }).disabled}
                      onClick={handleDeleteAccount}
                    >
                      {deleteAccountButtonState({ loading }).label}
                    </button>
                  </div>
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

                {/* Manage and Usage take turns, so neither draws the rule between
                    sections: hidden Usage left one under the plan cards. */}
                <section className="account-section" style={{ display: subscriptionViewTab === 'manage' ? 'block' : 'none', borderBottom: 'none', paddingBottom: 0, marginBottom: 0 }}>
                    {loadingSubscription ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-3)', fontSize: '13px' }}>
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
                    {viaCompany && (
                      <div data-testid="company-plan-line" style={{ color: 'var(--text-3)', fontSize: '12px', marginBottom: '14px' }}>
                        {`Enterprise through ${companySeat.name}. Your company pays for your seat.`}
                        {subscription?.tier === 'pro' && ['active', 'trialing'].includes(subscription?.status)
                          ? (isPurchaseUiHidden()
                            ? ' Your own Pro plan still bills you separately.'
                            : ' Your own Pro plan still bills you separately; you can cancel it in Manage Billing & Payments.')
                          : ''}
                      </div>
                    )}
                    {(() => {
                      if (!subscription || viaCompany) return null;
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
                        text = isPurchaseUiHidden()
                          ? 'Your last payment failed.'
                          : 'Your last payment failed — update your card in Manage Billing & Payments.';
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
                    {!isPurchaseUiHidden() && subscription && subscription.tier !== 'free' && subscription.stripe_customer_id && (
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
                    {!isPurchaseUiHidden() && subscription?.tier === 'free' && (
                      <div className="account-period">
                        <ButtonGroup
                          label="Billing period"
                          value={billingPeriod}
                          onChange={setBillingPeriod}
                          options={[
                            { value: 'monthly', label: 'Monthly' },
                            { value: 'annual', label: <>Annual<em className="account-period__save">Save 17%</em></> },
                          ]}
                        />
                      </div>
                    )}

                    {/* Native iOS/Android apps show plan status only — no plan
                        picker, prices or purchase buttons (store review). */}
                    {isPurchaseUiHidden() ? (
                      <div className="account-subscription-card" data-testid="native-plan-status" style={{ border: '2px solid var(--accent)' }}>
                        <div className="account-subscription-header">
                          <div className="account-plan-name">
                            {viaCompany
                              ? 'Enterprise plan'
                              : subscription?.tier
                                ? `${subscription.tier.charAt(0).toUpperCase()}${subscription.tier.slice(1)} plan`
                                : 'Free plan'}
                          </div>
                        </div>
                        <div style={{ color: 'var(--text-3)', fontSize: '13px' }}>{viaCompany ? `Through ${companySeat.name}` : 'Current plan'}</div>
                      </div>
                    ) : (
                    <div className="account-subscription-grid">
                      {/* Free Plan */}
                      <div className="account-subscription-card" style={{
                        ...((subscription?.tier === 'free' && !viaCompany) ? { borderColor: 'var(--border-strong)', boxShadow: '0 0 0 1px var(--border-strong)' } : null),
                        opacity: subscription?.tier === 'free' && !viaCompany ? 1 : 0.7
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
                            <li>100 MB storage</li>
                            <li>Basic annotations</li>
                            <li>PDF viewer</li>
                          </ul>
                        </div>
                        <div className="account-subscription-actions">
                          {subscription?.tier === 'free' && viaCompany ? (
                            <button className="account-btn-secondary" disabled>
                              Your own plan
                            </button>
                          ) : subscription?.tier === 'free' ? (
                            <div className="account-btn-outline-green account-plan-mark">
                              <Icon name="check" size={14} />
                              Current plan
                            </div>
                          ) : subscription?.tier === 'developer' ? (
                            <button className="account-btn-secondary" disabled>
                              Developer account
                            </button>
                          ) : (
                            <button className="account-btn-secondary" disabled>
                              Included in your plan
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
                        ...(((subscription?.tier === 'pro' || subscription?.status === 'trialing')) ? { borderColor: 'var(--border-strong)', boxShadow: '0 0 0 1px var(--border-strong)' } : null),
                        opacity: (subscription?.tier === 'free' || subscription?.tier === 'enterprise' || subscription?.tier === 'developer') ? (subscription?.tier === 'free' ? 1 : 0.7) : 1
                      }}>
                        <div className="account-subscription-header">
                          <div className="account-plan-info-row">
                            <span className="account-plan-name">Pro</span>
                            {subscription?.tier !== 'pro' && subscription?.tier !== 'enterprise' && subscription?.tier !== 'developer' && (
                              <span className="account-plan-badge-text">Recommended</span>
                            )}
                          </div>
                          <div className="account-subscription-price">
                            {billingPeriod === 'annual' && subscription?.tier === 'free' ? (
                              <>
                                <span className="price-amount">$99</span>
                                <span className="price-period">/year</span>
                                <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px', whiteSpace: 'nowrap' }}>
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
                            <li>10 GB storage</li>
                            <li>Survey tools</li>
                            <li>Templates & Spaces</li>
                            <li>Export data</li>
                            <li>Share and edit together live</li>
                            <li>OneDrive integration</li>
                          </ul>
                        </div>
                        <div className="account-subscription-actions">
                          {subscription?.tier === 'pro' ? (
                            <div className="account-btn-outline-blue account-plan-mark">
                              <Icon name="check" size={14} />
                              Current plan
                            </div>
                          ) : subscription?.tier === 'developer' ? (
                            <button className="account-btn-secondary" disabled>
                              Developer account
                            </button>
                          ) : subscription?.tier === 'enterprise' ? (
                            <button className="account-btn-secondary" disabled>
                              On higher plan
                            </button>
                          ) : viaCompany ? (
                            <button className="account-btn-secondary" disabled>
                              Included with your company
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
                        ...((subscription?.tier === 'enterprise' || viaCompany) ? { borderColor: 'var(--border-strong)', boxShadow: '0 0 0 1px var(--border-strong)' } : null),
                        opacity: subscription?.tier === 'enterprise' || viaCompany ? 1 : subscription?.tier === 'developer' ? 0.7 : 1
                      }}>
                        <div className="account-subscription-header">
                          <div className="account-plan-name">Enterprise</div>
                          <div className="account-subscription-price">
                            <span className="price-amount">$20</span>
                            <span className="price-period">/user/mo</span>
                            <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px', whiteSpace: 'nowrap' }}>
                              Minimum 3 users
                            </div>
                          </div>
                        </div>
                        <div className="account-subscription-features">
                          <ul>
                            <li>Everything in Pro for every user</li>
                            <li>1 TB storage</li>
                            <li>Priority support</li>
                            <li>Company single sign-on (SSO)</li>
                            <li>Admin console: coming soon</li>
                            <li>Custom integrations</li>
                          </ul>
                        </div>
                        <div className="account-subscription-actions">
                          {subscription?.tier === 'enterprise' ? (
                            <div className="account-btn-outline-gold account-plan-mark">
                              <Icon name="check" size={14} />
                              Current plan
                            </div>
                          ) : viaCompany ? (
                            <div className="account-btn-outline-gold account-plan-mark">
                              {`Through ${companySeat.name}`}
                            </div>
                          ) : subscription?.tier === 'developer' ? (
                            <button className="account-btn-secondary" disabled>
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
                    )}
                    </>
                  )}
                </section>

                <section className="account-section" style={{ display: subscriptionViewTab === 'usage' ? 'block' : 'none' }}>
                  <UsageIndicator />
                </section>
              </>
            )}

            {activeTab === 'crash-reports' && <CrashReportsPanel />}
            {companyOn && activeTab === 'company' && <CompanyPanel />}

            {/* Off by default: none of a person's work is used to improve
                Survey until they turn this on. Stored on the account with the
                date and policy version, so it follows them and the server can
                check it. Whatever later reads it must also skip projects the
                person doesn't own and anything synced from Google or Microsoft
                (privacy policy, "Helping improve Survey"). */}
            {activeTab === 'privacy' && (
              <section className="account-section" aria-labelledby="account-privacy-heading">
                <h3 id="account-privacy-heading">Helping improve Survey</h3>
                <div className="account-pref-row">
                  <div className="account-pref-copy">
                    <div className="account-pref-title" id="account-pref-improve-survey">Let Survey learn from my survey work</div>
                    <p className="account-pref-description">
                      When on, we may use the marks you make and your Smart fill fixes, in projects you own, to make tools like Smart fill better for everyone. We also count, with no names, how often the Survey agent's changes are taken back. We never show your plans or marks to other customers, never sell them, and never use files synced from Google or Microsoft. Only turn it on for work you have the right to share. Off unless you turn it on.{' '}
                      <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy policy</a>
                    </p>
                  </div>
                  <button
                    type="button"
                    className="account-switch"
                    role="switch"
                    aria-checked={improveSurveyOptIn}
                    aria-labelledby="account-pref-improve-survey"
                    data-pref="improve-survey-opt-in"
                    disabled={loading || !user}
                    onClick={handleImproveSurveyToggle}
                  >
                    <span className="account-switch-track" aria-hidden="true" />
                  </button>
                </div>
                {agentLeft ? (
                  <>
                    <h3>Survey agent</h3>
                    <div className="account-pref-row" data-agent-allowance>
                      <div className="account-pref-copy">
                        <div className="account-pref-title">Left this month</div>
                        <p className="account-pref-description">
                          {agentLeft.requests} requests and {Math.round(Number(agentLeft.cost_share || 0) * 100)}% of your monthly allowance. It starts again on the 1st.
                        </p>
                      </div>
                    </div>
                  </>
                ) : null}
                <h3>Usage statistics</h3>
                <div className="account-pref-row">
                  <div className="account-pref-copy">
                    <div className="account-pref-title" id="account-pref-usage-stats">Send usage statistics</div>
                    <p className="account-pref-description">
                      Short notes on which tools get used and what failed, with no names, emails, file names or drawings, help us find bugs. Applies to this device.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="account-switch"
                    role="switch"
                    aria-checked={usageStatsOn}
                    aria-labelledby="account-pref-usage-stats"
                    data-pref="usage-stats"
                    onClick={() => { writeUsageStatsOff(usageStatsOn); setUsageStatsOn(!usageStatsOn); }}
                  >
                    <span className="account-switch-track" aria-hidden="true" />
                  </button>
                </div>
              </section>
            )}

            {/* KAL-397 — Settings -> Annotations (Acrobat's name for it). */}
            {activeTab === 'annotations' && (
              <section className="account-section" aria-labelledby="account-annotations-text-boxes">
                <h3>Snapping</h3>
                <div className="account-pref-row">
                  <div className="account-pref-copy">
                    <div className="account-pref-title" id="account-pref-annotation-snapping">Snapping</div>
                    <p className="account-pref-description">Line marks up with nearby annotations, pull line ends onto other ends, and stop turns at right angles. Also the magnet button beside the page controls, or Shift+S. Hold Alt while dragging to skip it once.</p>
                  </div>
                  <button type="button" className="account-switch" role="switch" aria-checked={annotationSnapping} aria-labelledby="account-pref-annotation-snapping" data-pref="annotation-snapping" onClick={() => setAnnotationSnapping(writeAnnotationSnapping(!annotationSnapping))}>
                    <span className="account-switch-track" aria-hidden="true" />
                  </button>
                </div>
                <div className="account-pref-row">
                  <div className="account-pref-copy">
                    <div className="account-pref-title" id="account-pref-snap-angle">Shift snap angle</div>
                    <p className="account-pref-description">Hold Shift to keep lines, polygon sides and turns on these steps.</p>
                  </div>
                  <ButtonGroup
                    size="sm"
                    labelledBy="account-pref-snap-angle"
                    className="account-pref-snap-angle"
                    value={snapAngle}
                    options={SNAP_ANGLE_CHOICES.map((deg) => ({ value: deg, label: `${deg}°`, ariaLabel: `${deg} degrees` }))}
                    onChange={(deg) => setSnapAngle(writeSnapAngle(deg))}
                  />
                </div>
                {defaultUnitsOn && (
                  <div className="account-pref-row">
                    <div className="account-pref-copy">
                      <div className="account-pref-title" id="account-pref-units">Units</div>
                      <p className="account-pref-description">Where Set page scale and new blank documents start: feet and Letter, or metres and A4. Scales you have set stay as they are.</p>
                    </div>
                    <ButtonGroup
                      size="sm"
                      labelledBy="account-pref-units"
                      className="account-pref-units"
                      value={units}
                      options={[{ value: 'imperial', label: 'Imperial' }, { value: 'metric', label: 'Metric' }]}
                      onChange={(next) => setUnits(writeUnits(next))}
                    />
                  </div>
                )}
                <h3 id="account-annotations-text-boxes">Text boxes</h3>
                <div className="account-pref-row">
                  <div className="account-pref-copy">
                    <div className="account-pref-title" id="account-pref-textbox-autofit">Fit text boxes to their text</div>
                    <p className="account-pref-description">
                      {textboxAutoFit
                        ? 'A new box shrinks to fit what you type. Once you resize a box yourself, it keeps your size.'
                        : 'Boxes keep the size you draw them. They only grow when the text needs more room.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="account-switch"
                    role="switch"
                    aria-checked={textboxAutoFit}
                    aria-labelledby="account-pref-textbox-autofit"
                    data-pref="textbox-auto-fit"
                    onClick={() => setTextboxAutoFit(writeTextboxAutoFit(!textboxAutoFit))}
                  >
                    <span className="account-switch-track" aria-hidden="true" />
                  </button>
                </div>
              </section>
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
                          Your sign-in ran out. Reconnect to keep syncing.
                        </div>
                      ) : (
                        <div className="account-connected-account-status">
                          Not connected. Connect to sync exports to OneDrive.
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
                      // Connect is a plain grey button: two coral Connects
                      // on one screen were two main actions. Reconnect is
                      // the one thing to do, so it keeps the coral.
                      <button
                        className={msNeedsReconnect ? "account-btn-primary" : "account-btn-secondary"}
                        onClick={async () => {
                          if (proLocked('onedrive')) return;
                          try {
                            await msLogin();
                          } catch (err) {
                            setError('Failed to connect Microsoft account');
                          }
                        }}
                        disabled={loading}
                      >
                        {msNeedsReconnect ? 'Reconnect' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Google Drive — hidden in the store apps unless already
                    linked elsewhere (see isGoogleSignInHidden; the row stays
                    so it can be disconnected). */}
                {(!isGoogleSignInHidden() || user?.app_metadata?.provider === 'google' || user?.identities?.some(id => id.provider === 'google')) && (
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
                          Not connected. Connect to sign in with Google too.
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="account-connected-account-actions">
                    <button
                      className="account-btn-secondary"
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
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
