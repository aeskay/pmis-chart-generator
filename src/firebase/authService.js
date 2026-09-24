/**
 * authService.js
 * Firebase Authentication wrapper methods for PMIS Chart Studio.
 */
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth, googleProvider } from './config';

/**
 * Register a new user with email and password.
 */
export async function signUpWithEmail(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/**
 * Sign in an existing user with email and password.
 */
export async function signInWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/**
 * Sign in with Google Popup.
 */
export async function signInWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

/**
 * Sign out the current user.
 */
export async function signOutUser() {
  await signOut(auth);
}

/**
 * Subscribe to authentication state changes.
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Send password reset email.
 */
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

/**
 * Format Firebase Auth error codes into friendly user messages.
 */
export function formatAuthError(error) {
  if (!error) return 'An unknown error occurred.';
  const code = error.code || '';
  switch (code) {
    case 'auth/invalid-email':
      return 'The email address is invalid.';
    case 'auth/user-disabled':
      return 'This user account has been disabled.';
    case 'auth/user-not-found':
      return 'No account found with this email. Please switch to the "Create Account" tab above to register!';
    case 'auth/wrong-password':
      return 'Incorrect password. Please try again or click "Forgot password?".';
    case 'auth/invalid-credential':
      return 'Invalid credentials or account does not exist. If you are new here, please click the "Create Account" tab above to register!';
    case 'auth/email-already-in-use':
      return 'An account with this email address already exists.';
    case 'auth/weak-password':
      return 'The password is too weak. Please use at least 6 characters.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before completing.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in Firebase Console. Please enable Email/Password or Google in Firebase Auth.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection.';
    default:
      return error.message || 'Authentication failed. Please try again.';
  }
}
