/*
 * Optional Google Drive import/export.
 *
 * The module is inert until PAPERLAB_GOOGLE carries a client ID. Tokens stay in
 * sessionStorage; nothing here talks to the PaperLab API.
 */

import "./config.js";
import { h, toast } from "./ui.js";
import { icon } from "./icons.js";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "PaperLab";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const TOKEN_KEY = "paperlab.google.token";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";
const CHUNK_SIZE = 8 * 1024 * 1024;

const scriptPromises = new Map();
let tokenPromise = null;

class DriveAuthError extends Error {
  constructor() {
    super("Google Drive needs to reconnect.");
    this.name = "DriveAuthError";
  }
}

class DriveError extends Error {
  constructor(status) {
    super(`Drive request failed (${status}).`);
    this.name = "DriveError";
    this.status = status;
  }
}

export function acceptsPDF(accept = "") {
  return !accept || accept.includes(".pdf");
}

export function googleConfigured(config = globalThis.PAPERLAB_GOOGLE) {
  return Boolean(config?.clientId);
}

export function tokenFresh(token, now = Date.now()) {
  return Boolean(token?.accessToken) && Number(token.expiresAt) > now;
}

export function uploadChunks(size, chunkSize = CHUNK_SIZE) {
  const chunks = [];
  for (let start = 0; start < size; start += chunkSize) {
    chunks.push({ start, end: Math.min(start + chunkSize, size) });
  }
  return chunks;
}

export function driveFolderQuery(name) {
  const escaped = String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `name='${escaped}' and mimeType='${FOLDER_MIME}' and trashed=false and 'root' in parents`;
}

export function capFiles(existing, incoming, maxFiles) {
  const room = Math.max(0, maxFiles - existing.length);
  const taken = incoming.slice(0, room);
  return { files: existing.concat(taken), skipped: incoming.length - taken.length };
}

export function isOversize(sizeBytes, maxUploadMB) {
  const size = Number(sizeBytes);
  if (!maxUploadMB || !Number.isFinite(size) || size <= 0) return false;
  return size > maxUploadMB * 1024 * 1024;
}

/* -------------------------------------------------------------------------- */
/* Token + Google scripts                                                     */

function getConfig() {
  return globalThis.PAPERLAB_GOOGLE || {};
}

function readToken() {
  try {
    return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "null");
  } catch {
    return null;
  }
}

function writeToken(response) {
  const lifetime = Math.max(0, (Number(response.expires_in) || 3600) - 60);
  const token = {
    accessToken: response.access_token,
    expiresAt: Date.now() + lifetime * 1000,
  };
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch {
    // The token still works for this page even when storage is unavailable.
  }
  return token;
}

function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

function loadScript(src) {
  if (scriptPromises.has(src)) return scriptPromises.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Drive is unavailable right now."));
    document.head.append(script);
  });
  scriptPromises.set(src, promise);
  return promise;
}

async function loadGoogle() {
  await Promise.all([loadScript(GIS_SRC), loadScript(GAPI_SRC)]);
  if (!globalThis.google?.accounts?.oauth2) {
    throw new Error("Google Drive is unavailable right now.");
  }
}

async function loadPicker() {
  await loadGoogle();
  if (globalThis.google?.picker) return;
  await new Promise((resolve, reject) => {
    globalThis.gapi.load("picker", {
      callback: resolve,
      onerror: () => reject(new Error("Google Drive is unavailable right now.")),
    });
  });
}

function requestToken() {
  const config = getConfig();
  if (!config.clientId) return Promise.reject(new Error("Google Drive is not configured."));
  return new Promise((resolve, reject) => {
    const client = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response?.error) {
          reject(new Error(response.error_description || "Google Drive connection was cancelled."));
          return;
        }
        resolve(writeToken(response).accessToken);
      },
      error_callback: (error) => {
        reject(new Error(error?.message || "Google Drive connection was cancelled."));
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
}

async function ensureToken() {
  const stored = readToken();
  if (tokenFresh(stored)) return stored.accessToken;
  if (!tokenPromise) {
    tokenPromise = loadGoogle()
      .then(requestToken)
      .finally(() => {
        tokenPromise = null;
      });
  }
  return tokenPromise;
}

async function withAuthRetry(fn) {
  const token = await ensureToken();
  try {
    return await fn(token);
  } catch (error) {
    if (!(error instanceof DriveAuthError)) throw error;
    clearToken();
    return fn(await ensureToken());
  }
}

/* -------------------------------------------------------------------------- */
/* Drive REST                                                                 */

async function driveRequest(token, url, init = {}, fetchImpl = globalThis.fetch) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetchImpl(url, { ...init, headers });
  if (response.status === 401) throw new DriveAuthError();
  if (!response.ok) throw new DriveError(response.status);
  return response;
}

async function fetchWithRetry(url, init, fetchImpl, attempts = 3) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(url, init);
      if (response.status >= 500 && attempt < attempts - 1) {
        last = response;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  return last;
}

export async function findOrCreateFolder(token, { fetchImpl = globalThis.fetch } = {}) {
  const params = new URLSearchParams({
    q: driveFolderQuery(FOLDER_NAME),
    spaces: "drive",
    fields: "files(id,name)",
    pageSize: "1",
  });
  const listed = await driveRequest(
    token,
    `https://www.googleapis.com/drive/v3/files?${params}`,
    {},
    fetchImpl
  );
  const data = await listed.json();
  if (data.files?.length) return data.files[0].id;

  const created = await driveRequest(
    token,
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME, parents: ["root"] }),
    },
    fetchImpl
  );
  const folder = await created.json();
  return folder.id;
}

export async function uploadBlob(
  token,
  blob,
  name,
  folderId,
  { onProgress, fetchImpl = globalThis.fetch, chunkSize = CHUNK_SIZE } = {}
) {
  if (!blob.size) throw new Error("Drive cannot save an empty file.");

  const session = await driveRequest(
    token,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": blob.type || "application/octet-stream",
        "X-Upload-Content-Length": String(blob.size),
      },
      body: JSON.stringify({ name, parents: [folderId] }),
    },
    fetchImpl
  );
  const location = session.headers.get("Location");
  if (!location) throw new Error("Drive did not return an upload session.");

  for (const chunk of uploadChunks(blob.size, chunkSize)) {
    const body = blob.slice(chunk.start, chunk.end);
    const response = await fetchWithRetry(
      location,
      {
        method: "PUT",
        headers: {
          "Content-Length": String(body.size),
          "Content-Range": `bytes ${chunk.start}-${chunk.end - 1}/${blob.size}`,
        },
        body,
      },
      fetchImpl
    );
    if (response.status === 401) {
      clearToken();
      throw new DriveAuthError();
    }
    if (response.status === 200 || response.status === 201) {
      onProgress?.(1);
      return response.json();
    }
    if (response.status !== 308) throw new DriveError(response.status);
    onProgress?.(chunk.end / blob.size);
  }

  throw new Error("Drive did not finish the upload.");
}

export async function saveBlobToDrive(blob, name, { onProgress } = {}) {
  if (!googleConfigured()) throw new Error("Google Drive is not configured.");
  return withAuthRetry(async (token) => {
    const folderId = await findOrCreateFolder(token);
    return uploadBlob(token, blob, name, folderId, { onProgress });
  });
}

/* -------------------------------------------------------------------------- */
/* Picker + import                                                            */

async function openPicker({ multiple = false } = {}) {
  await loadPicker();
  const config = getConfig();
  if (!config.apiKey || !config.appId) {
    throw new Error("Google Drive is not configured.");
  }
  const token = await ensureToken();

  return new Promise((resolve, reject) => {
    let picker;
    const builder = new globalThis.google.picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setCallback((data) => {
        if (data.action === globalThis.google.picker.Action.PICKED) {
          picker?.dispose();
          resolve(data.docs || []);
        } else if (data.action === globalThis.google.picker.Action.CANCEL) {
          picker?.dispose();
          resolve([]);
        }
      })
      .addView(
        new globalThis.google.picker.DocsView().setMimeTypes("application/pdf")
      );
    if (multiple) {
      builder.enableFeature(globalThis.google.picker.Feature.MULTISELECT_ENABLED);
    }
    try {
      picker = builder.build();
      picker.setVisible(true);
    } catch (error) {
      reject(error);
    }
  });
}

export async function importFromDrive({ multiple = false, maxUploadMB = 0 } = {}) {
  if (!googleConfigured()) throw new Error("Google Drive is not configured.");
  const docs = await openPicker({ multiple });
  if (!docs.length) return { files: [], skipped: 0, cancelled: true };

  const token = await ensureToken();
  const files = [];
  let skipped = 0;

  for (const doc of docs) {
    if (isOversize(doc.sizeBytes, maxUploadMB)) {
      skipped++;
      continue;
    }
    try {
      const response = await driveRequest(
        token,
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media`
      );
      const blob = await response.blob();
      files.push(
        new File([blob], doc.name || "document.pdf", {
          type: doc.mimeType || "application/pdf",
          lastModified: Date.now(),
        })
      );
    } catch (error) {
      if (error instanceof DriveAuthError) clearToken();
      skipped++;
    }
  }

  return { files, skipped, cancelled: false };
}

export async function disconnectDrive() {
  const stored = readToken();
  clearToken();
  if (!stored?.accessToken || !globalThis.google?.accounts?.oauth2) return;
  await new Promise((resolve) => {
    globalThis.google.accounts.oauth2.revoke(stored.accessToken, resolve);
  });
}

/* -------------------------------------------------------------------------- */
/* UI                                                                         */

export function mountImportBar(
  container,
  { maxFiles = 1, getMaxUploadMB = () => 0, onFiles = () => {} } = {}
) {
  if (!googleConfigured()) return null;

  const status = h("span", { class: "cloud-status", text: "Optional · PDFs only" });
  const disconnect = h("button", {
    class: "btn btn-ghost btn-sm",
    type: "button",
    hidden: true,
    text: "Disconnect",
  });
  const action = h(
    "button",
    { class: "btn btn-quiet btn-sm", type: "button" },
    h("span", { html: icon("drive", 15) }),
    "Import from Google Drive"
  );
  const bar = h(
    "div",
    { class: "cloud-bar" },
    h(
      "div",
      { class: "cloud-main" },
      h("span", { class: "cloud-mark", html: icon("drive", 18) }),
      h(
        "div",
        { class: "cloud-copy" },
        h("strong", { text: "Google Drive" }),
        status
      )
    ),
    h("div", { class: "cloud-actions" }, disconnect, action)
  );
  container.append(bar);

  const refresh = () => {
    const connected = tokenFresh(readToken());
    status.textContent = connected ? "Connected · PDFs only" : "Optional · PDFs only";
    disconnect.hidden = !connected;
  };

  action.addEventListener("click", async () => {
    const label = action.innerHTML;
    action.disabled = true;
    action.innerHTML = `<span class="spinner" aria-hidden="true"></span> Opening Drive…`;
    try {
      const result = await importFromDrive({
        multiple: maxFiles > 1,
        maxUploadMB: getMaxUploadMB(),
      });
      if (result.files.length) onFiles(result.files);
      if (result.skipped) {
        toast(
          `${result.skipped} file${result.skipped === 1 ? "" : "s"} skipped.`,
          "info"
        );
      }
      refresh();
    } catch (error) {
      toast(error.message || "Google Drive is unavailable right now.", "error");
    } finally {
      action.disabled = false;
      action.innerHTML = label;
    }
  });

  disconnect.addEventListener("click", async () => {
    disconnect.disabled = true;
    try {
      await disconnectDrive();
      refresh();
      toast("Google Drive disconnected.", "success", 3200);
    } finally {
      disconnect.disabled = false;
    }
  });

  refresh();
  return bar;
}
