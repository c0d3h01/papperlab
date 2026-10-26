import "./config.js";

const runtimeOverride = new URLSearchParams(location.search).get("api");
const storedOverride = (() => {
  try {
    return localStorage.getItem("paperlab_api") || "";
  } catch {
    return "";
  }
})();

export const API_BASE = String(
  runtimeOverride || window.PAPERLAB_API || storedOverride || ""
).replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function apiURL(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function fileURL(jobId, output) {
  if (output?.url) return apiURL(output.url);
  return apiURL(`/api/jobs/${jobId}/files/${output.id}`);
}

async function parseResponse(response) {
  const type = response.headers.get("content-type") || "";
  let payload = null;
  if (type.includes("application/json")) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => "");
    payload = text ? { error: text } : null;
  }
  if (!response.ok) {
    const message =
      payload?.error ||
      payload?.message ||
      `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }
  return payload;
}

export async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const key = apiKey();
  if (key) headers.set("X-API-Key", key);
  const response = await fetch(apiURL(path), {
    ...options,
    headers,
    credentials: API_BASE ? "omit" : "same-origin",
  });
  return parseResponse(response);
}

export function apiKey() {
  try {
    return localStorage.getItem("paperlab_api_key") || "";
  } catch {
    return "";
  }
}

export function setApiKey(key) {
  try {
    if (key) localStorage.setItem("paperlab_api_key", key);
    else localStorage.removeItem("paperlab_api_key");
  } catch {
    /* ignore */
  }
}

export const health = () => request("/api/health", { cache: "no-store" });
export const config = () => request("/api/config", { cache: "no-store" });
export const tools = () => request("/api/tools", { cache: "no-store" });

export function createJob(tool, files = [], options = {}, assets = [], onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("tool", tool);
    form.append("options", JSON.stringify(options || {}));
    for (const file of files) form.append("files", file, file.name);
    for (const file of assets) form.append("assets", file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiURL("/api/jobs"));
    xhr.responseType = "json";
    const key = apiKey();
    if (key) xhr.setRequestHeader("X-API-Key", key);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      const payload = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
        return;
      }
      const message =
        payload?.error || payload?.message || `Upload failed (${xhr.status})`;
      reject(new ApiError(message, xhr.status, payload));
    });
    xhr.addEventListener("error", () => {
      reject(new ApiError("Could not reach the PaperLab API. Check the API address and your connection."));
    });
    xhr.addEventListener("abort", () => {
      reject(new ApiError("Upload cancelled"));
    });
    xhr.send(form);
  });
}

export async function getJob(id, signal) {
  return request(`/api/jobs/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal,
  });
}

export async function deleteJob(id) {
  return request(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function pollJob(id, onUpdate, options = {}) {
  const interval = options.interval ?? 900;
  const timeout = options.timeout ?? 15 * 60 * 1000;
  const started = Date.now();
  const controller = options.signal ? null : new AbortController();
  const signal = options.signal || controller.signal;

  while (!signal.aborted) {
    const job = await getJob(id, signal);
    onUpdate?.(job);
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      return job;
    }
    if (Date.now() - started > timeout) {
      throw new ApiError("The job is taking longer than expected. You can keep this page open and try again.");
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, interval);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    });
  }
  throw new DOMException("Aborted", "AbortError");
}

function uploadFile(path, file, password = "") {
  const form = new FormData();
  form.append("file", file, file.name);
  if (password) form.append("password", password);
  return request(path, { method: "POST", body: form });
}

export const inspectPDF = (file, password = "") =>
  uploadFile("/api/inspect/pdf", file, password);
export const inspectForms = (file, password = "") =>
  uploadFile("/api/inspect/forms", file, password);

export function analyzeRedact(file, terms, password = "") {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("terms", JSON.stringify(terms));
  if (password) form.append("password", password);
  return request("/api/analyze/redact", { method: "POST", body: form });
}

export function chatWithPDF(file, question, history = [], password = "") {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("question", question);
  form.append("history", JSON.stringify(history));
  if (password) form.append("password", password);
  return request("/api/chat", { method: "POST", body: form });
}

export function download(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  if (filename) a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
