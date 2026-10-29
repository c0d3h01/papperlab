import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptsPDF,
  googleConfigured,
  tokenFresh,
  uploadChunks,
  driveFolderQuery,
  capFiles,
  isOversize,
  findOrCreateFolder,
  uploadBlob,
  saveBlobToDrive,
  GOOGLE_SCOPES,
  PROFILE_KEY,
  GoogleProfileError,
  fetchGoogleProfile,
  disconnectDrive,
} from "./google-drive.js";

test("acceptsPDF allows empty and PDF accepts", () => {
  assert.equal(acceptsPDF(""), true);
  assert.equal(acceptsPDF(".pdf,application/pdf"), true);
  assert.equal(acceptsPDF(".docx"), false);
});

test("the consent requests identity and Drive file access together", () => {
  assert.equal(
    GOOGLE_SCOPES,
    "openid email profile https://www.googleapis.com/auth/drive.file"
  );
});

test("googleConfigured requires a client id", () => {
  assert.equal(googleConfigured({ clientId: "" }), false);
  assert.equal(googleConfigured({ clientId: "abc" }), true);
});

test("tokenFresh rejects missing and expired tokens", () => {
  assert.equal(tokenFresh(null), false);
  assert.equal(tokenFresh({ accessToken: "x", expiresAt: 1000 }, 999), true);
  assert.equal(tokenFresh({ accessToken: "x", expiresAt: 1000 }, 1000), false);
});

test("uploadChunks splits on the chunk size with an exclusive end", () => {
  assert.deepEqual(uploadChunks(20, 8), [
    { start: 0, end: 8 },
    { start: 8, end: 16 },
    { start: 16, end: 20 },
  ]);
  assert.deepEqual(uploadChunks(8, 8), [{ start: 0, end: 8 }]);
  assert.deepEqual(uploadChunks(0, 8), []);
  assert.throws(() => uploadChunks(10, 0), RangeError);
});

test("driveFolderQuery escapes quotes and backslashes", () => {
  assert.equal(
    driveFolderQuery("PaperLab"),
    "name='PaperLab' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents"
  );
  assert.equal(driveFolderQuery("Bob's Lab").includes("Bob\\'s Lab"), true);
  assert.equal(driveFolderQuery("a\\b").includes("a\\\\b"), true);
});

test("capFiles keeps existing files and reports skipped imports", () => {
  const a = { name: "a" };
  const b = { name: "b" };
  const c = { name: "c" };
  assert.deepEqual(capFiles([a], [b, c], 2), { files: [a, b], skipped: 1 });
  assert.deepEqual(capFiles([], [a, b], 1), { files: [a], skipped: 1 });
  assert.deepEqual(capFiles([a], [b], 0), { files: [a], skipped: 1 });
});

test("isOversize only rejects known sizes over the limit", () => {
  assert.equal(isOversize(11 * 1024 * 1024, 10), true);
  assert.equal(isOversize(10 * 1024 * 1024, 10), false);
  assert.equal(isOversize(null, 10), false);
  assert.equal(isOversize(999, 0), false);
});

test("findOrCreateFolder returns an existing PaperLab folder", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ files: [{ id: "folder1" }] }), { status: 200 });
  };
  const id = await findOrCreateFolder("token", { fetchImpl });
  assert.equal(id, "folder1");
  assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer token");
});

test("findOrCreateFolder creates the folder when missing", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return new Response(JSON.stringify({ files: [] }), { status: 200 });
    return new Response(JSON.stringify({ id: "newfolder" }), { status: 200 });
  };
  const id = await findOrCreateFolder("token", { fetchImpl });
  assert.equal(id, "newfolder");
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    name: "PaperLab",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["root"],
  });
});

test("uploadBlob opens a resumable session and sends chunk ranges", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return new Response(null, { status: 200, headers: { Location: "https://upload.example/session" } });
    }
    if (calls.length < 4) return new Response(null, { status: 308 });
    return new Response(
      JSON.stringify({ id: "f1", name: "out.pdf", webViewLink: "https://drive.google.com/f1" }),
      { status: 200 }
    );
  };
  const progress = [];
  const saved = await uploadBlob("token", new Blob(["abcde"]), "out.pdf", "folder1", {
    fetchImpl,
    chunkSize: 2,
    onProgress: (p) => progress.push(p),
  });
  assert.equal(saved.id, "f1");
  assert.deepEqual(progress, [0.4, 0.8, 1]);
  assert.equal(new Headers(calls[0].init.headers).get("X-Upload-Content-Length"), "5");
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: "out.pdf", parents: ["folder1"] });
  assert.equal(new Headers(calls[1].init.headers).get("Content-Range"), "bytes 0-1/5");
  assert.equal(new Headers(calls[2].init.headers).get("Content-Range"), "bytes 2-3/5");
  assert.equal(new Headers(calls[3].init.headers).get("Content-Range"), "bytes 4-4/5");
});

test("uploadBlob retries a 5xx chunk once", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response(null, { status: 200, headers: { Location: "https://upload.example/session" } });
    }
    if (calls.length === 2) return new Response(null, { status: 503 });
    return new Response(JSON.stringify({ id: "f1", name: "out.pdf" }), { status: 200 });
  };
  const saved = await uploadBlob("token", new Blob(["abcde"]), "out.pdf", "folder1", {
    fetchImpl,
    chunkSize: 8,
  });
  assert.equal(saved.id, "f1");
  assert.equal(calls.length, 3);
});

test("saveBlobToDrive re-authenticates once after a 401", async () => {
  const previousGoogle = globalThis.google;
  const previousStorage = globalThis.sessionStorage;
  const previousConfig = globalThis.PAPERLAB_GOOGLE;
  const store = new Map([
    ["paperlab.google.token", JSON.stringify({ accessToken: "old", expiresAt: Date.now() + 60_000 })],
  ]);
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  globalThis.PAPERLAB_GOOGLE = { clientId: "client" };
  let tokenRequests = 0;
  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient({ callback }) {
          return {
            requestAccessToken() {
              tokenRequests++;
              callback({ access_token: "fresh", expires_in: 3600 });
            },
          };
        },
      },
    },
  };

  const auth = [];
  let folderCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    auth.push(new Headers(init.headers).get("Authorization"));
    if (String(url).includes("uploadType=resumable")) {
      return new Response(null, { status: 200, headers: { Location: "https://upload.example/session" } });
    }
    if (String(url).includes("drive/v3/files?")) {
      folderCalls++;
      if (folderCalls === 1) return new Response(null, { status: 401 });
      return new Response(JSON.stringify({ files: [{ id: "folder1" }] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ id: "f1", name: "out.pdf", webViewLink: "https://drive.google.com/f1" }),
      { status: 200 }
    );
  };

  try {
    const saved = await saveBlobToDrive(new Blob(["abc"]), "out.pdf", { fetchImpl });
    assert.equal(saved.id, "f1");
    assert.equal(tokenRequests, 1);
    assert.deepEqual(auth.slice(0, 2), ["Bearer old", "Bearer fresh"]);
  } finally {
    globalThis.google = previousGoogle;
    globalThis.sessionStorage = previousStorage;
    globalThis.PAPERLAB_GOOGLE = previousConfig;
  }
});

test("fetchGoogleProfile reads userinfo with the bearer token", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ name: "Ada", email: "ada@example.com" }), { status: 200 });
  };
  const profile = await fetchGoogleProfile("tok", { fetchImpl });
  assert.deepEqual(profile, { name: "Ada", email: "ada@example.com" });
  assert.equal(calls[0].url, "https://openidconnect.googleapis.com/v1/userinfo");
  assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer tok");
});

test("fetchGoogleProfile exposes the HTTP status", async () => {
  const fetchImpl = async () => new Response("", { status: 401 });
  await assert.rejects(fetchGoogleProfile("tok", { fetchImpl }), (error) => {
    return error instanceof GoogleProfileError && error.status === 401;
  });
});

test("disconnectDrive clears the token and cached profile", async () => {
  const previousGoogle = globalThis.google;
  const previousStorage = globalThis.sessionStorage;
  const store = new Map([
    ["paperlab.google.token", JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 60_000 })],
    [PROFILE_KEY, JSON.stringify({ name: "Ada" })],
  ]);
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  let revoked = "";
  globalThis.google = {
    accounts: {
      oauth2: {
        revoke(token, callback) {
          revoked = token;
          callback();
        },
      },
    },
  };

  try {
    await disconnectDrive();
    assert.equal(store.has("paperlab.google.token"), false);
    assert.equal(store.has(PROFILE_KEY), false);
    assert.equal(revoked, "tok");
  } finally {
    globalThis.google = previousGoogle;
    globalThis.sessionStorage = previousStorage;
  }
});
