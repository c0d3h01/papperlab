import { icon } from "./icons.js";

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function formatBytes(bytes, decimals = 1) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value || 0);
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function timeAgo(value) {
  if (!value) return "";
  const then = new Date(value).getTime();
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function fileExt(name = "") {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function baseName(name = "") {
  return name.replace(/\.[^.]+$/, "");
}

export function debounce(fn, delay = 220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/* -------------------------------------------------------------------------- */
/* Theme                                                                      */

const THEME_KEY = "paperlab_theme";

export function currentTheme() {
  const stored = (() => {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return "";
    }
  })();
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  $$("[data-theme-toggle]").forEach((button) => {
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.innerHTML = icon(theme === "dark" ? "sun" : "moon", 18);
  });
}

export function initTheme() {
  applyTheme(currentTheme());
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme-toggle]");
    if (!button) return;
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
  });
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                     */

function toastRoot() {
  let root = $("#toast-root");
  if (!root) {
    root = h("div", { id: "toast-root", class: "toast-root", "aria-live": "polite", "aria-atomic": "false" });
    document.body.append(root);
  }
  return root;
}

export function toast(message, type = "info", timeout = 5200) {
  const root = toastRoot();
  const node = h(
    "div",
    { class: `toast toast-${type}`, role: type === "error" ? "alert" : "status" },
    h("span", { class: "toast-icon", html: icon(type === "error" ? "warning" : type === "success" ? "check" : "spark", 17) }),
    h("span", { class: "toast-message", text: message }),
    h("button", { class: "toast-close", type: "button", "aria-label": "Dismiss notification", html: icon("close", 14) })
  );
  const close = () => {
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 180);
  };
  node.querySelector(".toast-close").addEventListener("click", close);
  root.append(node);
  if (timeout > 0) setTimeout(close, timeout);
  return close;
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                      */

let modalReturnFocus = null;

export function openModal({ title = "", body, actions = [], className = "", onClose } = {}) {
  closeModal();
  modalReturnFocus = document.activeElement;
  const root = h("div", { class: `modal-backdrop ${className}`, role: "presentation" });
  const panel = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title || "Dialog" });
  const head = h(
    "div",
    { class: "modal-head" },
    h("div", { class: "modal-title", text: title }),
    h("button", { class: "icon-button", type: "button", "aria-label": "Close dialog", html: icon("close", 18) })
  );
  const content = h("div", { class: "modal-body" });
  if (body) content.append(body);
  const foot = h("div", { class: "modal-foot" });
  for (const action of actions) {
    foot.append(
      h(
        "button",
        {
          class: `btn ${action.variant || "btn-quiet"}`,
          type: "button",
          onclick: () => {
            const result = action.onClick?.();
            if (result !== false) closeModal();
          },
        },
        action.label
      )
    );
  }
  if (!actions.length) foot.remove();
  panel.append(head, content);
  if (foot.isConnected) panel.append(foot);
  root.append(panel);
  document.body.append(root);
  document.body.classList.add("has-modal");

  function onKey(event) {
    if (event.key === "Escape") closeModal();
  }
  document.addEventListener("keydown", onKey);
  root.addEventListener("pointerdown", (event) => {
    if (event.target === root) closeModal();
  });
  head.querySelector(".icon-button").addEventListener("click", closeModal);

  const close = () => {
    document.removeEventListener("keydown", onKey);
    root.remove();
    document.body.classList.remove("has-modal");
    onClose?.();
    modalReturnFocus?.focus?.();
  };
  root._paperlabClose = close;
  requestAnimationFrame(() => {
    const focusable = panel.querySelector("button, input, textarea, select, a[href]");
    focusable?.focus();
  });
  return { root, panel, body: content, close };
}

export function closeModal() {
  const root = $(".modal-backdrop");
  root?._paperlabClose?.();
}

export function confirmDialog(message, { title = "Are you sure?", confirm = "Continue", danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal({
      title,
      body: h("p", { class: "modal-copy", text: message }),
      actions: [
        { label: "Cancel", onClick: () => done(false) },
        {
          label: confirm,
          variant: danger ? "btn-danger" : "btn-primary",
          onClick: () => done(true),
        },
      ],
      onClose: () => done(false),
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Dropzone                                                                   */

function matchesAccept(file, accept) {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return accept.split(",").some((raw) => {
    const token = raw.trim().toLowerCase();
    if (!token) return false;
    if (token.startsWith(".")) return name.endsWith(token);
    if (token.endsWith("/*")) return type.startsWith(token.slice(0, -1));
    return type === token;
  });
}

export function createDropzone(container, options = {}) {
  const {
    accept = "",
    multiple = false,
    maxFiles = 20,
    onChange,
    title = "Drop files here",
    hint = "or click to browse",
    compact = false,
    role = "files",
  } = options;
  let files = [];
  const input = h("input", {
    type: "file",
    accept,
    multiple: multiple ? "" : null,
    class: "visually-hidden",
    "aria-label": title,
  });
  const browse = h("button", { class: "btn btn-ink", type: "button" }, h("span", { html: icon("upload", 17) }), "Choose files");
  const zone = h(
    "div",
    { class: `dropzone ${compact ? "dropzone-compact" : ""}`, tabindex: "0", role: "button", "aria-label": title },
    h("div", { class: "dropzone-mark", html: icon("upload", compact ? 20 : 28) }),
    h("div", { class: "dropzone-copy" }, h("strong", { text: title }), h("span", { text: hint })),
    browse
  );
  const list = h("ul", { class: "file-list", "aria-live": "polite" });
  const meta = h("div", { class: "dropzone-meta" });
  container.append(zone, input, list, meta);

  const render = () => {
    list.innerHTML = "";
    files.forEach((file, index) => {
      const row = h(
        "li",
        { class: "file-row" },
        h("span", { class: "file-row-icon", html: icon(fileExt(file.name) === "pdf" ? "file" : "image", 18) }),
        h("span", { class: "file-row-main" }, h("strong", { text: file.name }), h("span", { text: `${formatBytes(file.size)} · ${file.type || fileExt(file.name).toUpperCase()}` })),
        h("button", {
          type: "button",
          class: "file-row-remove",
          "aria-label": `Remove ${file.name}`,
          html: icon("close", 15),
          onclick: () => {
            files.splice(index, 1);
            render();
            onChange?.(files);
          },
        })
      );
      list.append(row);
    });
    zone.classList.toggle("has-files", files.length > 0);
    const total = files.reduce((sum, f) => sum + f.size, 0);
    meta.textContent = files.length ? `${files.length} file${files.length === 1 ? "" : "s"} · ${formatBytes(total)}` : "";
    if (files.length && !compact) {
      browse.textContent = "Add more";
      browse.prepend(h("span", { html: icon("plus", 16) }));
    }
  };

  const add = (incoming) => {
    const accepted = [];
    const rejected = [];
    for (const file of incoming) {
      if (matchesAccept(file, accept)) accepted.push(file);
      else rejected.push(file.name);
    }
    if (!accepted.length && rejected.length) {
      toast(`That file type is not supported here: ${rejected.join(", ")}`, "error");
      return;
    }
    if (!multiple) files = accepted.slice(0, 1);
    else files = [...files, ...accepted].slice(0, maxFiles);
    if (rejected.length) toast(`Skipped unsupported file${rejected.length > 1 ? "s" : ""}: ${rejected.join(", ")}`, "error");
    render();
    onChange?.(files);
  };

  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  browse.addEventListener("click", (event) => {
    event.stopPropagation();
    input.click();
  });
  input.addEventListener("change", () => {
    add(Array.from(input.files || []));
    input.value = "";
  });
  ["dragenter", "dragover"].forEach((type) =>
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragging");
    })
  );
  ["dragleave", "drop"].forEach((type) =>
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragging");
    })
  );
  zone.addEventListener("drop", (event) => {
    add(Array.from(event.dataTransfer?.files || []));
  });

  render();
  return {
    get files() {
      return files.slice();
    },
    setFiles(next) {
      files = next.slice(0, multiple ? maxFiles : 1);
      render();
      onChange?.(files);
    },
    clear() {
      files = [];
      render();
      onChange?.(files);
    },
    element: zone,
    role,
  };
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    const name = node.getAttribute("data-icon");
    if (!name || node.dataset.iconReady === "true") return;
    node.innerHTML = icon(name, Number(node.getAttribute("data-icon-size")) || 18);
    node.dataset.iconReady = "true";
  });
}

export function copyText(text, message = "Copied to clipboard") {
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast(message, "success"))
    .catch(() => toast("Could not copy to clipboard", "error"));
}

export function statusPill(status) {
  const map = {
    done: ["Ready", "success"],
    error: ["Failed", "error"],
    running: ["Working", "running"],
    queued: ["Queued", "queued"],
    cancelled: ["Cancelled", "muted"],
  };
  const [label, tone] = map[status] || [status || "Unknown", "muted"];
  return h("span", { class: `pill pill-${tone}` }, h("span", { class: "pill-dot" }), label);
}

export function spinner(label = "Working") {
  return h("span", { class: "spinner-wrap" }, h("span", { class: "spinner", "aria-hidden": "true" }), label);
}

export function emptyState(iconName, title, copy, action) {
  return h(
    "div",
    { class: "empty-state" },
    h("span", { class: "empty-state-icon", html: icon(iconName, 28) }),
    h("h3", { text: title }),
    h("p", { text: copy }),
    action || null
  );
}
