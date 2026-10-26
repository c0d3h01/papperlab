import {
  createJob,
  pollJob,
  fileURL,
  deleteJob,
  apiKey,
  ApiError,
} from "./api.js";
import { icon } from "./icons.js";
import {
  h,
  formatBytes,
  fileExt,
  toast,
  openModal,
  statusPill,
  emptyState,
} from "./ui.js";

const EXT_ICON = {
  pdf: "file",
  zip: "layers",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  tif: "image",
  tiff: "image",
  txt: "text",
  md: "markdown",
  json: "metadata",
  docx: "word",
  doc: "word",
  pptx: "powerpoint",
  xlsx: "excel",
  csv: "excel",
};

function outputIcon(name) {
  return EXT_ICON[fileExt(name)] || "file";
}

async function fetchOutput(url) {
  const headers = new Headers();
  const key = apiKey();
  if (key) headers.set("X-API-Key", key);
  const response = await fetch(url, { headers, credentials: url.startsWith("/") ? "same-origin" : "omit" });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  return response.blob();
}

async function downloadOutput(url, name, button) {
  const old = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span> Preparing`;
  }
  try {
    const blob = await fetchOutput(url);
    const objectURL = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectURL;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectURL), 30000);
    toast(`${name} downloaded`, "success", 3000);
  } catch {
    window.open(url, "_blank", "noopener");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = old;
    }
  }
}

async function previewOutput(output, job) {
  const url = fileURL(job.id, output);
  const ext = fileExt(output.name);
  if (ext === "pdf") {
    window.open(url, "_blank", "noopener");
    return;
  }
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) {
    openModal({
      title: output.name,
      className: "modal-wide",
      body: h("div", { class: "preview-image" }, h("img", { src: url, alt: output.name })),
      actions: [
        { label: "Download", variant: "btn-primary", onClick: () => downloadOutput(url, output.name) },
        { label: "Close" },
      ],
    });
    return;
  }
  if (["txt", "md", "json", "csv"].includes(ext)) {
    const loading = h("div", { class: "preview-loading" }, h("span", { class: "spinner" }), "Loading preview");
    const modal = openModal({ title: output.name, className: "modal-wide", body: loading, actions: [{ label: "Close" }] });
    try {
      const blob = await fetchOutput(url);
      const text = await blob.text();
      const pre = h("pre", { class: "preview-text", text: text.length > 60000 ? `${text.slice(0, 60000)}\n\n… preview truncated` : text });
      loading.replaceWith(pre);
      modal.body.append(pre);
    } catch (error) {
      loading.replaceWith(h("p", { class: "form-error", text: error.message }));
    }
    return;
  }
  window.open(url, "_blank", "noopener");
}

function metaValue(key, value) {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return null;
  if (key.toLowerCase().includes("size") && Number.isFinite(Number(value))) return formatBytes(Number(value));
  if (key === "savedPercent") return `${value}%`;
  if (key === "signedAt" || key === "createdAt") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }
  return String(value);
}

const META_LABELS = {
  pages: "Pages",
  files: "Source files",
  parts: "Parts",
  perSheet: "Per sheet",
  sheets: "Sheets",
  removed: "Pages removed",
  croppedPages: "Pages cropped",
  images: "Images",
  slides: "Slides",
  fields: "Fields filled",
  totalFields: "Fields found",
  redactions: "Redactions",
  words: "Words",
  characters: "Characters",
  engine: "Engine",
  level: "Compression",
  originalSize: "Before",
  compressedSize: "After",
  savedPercent: "Saved",
  profile: "Profile",
  encryption: "Encryption",
  signer: "Signer",
  signedAt: "Signed",
  targetName: "Language",
  documentA: "First file",
  documentB: "Second file",
  pageCountA: "Pages in first",
  pageCountB: "Pages in second",
  dpi: "Resolution",
  numberedPages: "Pages numbered",
  elements: "Marks added",
  format: "Format",
  searchable: "Searchable",
  watermark: "Watermark",
  paper: "Paper",
  source: "Source",
};

function renderMeta(job) {
  const meta = job.meta || {};
  const ignored = new Set([
    "summary",
    "keyPoints",
    "answer",
    "sources",
    "question",
    "text",
    "notes",
    "before",
    "after",
    "permissions",
    "pages",
    "image",
    "inputSha256",
    "signedAt",
  ]);
  const metrics = [];
  for (const [key, value] of Object.entries(meta)) {
    if (ignored.has(key)) continue;
    const display = metaValue(key, value);
    if (display == null) continue;
    metrics.push([META_LABELS[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), display]);
  }
  const blocks = [];

  if (Array.isArray(meta.pages) && meta.pages.length && typeof meta.pages[0] === "object") {
    const changed = meta.pages.filter((p) => p && (p.changed || p.similarity < 0.999));
    blocks.push(
      h(
        "div",
        { class: "result-block" },
        h("h4", { class: "result-block-title", text: "Page comparison" }),
        h(
          "div",
          { class: "compare-list" },
          meta.pages.map((p, i) => {
            const similarity = Number(p.similarity ?? p.Similarity ?? 0);
            const pct = Math.round((similarity <= 1 ? similarity : similarity / 100) * 1000) / 10;
            const changedPct = Math.round((100 - pct) * 10) / 10;
            return h(
              "div",
              { class: "compare-row" },
              h("span", { class: "compare-page", text: `Page ${p.page ?? p.Page ?? i + 1}` }),
              h("span", { class: "compare-bar" }, h("span", { style: `width:${Math.max(0, Math.min(100, changedPct))}%` })),
              h("span", { class: `compare-pct ${changedPct > 0.5 ? "is-changed" : ""}`, text: changedPct > 0.5 ? `${changedPct}% changed` : "identical" })
            );
          })
        )
      )
    );
  }

  if (meta.summary) {
    blocks.push(
      h(
        "div",
        { class: "result-block result-answer" },
        h("h4", { class: "result-block-title", text: "Summary" }),
        h("p", { class: "result-prose", text: meta.summary }),
        Array.isArray(meta.keyPoints) && meta.keyPoints.length
          ? h("ul", { class: "result-points" }, meta.keyPoints.map((point) => h("li", { text: point })))
          : null
      )
    );
  }

  if (meta.answer) {
    blocks.push(
      h(
        "div",
        { class: "result-block result-answer" },
        h("h4", { class: "result-block-title", text: meta.question || "Answer" }),
        h("p", { class: "result-prose", text: meta.answer }),
        Array.isArray(meta.sources) && meta.sources.length
          ? h("div", { class: "source-chips" }, meta.sources.map((s) => h("span", { class: "source-chip", text: s })))
          : null
      )
    );
  }

  if (meta.before || meta.after) {
    blocks.push(
      h(
        "div",
        { class: "result-block" },
        h("h4", { class: "result-block-title", text: "Metadata changes" }),
        h(
          "div",
          { class: "meta-diff" },
          ["Title", "Author", "Subject", "Keywords"].map((key) =>
            h(
              "div",
              { class: "meta-diff-row" },
              h("span", { class: "meta-diff-key", text: key }),
              h("span", { class: "meta-diff-old", text: meta.before?.[key] || "—" }),
              h("span", { class: "meta-diff-arrow", html: icon("arrow", 13) }),
              h("span", { class: "meta-diff-new", text: meta.after?.[key] || "—" })
            )
          )
        )
      )
    );
  }

  if (meta.permissions && typeof meta.permissions === "object") {
    blocks.push(
      h(
        "div",
        { class: "result-block" },
        h("h4", { class: "result-block-title", text: "Reader permissions" }),
        h(
          "div",
          { class: "permission-chips" },
          Object.entries(meta.permissions).map(([key, allowed]) =>
            h("span", { class: `permission-chip ${allowed ? "is-on" : "is-off"}` }, h("span", { html: icon(allowed ? "check" : "close", 13) }), key)
          )
        )
      )
    );
  }

  if (Array.isArray(meta.notes) && meta.notes.length) {
    blocks.push(
      h(
        "div",
        { class: "result-block" },
        h("h4", { class: "result-block-title", text: "Recovery notes" }),
        h("ul", { class: "result-points" }, meta.notes.map((note) => h("li", { text: note })))
      )
    );
  }

  const wrap = h("div", { class: "result-details" });
  if (metrics.length) {
    wrap.append(
      h(
        "div",
        { class: "metric-grid" },
        metrics.map(([label, value]) =>
          h("div", { class: "metric" }, h("span", { class: "metric-label", text: label }), h("strong", { class: "metric-value", text: value }))
        )
      )
    );
  }
  blocks.forEach((b) => wrap.append(b));
  return wrap.childElementCount ? wrap : null;
}

function resultOutputs(job) {
  const list = h("div", { class: "output-list" });
  const outputs = job.outputs || [];
  outputs.forEach((output, index) => {
    const url = fileURL(job.id, output);
    const primary = index === 0;
    const download = h(
      "button",
      {
        class: `btn ${primary ? "btn-primary" : "btn-quiet"} btn-sm`,
        type: "button",
        onclick: () => downloadOutput(url, output.name, download),
      },
      h("span", { html: icon("download", 15) }),
      "Download"
    );
    list.append(
      h(
        "div",
        { class: "output-card" },
        h("span", { class: `output-icon tone-${primary ? "blue" : "ink"}`, html: icon(outputIcon(output.name), 22) }),
        h(
          "span",
          { class: "output-main" },
          h("strong", { class: "output-name", text: output.name }),
          h("span", { class: "output-meta", text: `${formatBytes(output.size)} · ${fileExt(output.name).toUpperCase()}` })
        ),
        h(
          "span",
          { class: "output-actions" },
          h(
            "button",
            {
              class: "btn btn-ghost btn-sm",
              type: "button",
              onclick: () => previewOutput(output, job),
            },
            h("span", { html: icon("eye", 15) }),
            "Preview"
          ),
          download
        )
      )
    );
  });
  return list;
}

export function renderJobResult(job, { container, onReset, onOpenStudio, tool } = {}) {
  container.innerHTML = "";
  const ready = job.status === "done";
  const panel = h("section", { class: `job-result ${ready ? "is-done" : "is-error"}`, "aria-live": "polite" });

  if (!ready) {
    panel.append(
      h(
        "div",
        { class: "result-head" },
        h("span", { class: "result-mark is-error", html: icon("warning", 26) }),
        h(
          "div",
          { class: "result-head-copy" },
          h("span", { class: "eyebrow", text: "JOB FAILED" }),
          h("h2", { class: "result-title", text: "That did not work" }),
          h("p", { class: "result-sub", text: job.error || "The server could not finish this job." })
        )
      )
    );
    panel.append(
      h(
        "div",
        { class: "result-actions" },
        h("button", { class: "btn btn-primary", type: "button", onclick: onReset }, h("span", { html: icon("refresh", 16) }), "Try again"),
        h("a", { class: "btn btn-quiet", href: "index.html" }, "Back to the workshop")
      )
    );
    container.append(panel);
    return panel;
  }

  panel.append(
    h(
      "div",
      { class: "result-head" },
      h("span", { class: "result-mark", html: icon("check", 28) }),
      h(
        "div",
        { class: "result-head-copy" },
        h("span", { class: "eyebrow", text: "JOB COMPLETE" }),
        h("h2", { class: "result-title", text: tool?.name ? `${tool.name} is ready` : "Your files are ready" }),
        h("p", { class: "result-sub", text: `${(job.outputs || []).length} file${(job.outputs || []).length === 1 ? "" : "s"} prepared. Download now; the files expire automatically.` })
      )
    )
  );
  panel.append(resultOutputs(job));
  const meta = renderMeta(job);
  if (meta) panel.append(meta);

  const actions = h(
    "div",
    { class: "result-actions" },
    h("button", { class: "btn btn-primary", type: "button", onclick: onReset }, h("span", { html: icon("plus", 16) }), "Run another"),
    onOpenStudio ? h("button", { class: "btn btn-quiet", type: "button", onclick: onOpenStudio }, h("span", { html: icon("studio", 16) }), "Open in studio") : null,
    h("a", { class: "btn btn-ghost", href: "tools.html" }, "Browse tools")
  );
  panel.append(actions);
  panel.append(
    h(
      "p",
      { class: "result-note" },
      h("span", { html: icon("clock", 14) }),
      ` Files are kept for ${job.ttlMinutes || "a short while"} and then deleted. Download anything you want to keep.`
    )
  );
  container.append(panel);
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  return panel;
}

function progressPanel(tool, files) {
  const bar = h("span", { class: "progress-bar-fill", style: "width:0%" });
  const pct = h("span", { class: "progress-pct", text: "0%" });
  const message = h("p", { class: "progress-message", text: "Uploading files" });
  const detail = h("p", { class: "progress-detail", text: "Encrypting the transfer and preparing a work folder." });
  const list = h(
    "ul",
    { class: "progress-files" },
    files.map((file) =>
      h(
        "li",
        {},
        h("span", { html: icon(fileExt(file.name) === "pdf" ? "file" : "image", 15) }),
        h("span", { class: "progress-file-name", text: file.name }),
        h("span", { class: "progress-file-size", text: formatBytes(file.size) })
      )
    )
  );
  const panel = h(
    "section",
    { class: "job-progress", "aria-live": "polite", "aria-busy": "true" },
    h(
      "div",
      { class: "progress-head" },
      h("span", { class: "progress-mark", html: icon(tool.icon || "spark", 26) }),
      h(
        "div",
        { class: "progress-head-copy" },
        h("span", { class: "eyebrow", text: "WORKING" }),
        h("h2", { class: "progress-title", text: tool.name }),
        message
      ),
      h("div", { class: "progress-ring", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, pct)
    ),
    h("div", { class: "progress-track" }, bar),
    detail,
    list,
    h("div", { class: "progress-foot" }, h("span", { class: "status-note" }, h("span", { class: "dot dot-blue" }), "Files stay private and are deleted automatically."))
  );
  return {
    panel,
    update({ percent, label, detail: d, status }) {
      const value = Math.max(0, Math.min(100, Math.round(percent)));
      bar.style.width = `${value}%`;
      pct.textContent = `${value}%`;
      if (label) message.textContent = label;
      if (d) detail.textContent = d;
      const ring = panel.querySelector(".progress-ring");
      ring?.setAttribute("aria-valuenow", String(value));
      if (status === "done") panel.classList.add("is-done");
    },
    fail(messageText) {
      panel.classList.add("is-error");
      panel.setAttribute("aria-busy", "false");
      message.textContent = "Job failed";
      detail.textContent = messageText;
      bar.style.width = "100%";
      bar.classList.add("is-error");
      pct.textContent = "!";
    },
  };
}

/**
 * Upload files, start a job, show progress, then render the result.
 * Returns the finished job (or null when the user resets).
 */
export async function runToolJob({
  container,
  tool,
  files,
  assets = [],
  options = {},
  onReset,
  onOpenStudio,
  onComplete,
}) {
  container.innerHTML = "";
  const ui = progressPanel(tool, files);
  container.append(ui.panel);
  ui.panel.scrollIntoView({ behavior: "smooth", block: "center" });

  let job;
  try {
    job = await createJob(tool.id, files, options, assets, (uploadPct) => {
      const pct = Math.round(uploadPct * 0.12);
      ui.update({ percent: pct, label: "Uploading files", detail: `${uploadPct}% of the upload complete.` });
    });
  } catch (error) {
    ui.fail(error.message || "The upload could not be started.");
    renderJobResult(
      { id: "", status: "error", error: error.message, outputs: [], meta: {} },
      { container, onReset, onOpenStudio, tool }
    );
    return null;
  }

  ui.update({ percent: 14, label: "Queued", detail: "The job is in the queue and will start in a moment." });
  try {
    const finished = await pollJob(job.id, (update) => {
      const pct = 14 + Math.max(0, Math.min(100, update.progress || 0)) * 0.86;
      ui.update({
        percent: pct,
        label: update.message || "Working",
        detail:
          update.status === "queued"
            ? "Waiting for a free worker."
            : update.status === "running"
              ? "Processing on the server. You can leave this tab open."
              : "",
        status: update.status,
      });
    });
    if (finished.status === "done") {
      renderJobResult(finished, { container, onReset, onOpenStudio, tool });
      onComplete?.(finished);
      return finished;
    }
    ui.fail(finished.error || "The job ended without a result.");
    setTimeout(() => {
      renderJobResult(finished, { container, onReset, onOpenStudio, tool });
    }, 400);
    return finished;
  } catch (error) {
    if (error?.name === "AbortError") return null;
    ui.fail(error.message || "Lost contact with the server.");
    setTimeout(() => {
      renderJobResult(
        { id: job.id, status: "error", error: error.message, outputs: [], meta: {} },
        { container, onReset, onOpenStudio, tool }
      );
    }, 400);
    return null;
  }
}

export async function cancelJob(jobId) {
  if (!jobId) return;
  try {
    await deleteJob(jobId);
  } catch {
    /* best effort */
  }
}
