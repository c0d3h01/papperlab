/*
 * Optional Google Drive import/export.
 *
 * The module is inert until PAPERLAB_GOOGLE carries a client ID. Tokens stay in
 * sessionStorage; nothing here talks to the PaperLab API.
 */

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "PaperLab";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export function acceptsPDF(accept = "") {
  return !accept || accept.includes(".pdf");
}

export function googleConfigured(config = globalThis.PAPERLAB_GOOGLE) {
  return Boolean(config?.clientId);
}

export function tokenFresh(token, now = Date.now()) {
  return Boolean(token?.accessToken) && Number(token.expiresAt) > now;
}

export function uploadChunks(size, chunkSize = 8 * 1024 * 1024) {
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
