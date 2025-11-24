import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AuthModal } from './AuthModal';

/**
 * OptionalAuthPrompt Component
 *
 * This component handles the "optional login flow" where users see a
 * dismissible prompt to sign in when they first open the app.
 *
 * Features:
 * - Shows auth modal immediately on first visit
 * - User can dismiss and continue without account
 * - Only remembers dismissal if user is authenticated
 * - For non-authenticated users, always prompts on app load
 * - Can be triggered manually via showAuthModal prop
 *
 * Usage:
 * <OptionalAuthPrompt showAuthModal={showAuthModal} onAuthModalChange={setShowAuthModal} />
 */
export const OptionalAuthPrompt = ({ showAuthModal, onAuthModalChange }) => {
  const { isAuthenticated, loading } = useAuth();
  const [authPromptDismissed, setAuthPromptDismissed] = useState(false);

  // Clear dismissal flag for non-authenticated users on app load
  // Only authenticated users should have their dismissal remembered
  useEffect(() => {
    if (!loading) {
      if (!isAuthenticated) {
        // Clear dismissal flag for non-authenticated users (so modal shows on each new session)
        localStorage.removeItem('authPromptDismissed');
        // Reset to false so modal can be shown for this new session
        setAuthPromptDismissed(false);
      } else {
        // Only check for dismissal if user is authenticated
        const dismissed = localStorage.getItem('authPromptDismissed');
        if (dismissed === 'true') {
          setAuthPromptDismissed(true);
        }
      }
    }
  }, [loading, isAuthenticated]);

  // Show auth prompt on first visit (if not dismissed and not logged in)
  useEffect(() => {
    if (!loading && !isAuthenticated && !authPromptDismissed && !showAuthModal) {
      // Show modal immediately for non-authenticated users
      onAuthModalChange?.(true);
    }
  }, [loading, isAuthenticated, authPromptDismissed, showAuthModal, onAuthModalChange]);

  const handleDismiss = () => {
    // For non-authenticated users: dismiss for current session only (don't persist)
    // For authenticated users: persist dismissal to localStorage
    if (isAuthenticated) {
      localStorage.setItem('authPromptDismissed', 'true');
    }
    // Set dismissed to true so modal doesn't show again this session
    // (but will show again on next session/reload for non-authenticated users)
    setAuthPromptDismissed(true);
    onAuthModalChange?.(false);
  };

  const handleClose = () => {
    // Same behavior as dismiss - close modal and mark as dismissed for this session
    if (isAuthenticated) {
      localStorage.setItem('authPromptDismissed', 'true');
    }
    setAuthPromptDismissed(true);
    onAuthModalChange?.(false);
  };

  return (
    <AuthModal
      isOpen={showAuthModal}
      onClose={handleClose}
      onDismiss={!isAuthenticated ? handleDismiss : null}
    />
  );
};

/**
 * Hook version for easier integration
 *
 * Usage:
 * const { showAuthModal, setShowAuthModal } = useOptionalAuth();
 *
 * Then render: <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
 */
export const useOptionalAuth = () => {
  const { isAuthenticated, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authPromptDismissed, setAuthPromptDismissed] = useState(false);

  // Clear dismissal flag for non-authenticated users on app load
  // Only authenticated users should have their dismissal remembered
  useEffect(() => {
    if (!loading) {
      if (!isAuthenticated) {
        // Clear dismissal flag for non-authenticated users (so modal shows on each new session)
        localStorage.removeItem('authPromptDismissed');
        // Reset to false so modal can be shown for this new session
        setAuthPromptDismissed(false);
      } else {
        // Only check for dismissal if user is authenticated
        const dismissed = localStorage.getItem('authPromptDismissed');
        if (dismissed === 'true') {
          setAuthPromptDismissed(true);
        }
      }
    }
  }, [loading, isAuthenticated]);

  useEffect(() => {
    if (!loading && !isAuthenticated && !authPromptDismissed && !showAuthModal) {
      // Show modal immediately for non-authenticated users
      setShowAuthModal(true);
    }
  }, [loading, isAuthenticated, authPromptDismissed, showAuthModal]);

  const handleDismiss = () => {
    // For non-authenticated users: dismiss for current session only (don't persist)
    // For authenticated users: persist dismissal to localStorage
    if (isAuthenticated) {
      localStorage.setItem('authPromptDismissed', 'true');
    }
    // Set dismissed to true so modal doesn't show again this session
    // (but will show again on next session/reload for non-authenticated users)
    setAuthPromptDismissed(true);
    setShowAuthModal(false);
  };

  return {
    showAuthModal,
    setShowAuthModal,
    handleDismiss,
    authPromptDismissed,
  };
};
