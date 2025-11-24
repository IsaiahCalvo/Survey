import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './AuthModal.css';

export const AuthModal = ({ isOpen, onClose, onDismiss }) => {
  const [mode, setMode] = useState('login'); // 'login', 'signup', 'sso', 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [ssoDomain, setSsoDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const { signIn, signUp, signInWithGoogle, signInWithSSO, resetPassword } = useAuth();

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (mode === 'login') {
        await signIn(email, password);
        onClose();
      } else if (mode === 'signup') {
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }
        await signUp(email, password, {
          first_name: firstName,
          last_name: lastName,
          full_name: `${firstName} ${lastName}`
        });
        setMessage('Account created! Please check your email to verify your account.');
        setTimeout(() => {
          onClose();
        }, 2000);
      } else if (mode === 'sso') {
        await signInWithSSO(ssoDomain);
        // SSO will redirect, so no need to close modal
      } else if (mode === 'reset') {
        await resetPassword(email);
        setMessage('Password reset link sent! Check your email.');
        setTimeout(() => {
          setMode('login');
          setMessage('');
        }, 3000);
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
      // OAuth will redirect, modal will close on return
    } catch (err) {
      setError(err.message || 'Failed to sign in with Google');
      setLoading(false);
    }
  };

  const handleClose = () => {
    // If onDismiss is available (for non-authenticated users), use it
    // Otherwise use onClose (for authenticated users or when dismiss isn't available)
    if (onDismiss) {
      onDismiss();
    } else {
      onClose();
    }
  };

  return (
    <div className="auth-modal-overlay" onClick={handleClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <button className="auth-modal-close" onClick={handleClose}>
          ×
        </button>

        <div className="auth-modal-header">
          <h2>
            {mode === 'login' && 'Welcome Back'}
            {mode === 'signup' && 'Create Account'}
            {mode === 'sso' && 'Company Sign-In'}
            {mode === 'reset' && 'Reset Password'}
          </h2>
          <p className="auth-modal-subtitle">
            {mode === 'login' && 'Sign in to save and sync your work'}
            {mode === 'signup' && 'Get started with a free account'}
            {mode === 'sso' && 'Sign in with your company credentials'}
            {mode === 'reset' && 'We\'ll send you a password reset link'}
          </p>
        </div>

        {error && <div className="auth-error">{error}</div>}
        {message && <div className="auth-message">{message}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          {mode !== 'sso' && (
            <div className="auth-form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={loading}
              />
            </div>
          )}

          {mode === 'signup' && (
            <>
              <div className="auth-form-group">
                <label htmlFor="firstName">First Name</label>
                <input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  required
                  disabled={loading}
                />
              </div>

              <div className="auth-form-group">
                <label htmlFor="lastName">Last Name</label>
                <input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  required
                  disabled={loading}
                />
              </div>
            </>
          )}

          {(mode === 'login' || mode === 'signup') && (
            <div className="auth-form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
              />
            </div>
          )}

          {mode === 'signup' && (
            <div className="auth-form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
              />
            </div>
          )}

          {mode === 'sso' && (
            <div className="auth-form-group">
              <label htmlFor="ssoDomain">Company Domain</label>
              <input
                id="ssoDomain"
                type="text"
                value={ssoDomain}
                onChange={(e) => setSsoDomain(e.target.value)}
                placeholder="company.com"
                required
                disabled={loading}
              />
            </div>
          )}

          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : mode === 'sso' ? 'Continue with SSO' : 'Send Reset Link'}
          </button>
        </form>

        {mode === 'login' && (
          <>
            <div className="auth-divider">
              <span>or</span>
            </div>

            <button
              type="button"
              className="auth-google-btn"
              onClick={handleGoogleSignIn}
              disabled={loading}
            >
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18Z"/>
                <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17Z"/>
                <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07Z"/>
                <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3Z"/>
              </svg>
              Continue with Google
            </button>

            <button
              type="button"
              className="auth-sso-link"
              onClick={() => setMode('sso')}
              disabled={loading}
            >
              Sign in with company SSO
            </button>
          </>
        )}

        <div className="auth-footer">
          {mode === 'login' && (
            <>
              <p>
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setError('');
                  }}
                  className="auth-link-btn"
                >
                  Sign up
                </button>
              </p>
              <button
                type="button"
                onClick={() => {
                  setMode('reset');
                  setError('');
                }}
                className="auth-link-btn"
              >
                Forgot password?
              </button>
            </>
          )}

          {mode === 'signup' && (
            <p>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                className="auth-link-btn"
              >
                Sign in
              </button>
            </p>
          )}

          {(mode === 'sso' || mode === 'reset') && (
            <p>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                  setMessage('');
                }}
                className="auth-link-btn"
              >
                ← Back to sign in
              </button>
            </p>
          )}
        </div>

        {onDismiss && (
          <div className="auth-dismiss">
            <button type="button" onClick={onDismiss} className="auth-dismiss-btn">
              Continue without an account
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
