/**
 * AuthModal.jsx
 * Sign In & Registration modal with Email/Password and Google Auth.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  resetPassword,
  formatAuthError,
} from '../../firebase/authService';

export default function AuthModal({ isOpen, onClose, onSuccess, addToast }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const emailInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setTimeout(() => emailInputRef.current?.focus(), 80);
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMsg(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMsg('Please enter your email address.');
      return;
    }

    if (mode === 'forgot') {
      try {
        setLoading(true);
        await resetPassword(cleanEmail);
        addToast?.('success', 'Reset email sent', `Check ${cleanEmail} for password reset instructions.`);
        setMode('signin');
      } catch (err) {
        setErrorMsg(formatAuthError(err));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!password) {
      setErrorMsg('Please enter your password.');
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setErrorMsg('Passwords do not match. Please verify.');
      return;
    }

    try {
      setLoading(true);
      if (mode === 'signin') {
        const user = await signInWithEmail(cleanEmail, password);
        addToast?.('success', 'Signed in', `Welcome back, ${user.email}!`);
      } else {
        const user = await signUpWithEmail(cleanEmail, password);
        addToast?.('success', 'Account created', `Welcome to PMIS Chart Studio, ${user.email}!`);
      }
      onSuccess?.();
      onClose();
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setErrorMsg(null);
    try {
      setLoading(true);
      const user = await signInWithGoogle();
      addToast?.('success', 'Signed in with Google', `Welcome, ${user.displayName || user.email}!`);
      onSuccess?.();
      onClose();
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Account Login"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div className="modal modal--sm" style={{ width: '420px' }}>
        <div className="modal__header">
          <div>
            <div className="modal__title">
              {mode === 'signin' && 'Sign In'}
              {mode === 'signup' && 'Create Account'}
              {mode === 'forgot' && 'Reset Password'}
            </div>
            <div className="modal__subtitle">
              {mode === 'signin' && 'Access your projects securely in the cloud'}
              {mode === 'signup' && 'Save and sync your PMIS projects across devices'}
              {mode === 'forgot' && 'Enter your email to receive a password reset link'}
            </div>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        {/* Tab switchers if not in forgot mode */}
        {mode !== 'forgot' && (
          <div style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-default)',
            background: 'var(--bg-elevated)',
            flexShrink: 0,
          }}>
            <button
              type="button"
              style={{
                flex: 1,
                padding: '10px',
                border: 'none',
                background: mode === 'signin' ? 'var(--bg-panel)' : 'transparent',
                color: mode === 'signin' ? 'var(--text-heading)' : 'var(--text-muted)',
                fontWeight: mode === 'signin' ? 600 : 400,
                borderBottom: mode === 'signin' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: 'var(--text-xs)',
              }}
              onClick={() => { setMode('signin'); setErrorMsg(null); }}
            >
              Sign In
            </button>
            <button
              type="button"
              style={{
                flex: 1,
                padding: '10px',
                border: 'none',
                background: mode === 'signup' ? 'var(--bg-panel)' : 'transparent',
                color: mode === 'signup' ? 'var(--text-heading)' : 'var(--text-muted)',
                fontWeight: mode === 'signup' ? 600 : 400,
                borderBottom: mode === 'signup' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: 'var(--text-xs)',
              }}
              onClick={() => { setMode('signup'); setErrorMsg(null); }}
            >
              Create Account
            </button>
          </div>
        )}

        <form className="modal__form" onSubmit={handleSubmit}>
          <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {errorMsg && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#f87171',
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-xs)',
                lineHeight: 1.4,
              }}>
                {errorMsg}
              </div>
            )}

            <div className="form-group">
              <label className="form-label form-label--required" htmlFor="auth-email">
                Email Address
              </label>
              <input
                ref={emailInputRef}
                id="auth-email"
                type="email"
                className="form-input"
                placeholder="name@agency.gov"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            {mode !== 'forgot' && (
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label form-label--required" htmlFor="auth-password">
                    Password
                  </label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-primary)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                      onClick={() => { setMode('forgot'); setErrorMsg(null); }}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  id="auth-password"
                  type="password"
                  className="form-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  minLength={6}
                />
              </div>
            )}

            {mode === 'signup' && (
              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="auth-confirm-password">
                  Confirm Password
                </label>
                <input
                  id="auth-confirm-password"
                  type="password"
                  className="form-input"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                  minLength={6}
                />
              </div>
            )}

            {mode === 'forgot' && (
              <div style={{ textAlign: 'right' }}>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-primary)',
                    fontSize: 'var(--text-xs)',
                    cursor: 'pointer',
                  }}
                  onClick={() => { setMode('signin'); setErrorMsg(null); }}
                >
                  ← Back to Sign In
                </button>
              </div>
            )}

            <button
              type="submit"
              className="btn btn--primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
              disabled={loading}
            >
              {loading ? (
                <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              ) : mode === 'signin' ? (
                'Sign In'
              ) : mode === 'signup' ? (
                'Create Account'
              ) : (
                'Send Reset Email'
              )}
            </button>

            {mode !== 'forgot' && (
              <>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  margin: '4px 0',
                }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border-default)' }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>OR</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border-default)' }} />
                </div>

                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ width: '100%', justifyContent: 'center', gap: 8 }}
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.03h3.88c2.28-2.1 3.66-5.2 3.66-9.12z"/>
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.03c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.13C3.26 21.36 7.33 24 12 24z"/>
                    <path fill="#FBBC05" d="M5.28 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.58H1.25C.45 8.17 0 9.99 0 12s.45 3.83 1.25 5.42l4.03-3.13z"/>
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.13c.95-2.83 3.6-4.96 6.72-4.96z"/>
                  </svg>
                  Continue with Google
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
