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
  googleConfigured,
  readGoogleProfile,
  readGoogleToken,
  tokenFresh,
  writeGoogleProfile,
} from "./google-drive.js";
import { h, toast } from "./ui.js";
import { googleG, icon } from "./icons.js";

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
  const stored = readGoogleToken();
  // Tokens from the Drive-only release cannot call userinfo; re-consent once.
  if (tokenFresh(stored) && !String(stored.scope || "").split(/\s+/).includes("openid")) {
    clearGoogleSession();
  }
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

/* -------------------------------------------------------------------------- */
/* Header account slot                                                        */

function loginHref() {
  const path = `${location.pathname}${location.search}`;
  if (/\/login(?:\.html)?\/?$/.test(location.pathname)) return "login.html";
  return `login.html?next=${encodeURIComponent(path)}`;
}

export function accountAvatar(profile, size = 32) {
  const wrap = h("span", { class: `account-avatar account-avatar-${size}` });
  const fallback = () => h("span", { class: "account-avatar-fallback", text: initials(profile.name) });
  if (!profile.picture) {
    wrap.append(fallback());
    return wrap;
  }
  const img = h("img", {
    src: profile.picture,
    alt: "",
    width: size,
    height: size,
    referrerpolicy: "no-referrer",
  });
  img.addEventListener("error", () => img.replaceWith(fallback()));
  wrap.append(img);
  return wrap;
}

export function mountAccountButton(container) {
  if (!googleConfigured()) {
    container.hidden = true;
    return null;
  }
  container.hidden = false;

  let cleanup = () => {};

  function render() {
    cleanup();
    cleanup = () => {};

    const profile = getAccount();
    if (!profile) {
      container.replaceChildren(
        h(
          "a",
          {
            class: "account-signin",
            href: loginHref(),
            "aria-label": "Sign in with Google",
            title: "Sign in with Google",
          },
          h("span", { html: googleG(16) }),
          h("span", { class: "account-label", text: "Sign in" })
        )
      );
      return;
    }

    const menu = h(
      "div",
      { class: "account-menu", role: "menu", hidden: true, "aria-label": "Google account" },
      h(
        "div",
        { class: "account-menu-head" },
        accountAvatar(profile, 40),
        h(
          "div",
          { class: "account-menu-id" },
          h("strong", { class: "account-menu-name", text: profile.name }),
          profile.email ? h("span", { class: "account-menu-email", text: profile.email }) : null
        )
      ),
      h(
        "div",
        { class: "account-menu-row" },
        h("span", { class: "account-dot", "aria-hidden": "true" }),
        "Google Drive connected"
      ),
      h(
        "div",
        { class: "account-menu-links" },
        h(
          "a",
          { class: "account-menu-link", href: "login.html", role: "menuitem" },
          "Manage Google Drive",
          h("span", { html: icon("chevron", 14) })
        ),
        h(
          "a",
          { class: "account-menu-link", href: "privacy.html", role: "menuitem" },
          "Privacy",
          h("span", { html: icon("external", 13) })
        )
      ),
      h("button", {
        class: "account-menu-signout",
        type: "button",
        role: "menuitem",
        text: "Sign out",
        onclick: handleSignOut,
      })
    );

    const button = h(
      "button",
      {
        class: "account-button",
        type: "button",
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        "aria-label": `Google account: ${profile.name}`,
        title: profile.email || profile.name,
      },
      accountAvatar(profile, 32),
      h("span", { class: "account-dot", "aria-hidden": "true" })
    );

    let onPointer;
    let onKey;
    const close = ({ focus = false } = {}) => {
      if (menu.hidden) return;
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      if (focus) button.focus();
    };
    const open = () => {
      if (!menu.hidden) return;
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      onPointer = (event) => {
        if (!container.contains(event.target)) close();
      };
      onKey = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        close({ focus: true });
      };
      document.addEventListener("pointerdown", onPointer);
      document.addEventListener("keydown", onKey);
    };

    cleanup = () => close();
    button.addEventListener("click", () => {
      if (menu.hidden) open();
      else close({ focus: true });
    });
    menu.addEventListener("click", (event) => {
      if (event.target.closest("a")) close();
    });

    async function handleSignOut() {
      const action = menu.querySelector(".account-menu-signout");
      action.disabled = true;
      action.textContent = "Signing out…";
      try {
        await signOut();
        toast("Signed out of Google.", "success");
      } catch (error) {
        toast(error.message || "Could not sign out.", "error");
        action.disabled = false;
        action.textContent = "Sign out";
      }
    }

    container.replaceChildren(button, menu);
  }

  render();
  window.addEventListener(ACCOUNT_EVENT, render);
  return container;
}
