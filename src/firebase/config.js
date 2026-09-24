/**
 * config.js
 * Firebase initialization for PMIS Chart Studio.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBLhdh0cU9Pi1nFiEcXM4kCvcDgWxMQ9jE",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "pmis-charts.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "pmis-charts",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "pmis-charts.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "445530218314",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:445530218314:web:1c8005af9f6c4dfdbe6bb3",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-JM4RSQ49X6"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
