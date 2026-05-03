// auth.js — Firebase authentication wrapper

import { auth } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

/**
 * Create a new account, then set the display name.
 */
export async function signup(email, password, displayName) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName && displayName.trim()) {
    await updateProfile(credential.user, { displayName: displayName.trim() });
  }
  return credential.user;
}

/**
 * Sign in with email + password.
 */
export async function login(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/**
 * Sign in with a Google popup.
 */
export async function googleLogin() {
  const provider = new GoogleAuthProvider();
  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

/**
 * Sign out the current user.
 */
export async function logout() {
  await signOut(auth);
}

/**
 * Subscribe to auth state changes.
 * @param {Function} callback  Called with the Firebase User object, or null on sign-out.
 */
export function listenAuth(callback) {
  return onAuthStateChanged(auth, callback);
}