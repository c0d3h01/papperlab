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
} from "./google-drive.js";

test("acceptsPDF allows empty and PDF accepts", () => {
  assert.equal(acceptsPDF(""), true);
  assert.equal(acceptsPDF(".pdf,application/pdf"), true);
  assert.equal(acceptsPDF(".docx"), false);
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
