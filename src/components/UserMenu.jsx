import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './UserMenu.css';

export const UserMenu = ({ onOpenSettings }) => {
  const { user, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!user) return null;

  const handleSignOut = async () => {
    try {
      await signOut();
      setIsOpen(false);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  // Get user initials for avatar
  const getInitials = () => {
    if (user.user_metadata?.full_name) {
      return user.user_metadata.full_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return user.email?.charAt(0).toUpperCase() || '?';
  };

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        className="user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title={user.email}
      >
        <div className="user-avatar">{getInitials()}</div>
      </button>

      {isOpen && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header">
            <div className="user-avatar-large">{getInitials()}</div>
            <div className="user-info">
              <div className="user-name">
                {user.user_metadata?.full_name || 'User'}
              </div>
              <div className="user-email">{user.email}</div>
            </div>
          </div>

          <div className="user-menu-divider" />

          <div className="user-menu-items">
            {onOpenSettings && (
              <button
                className="user-menu-item"
                onClick={() => {
                  onOpenSettings();
                  setIsOpen(false);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 10a2 2 0 100-4 2 2 0 000 4z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M12.93 10a1.11 1.11 0 00.22 1.22l.04.04a1.34 1.34 0 010 1.9 1.34 1.34 0 01-1.9 0l-.04-.04a1.11 1.11 0 00-1.22-.22 1.11 1.11 0 00-.67 1.02v.11a1.34 1.34 0 01-2.68 0v-.06a1.11 1.11 0 00-.73-1.02 1.11 1.11 0 00-1.22.22l-.04.04a1.34 1.34 0 01-1.9 0 1.34 1.34 0 010-1.9l.04-.04a1.11 1.11 0 00.22-1.22 1.11 1.11 0 00-1.02-.67h-.11a1.34 1.34 0 010-2.68h.06a1.11 1.11 0 001.02-.73 1.11 1.11 0 00-.22-1.22l-.04-.04a1.34 1.34 0 010-1.9 1.34 1.34 0 011.9 0l.04.04a1.11 1.11 0 001.22.22h.05a1.11 1.11 0 00.67-1.02v-.11a1.34 1.34 0 012.68 0v.06a1.11 1.11 0 00.67 1.02 1.11 1.11 0 001.22-.22l.04-.04a1.34 1.34 0 011.9 0 1.34 1.34 0 010 1.9l-.04.04a1.11 1.11 0 00-.22 1.22v.05a1.11 1.11 0 001.02.67h.11a1.34 1.34 0 010 2.68h-.06a1.11 1.11 0 00-1.02.67z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Settings
              </button>
            )}

            <button className="user-menu-item" onClick={handleSignOut}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M6 14H3.33A1.33 1.33 0 012 12.67V3.33A1.33 1.33 0 013.33 2H6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10.67 11.33L14 8l-3.33-3.33M14 8H6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Sign Out
            </button>
          </div>

          <div className="user-menu-footer">
            <div className="user-menu-version">Survey App v1.0</div>
          </div>
        </div>
      )}
    </div>
  );
};
