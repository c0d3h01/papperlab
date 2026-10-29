/*
 * Google account state and the header account entry point.
 *
 * Identity is display-only: the profile is cached in sessionStorage and never
 * sent to the PaperLab API.
 */

import {
  clearGoogleSession,
  disconnectDrive,
  ensureDriveToken,
  fetchGoogleProfile,
  readGoogleProfile,
  readGoogleToken,
  tokenFresh,
  writeGoogleProfile,
} from "./google-drive.js";

export const ACCOUNT_EVENT = "paperlab:account";

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function initials(name = "") {
  const words = String(name).trim().split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return "G";
  const letters =
    words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}

export function isGooglePicture(value) {
  if (typeof value !== "string" || !value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com");
  } catch {
    return false;
  }
}

export function profileFromResponse(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const name = cleanText(data.name, 120);
  const email = cleanText(data.email, 254);
  if (!name && !email) return null;
  return {
    name: name || email.split("@")[0],
    email,
    picture: isGooglePicture(data.picture) ? data.picture : "",
  };
}

export function safeNext(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "";
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "";
  try {
    const base = "https://paperlab.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

export function getAccount(now = Date.now()) {
  const token = readGoogleToken();
  if (!tokenFresh(token, now)) {
    if (token || readGoogleProfile()) clearGoogleSession();
    return null;
  }
  return profileFromResponse(readGoogleProfile());
}

function announceAccount() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT));
  }
}

export async function signIn({ fetchImpl } = {}) {
  const token = await ensureDriveToken();
  let data;
  try {
    data = await fetchGoogleProfile(token, { fetchImpl });
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) {
      clearGoogleSession();
      throw new Error("Google needs you to sign in again.");
    }
    throw error;
  }
  const profile = profileFromResponse(data);
  if (!profile) {
    clearGoogleSession();
    throw new Error("Google did not return a profile.");
  }
  writeGoogleProfile(profile);
  announceAccount();
  return profile;
}

export async function signOut() {
  await disconnectDrive();
}
