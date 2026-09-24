/**
 * UserAuthButton.jsx
 * Top bar user profile / sign-in button with dropdown menu.
 */
import React, { useState, useRef, useEffect } from 'react';
import { signOutUser } from '../firebase/authService';

export default function UserAuthButton({
  user,
  cloudSyncStatus, // 'synced' | 'saving' | 'offline' | 'error'
  onOpenAuthModal,
  addToast,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleSignOut() {
    try {
      await signOutUser();
      setDropdownOpen(false);
      addToast?.('info', 'Signed out', 'You are now working in local offline mode.');
    } catch (err) {
      addToast?.('error', 'Sign out failed', err.message);
    }
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
        <button
          id="btn-auth-signin"
          className="btn btn--primary btn--sm"
          style={{ gap: 6 }}
          onClick={onOpenAuthModal}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          Sign In / Register
        </button>
      </div>
    );
  }

  const initial = (user.displayName || user.email || 'U')[0].toUpperCase();

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
      {/* Cloud sync indicator */}
      <div
        title={
          cloudSyncStatus === 'saving'
            ? 'Saving to Firestore Cloud...'
            : cloudSyncStatus === 'synced'
            ? 'All projects synced to Cloud'
            : cloudSyncStatus === 'error'
            ? 'Cloud sync issue'
            : 'Working offline'
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: '11px',
          color:
            cloudSyncStatus === 'saving'
              ? 'var(--warning, #f59e0b)'
              : cloudSyncStatus === 'synced'
              ? '#10b981'
              : 'var(--text-muted)',
          padding: '2px 8px',
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-full)',
          border: '1px solid var(--border-default)',
        }}
      >
        <span>
          {cloudSyncStatus === 'saving' ? '⏳' : cloudSyncStatus === 'synced' ? '☁️' : '📁'}
        </span>
        <span style={{ fontWeight: 500 }}>
          {cloudSyncStatus === 'saving' ? 'Saving...' : cloudSyncStatus === 'synced' ? 'Synced' : 'Local'}
        </span>
      </div>

      {/* User profile button */}
      <button
        id="btn-user-profile"
        className="btn btn--ghost btn--sm"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '3px 8px',
          borderRadius: 'var(--radius-full)',
          background: dropdownOpen ? 'var(--bg-hover)' : 'transparent',
        }}
        onClick={() => setDropdownOpen(prev => !prev)}
        aria-expanded={dropdownOpen}
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt="Profile"
            style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--accent-primary), #7c3aed)',
              color: '#fff',
              fontSize: '11px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {initial}
          </div>
        )}
        <span style={{ fontSize: '12px', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.displayName || user.email.split('@')[0]}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {/* Dropdown Menu */}
      {dropdownOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-xl)',
            width: 220,
            zIndex: 1000,
            padding: 6,
            animation: 'fadeIn 120ms ease',
          }}
        >
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-default)', marginBottom: 4 }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Signed in as</div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-heading)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.email}
            </div>
          </div>

          <button
            className="btn btn--ghost btn--sm"
            style={{
              width: '100%',
              justifyContent: 'flex-start',
              gap: 8,
              color: '#f87171',
            }}
            onClick={handleSignOut}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
