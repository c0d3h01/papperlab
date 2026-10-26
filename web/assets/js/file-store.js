/*
 * A tiny IndexedDB hand-off store.
 *
 * Files chosen on the home page or catalog are persisted briefly so the tool
 * page and studio can pick them up after navigation. Nothing is uploaded until
 * the user explicitly starts a job.
 */

const DB_NAME = "paperlab";
const DB_VERSION = 1;
const STORE = "handoffs";
const MAX_AGE = 60 * 60 * 1000;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser does not support local file hand-off."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local storage"));
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        let result;
        try {
          result = fn(store);
        } catch (error) {
          reject(error);
          return;
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error("Storage error"));
        transaction.onabort = () => reject(transaction.error || new Error("Storage aborted"));
      })
  );
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function newHandoffId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function saveHandoff(files, meta = {}) {
  const list = Array.from(files || []);
  if (!list.length) throw new Error("No files to hand off");
  const id = newHandoffId();
  const record = {
    id,
    createdAt: Date.now(),
    tool: meta.tool || "",
    source: meta.source || "",
    files: list.map((file) => ({
      name: file.name,
      type: file.type || "",
      lastModified: file.lastModified || Date.now(),
      blob: file,
    })),
  };
  await tx("readwrite", (store) => store.put(record));
  pruneHandoffs();
  return id;
}

export async function readHandoff(id) {
  if (!id) return null;
  const db = await openDB();
  const transaction = db.transaction(STORE, "readonly");
  const record = await requestValue(transaction.objectStore(STORE).get(id));
  if (!record) return null;
  if (Date.now() - record.createdAt > MAX_AGE) {
    await deleteHandoff(id);
    return null;
  }
  const files = record.files.map(
    (item) =>
      new File([item.blob], item.name, {
        type: item.type,
        lastModified: item.lastModified,
      })
  );
  return { ...record, files };
}

export async function takeHandoff(id) {
  const record = await readHandoff(id);
  if (record) await deleteHandoff(id);
  return record;
}

export async function deleteHandoff(id) {
  if (!id) return;
  try {
    await tx("readwrite", (store) => store.delete(id));
  } catch {
    /* ignore */
  }
}

export async function pruneHandoffs() {
  try {
    const db = await openDB();
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const keys = await requestValue(store.getAllKeys());
    const values = await requestValue(store.getAll());
    const cutoff = Date.now() - MAX_AGE;
    values.forEach((record) => {
      if (record.createdAt < cutoff) store.delete(record.id);
    });
    // Keep at most 12 recent hand-offs.
    if (keys.length > 12) {
      values
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(12)
        .forEach((record) => store.delete(record.id));
    }
  } catch {
    /* storage is best-effort */
  }
}

export async function handoffFromQuery() {
  const id = new URLSearchParams(location.search).get("handoff");
  if (!id) return null;
  try {
    return await takeHandoff(id);
  } catch {
    return null;
  }
}
