import test from "node:test";
import assert from "node:assert/strict";
import { PROFILE_KEY, GOOGLE_SCOPES } from "./google-drive.js";
import {
  initials,
  isGooglePicture,
  profileFromResponse,
  safeNext,
  getAccount,
  signIn,
} from "./account.js";

const TOKEN_KEY = "paperlab.google.token";

function withStorage(entries = {}) {
  const previous = globalThis.sessionStorage;
  const store = new Map(Object.entries(entries));
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  return {
    store,
    restore: () => {
      globalThis.sessionStorage = previous;
    },
  };
}

test("initials takes the first letters of the first and last word", () => {
  assert.equal(initials("Ada Lovelace"), "AL");
  assert.equal(initials("  grace   brewster murray  "), "GM");
  assert.equal(initials("Ada"), "AD");
  assert.equal(initials("ada.lovelace"), "AL");
  assert.equal(initials(""), "G");
  assert.equal(initials("---"), "G");
});

test("isGooglePicture accepts only HTTPS googleusercontent hosts", () => {
  assert.equal(isGooglePicture("https://lh3.googleusercontent.com/a/abc=s96-c"), true);
  assert.equal(isGooglePicture("https://googleusercontent.com/a/abc"), true);
  assert.equal(isGooglePicture("http://lh3.googleusercontent.com/a/abc"), false);
  assert.equal(isGooglePicture("https://googleusercontent.com.evil.com/a"), false);
  assert.equal(isGooglePicture("https://evil.com/?googleusercontent.com"), false);
  assert.equal(isGooglePicture("javascript:alert(1)"), false);
  assert.equal(isGooglePicture("/a.png"), false);
  assert.equal(isGooglePicture(""), false);
  assert.equal(isGooglePicture(`https://lh3.googleusercontent.com/${"a".repeat(2049)}`), false);
});

test("profileFromResponse trims and sanitizes the display profile", () => {
  assert.deepEqual(
    profileFromResponse({
      name: " Ada\nLovelace ",
      email: " ada@example.com ",
      picture: "https://lh3.googleusercontent.com/a/abc",
    }),
    { name: "Ada Lovelace", email: "ada@example.com", picture: "https://lh3.googleusercontent.com/a/abc" }
  );
  assert.deepEqual(
    profileFromResponse({ name: "", email: "ada@example.com", picture: "https://evil.com/a.png" }),
    { name: "ada", email: "ada@example.com", picture: "" }
  );
  assert.equal(profileFromResponse({}), null);
  assert.equal(profileFromResponse(null), null);
  assert.equal(profileFromResponse({ name: 42, email: [] }), null);
  assert.equal(profileFromResponse({ name: "a".repeat(200) }).name.length, 120);
  assert.equal(profileFromResponse({ email: `${"a".repeat(250)}@x.com` }).email.length, 254);
});

test("safeNext accepts only single-slash relative paths", () => {
  assert.equal(safeNext("/tools.html"), "/tools.html");
  assert.equal(safeNext("/tools?q=ocr#top"), "/tools?q=ocr#top");
  assert.equal(safeNext("/login.html?next=%2Ftools"), "/login.html?next=%2Ftools");
  assert.equal(safeNext("/tools?next=//evil.com"), "/tools?next=//evil.com");
  for (const value of [
    "",
    "tools.html",
    "//evil.com",
    "///evil.com",
    "https://evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/tools\u0000",
    " /tools",
    "javascript:alert(1)",
  ]) {
    assert.equal(safeNext(value), "", value);
  }
});

test("getAccount clears an expired token and its profile", () => {
  const storage = withStorage({
    [TOKEN_KEY]: JSON.stringify({ accessToken: "tok", expiresAt: 1000 }),
    [PROFILE_KEY]: JSON.stringify({ name: "Ada" }),
  });
  try {
    assert.equal(getAccount(2000), null);
    assert.equal(storage.store.has(TOKEN_KEY), false);
    assert.equal(storage.store.has(PROFILE_KEY), false);
  } finally {
    storage.restore();
  }
});

test("getAccount clears a profile with no token", () => {
  const storage = withStorage({ [PROFILE_KEY]: JSON.stringify({ name: "Ada" }) });
  try {
    assert.equal(getAccount(), null);
    assert.equal(storage.store.has(PROFILE_KEY), false);
  } finally {
    storage.restore();
  }
});

test("getAccount returns the sanitized profile for a fresh token", () => {
  const storage = withStorage({
    [TOKEN_KEY]: JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 60_000 }),
    [PROFILE_KEY]: JSON.stringify({
      name: " Ada ",
      email: "ada@example.com",
      picture: "https://evil.com/a.png",
    }),
  });
  try {
    assert.deepEqual(getAccount(), { name: "Ada", email: "ada@example.com", picture: "" });
  } finally {
    storage.restore();
  }
});

test("getAccount keeps a fresh token while the profile is missing", () => {
  const storage = withStorage({
    [TOKEN_KEY]: JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 60_000 }),
  });
  try {
    assert.equal(getAccount(), null);
    assert.equal(storage.store.has(TOKEN_KEY), true);
  } finally {
    storage.restore();
  }
});

test("signIn caches the profile returned by userinfo", async () => {
  const storage = withStorage();
  const previousGoogle = globalThis.google;
  const previousConfig = globalThis.PAPERLAB_GOOGLE;
  globalThis.PAPERLAB_GOOGLE = { clientId: "client" };
  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient({ callback }) {
          return {
            requestAccessToken() {
              callback({ access_token: "fresh", expires_in: 3600, scope: "openid email profile" });
            },
          };
        },
      },
    },
  };
  const fetchImpl = async () =>
    new Response(JSON.stringify({ name: "Ada", email: "ada@example.com" }), { status: 200 });
  try {
    const profile = await signIn({ fetchImpl });
    assert.equal(profile.name, "Ada");
    assert.equal(getAccount()?.email, "ada@example.com");
    assert.equal(JSON.parse(storage.store.get(TOKEN_KEY)).scope, "openid email profile");
  } finally {
    storage.restore();
    globalThis.google = previousGoogle;
    globalThis.PAPERLAB_GOOGLE = previousConfig;
  }
});

test("signIn re-consents when a Drive-only token lacks identity scopes", async () => {
  const storage = withStorage({
    [TOKEN_KEY]: JSON.stringify({ accessToken: "drive-only", expiresAt: Date.now() + 60_000 }),
  });
  const previousGoogle = globalThis.google;
  const previousConfig = globalThis.PAPERLAB_GOOGLE;
  globalThis.PAPERLAB_GOOGLE = { clientId: "client" };
  let requests = 0;
  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient({ callback }) {
          return {
            requestAccessToken() {
              requests++;
              callback({ access_token: "fresh", expires_in: 3600, scope: GOOGLE_SCOPES });
            },
          };
        },
      },
    },
  };
  const fetchImpl = async () =>
    new Response(JSON.stringify({ name: "Ada", email: "ada@example.com" }), { status: 200 });
  try {
    const profile = await signIn({ fetchImpl });
    assert.equal(profile.name, "Ada");
    assert.equal(requests, 1);
    assert.equal(JSON.parse(storage.store.get(TOKEN_KEY)).accessToken, "fresh");
  } finally {
    storage.restore();
    globalThis.google = previousGoogle;
    globalThis.PAPERLAB_GOOGLE = previousConfig;
  }
});

test("signIn clears a Drive-only token when userinfo is forbidden", async () => {
  const storage = withStorage({
    [TOKEN_KEY]: JSON.stringify({
      accessToken: "old",
      expiresAt: Date.now() + 60_000,
      scope: GOOGLE_SCOPES,
    }),
    [PROFILE_KEY]: JSON.stringify({ name: "Old" }),
  });
  const previousConfig = globalThis.PAPERLAB_GOOGLE;
  globalThis.PAPERLAB_GOOGLE = { clientId: "client" };
  const fetchImpl = async () => new Response("", { status: 403 });
  try {
    await assert.rejects(signIn({ fetchImpl }), /sign in again/i);
    assert.equal(storage.store.has(TOKEN_KEY), false);
    assert.equal(storage.store.has(PROFILE_KEY), false);
  } finally {
    storage.restore();
    globalThis.PAPERLAB_GOOGLE = previousConfig;
  }
});
