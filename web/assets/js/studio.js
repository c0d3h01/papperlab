/*
 * PaperLab Studio.
 *
 * A visual workbench for one PDF: mark up pages, sign, arrange a contact
 * sheet, black out sensitive areas, or crop. Rendering happens locally with
 * PDF.js; only the final export is sent to the processing API.
 */

import { initLayout } from "./layout.js";
import { icon } from "./icons.js";
import {
  $,
  h,
  clamp,
  toast,
  formatBytes,
  fileExt,
  openModal,
} from "./ui.js";
import { takeHandoff } from "./file-store.js";
import { runToolJob } from "./job-view.js";
import { analyzeRedact } from "./api.js";
import { TOOL_MAP } from "./tools-data.js";

/* -------------------------------------------------------------------------- */
/* PDF.js                                                                     */
/* -------------------------------------------------------------------------- */

let pdfjsPromise = null;

function loadPDFJS() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("../../vendor/pdfjs/pdf.min.mjs").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = new URL(
        "../../vendor/pdfjs/pdf.worker.min.mjs",
        import.meta.url
      ).href;
      return mod;
    });
  }
  return pdfjsPromise;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MODES = [
  { id: "edit", label: "Edit", icon: "edit" },
  { id: "sign", label: "Sign", icon: "sign" },
  { id: "organize", label: "Organize", icon: "organize" },
  { id: "redact", label: "Redact", icon: "redact" },
  { id: "crop", label: "Crop", icon: "crop" },
];

const RAILS = {
  edit: [
    { id: "select", icon: "cursor", label: "Select" },
    { id: "text", icon: "type", label: "Text" },
    { id: "highlight", icon: "highlight", label: "Marker" },
    { id: "rect", icon: "square", label: "Box" },
    { id: "ellipse", icon: "circle", label: "Oval" },
    { id: "line", icon: "line", label: "Line" },
    { id: "ink", icon: "pen", label: "Ink" },
    { id: "image", icon: "image", label: "Image" },
    { id: "signature", icon: "sign", label: "Sign" },
  ],
  sign: [
    { id: "signature", icon: "sign", label: "Place" },
    { id: "select", icon: "cursor", label: "Select" },
  ],
  organize: [
    { id: "arrange", icon: "arrange", label: "Arrange" },
    { id: "organize-rotate", icon: "rotateCw", label: "Rotate all" },
    { id: "organize-reset", icon: "refresh", label: "Reset" },
  ],
  redact: [
    { id: "redact-box", icon: "redact", label: "Box" },
    { id: "redact-search", icon: "search", label: "Find" },
    { id: "select", icon: "cursor", label: "Select" },
  ],
  crop: [
    { id: "crop-box", icon: "crop", label: "Crop" },
    { id: "select", icon: "cursor", label: "Select" },
  ],
};

const DRAW_TOOLS = new Set([
  "text",
  "rect",
  "highlight",
  "ellipse",
  "line",
  "ink",
  "redact-box",
  "crop-box",
  "signature",
]);

const TYPE_LABEL = {
  text: "Text",
  rect: "Box",
  highlight: "Highlight",
  ellipse: "Oval",
  line: "Line",
  ink: "Ink",
  image: "Image",
  signature: "Signature",
};

const TYPE_ICON = {
  text: "type",
  rect: "square",
  highlight: "highlight",
  ellipse: "circle",
  line: "line",
  ink: "pen",
  image: "image",
  signature: "sign",
};

const MODE_NOTE = {
  edit: "Drag to draw · click a mark to adjust it",
  sign: "Create a signature, then click the page to place it",
  organize: "Drag to reorder · rotate · duplicate · delete",
  redact: "Black boxes are burned in on export",
  crop: "The box is the area that remains",
};

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

const state = {
  file: null,
  pdf: null,
  password: "",
  pages: 0,
  sizes: [],
  current: 1,
  mode: "edit",
  tool: "select",
  zoom: 1,
  scale: 1,
  loading: false,
  loadToken: 0,
  renderToken: 0,
  busy: false,
  dirty: false,
  elements: [],
  redactions: [],
  crops: [],
  organize: [],
  selection: null,
  history: [],
  future: [],
  drag: null,
  thumbs: new Map(),
  thumbBusy: false,
  replaceImageId: null,
  sigSource: "draw",
  signature: null,
  sigPadCanvas: null,
  sigPreviewEl: null,
  sigPlaceBtn: null,
  sigMeta: { signer: "", email: "", reason: "Approved", certificatePage: true },
  redactTermsText: "",
  redactStatus: "",
};

let resizeTimer = null;

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

function init() {
  const params = new URLSearchParams(location.search);
  const requested = params.get("tool");
  if (MODES.some((m) => m.id === requested)) state.mode = requested;
  else if (requested === "organise") state.mode = "organize";
  state.tool = defaultTool(state.mode);

  initLayout({ active: "studio", title: "Studio" });
  bindEvents();
  renderTopbar();
  renderRail();
  renderToolbar();
  renderInspector();
  renderEmpty();
  restoreHandoff(params.get("handoff"));
}

function defaultTool(mode) {
  return {
    edit: "select",
    sign: "signature",
    organize: "arrange",
    redact: "redact-box",
    crop: "crop-box",
  }[mode] || "select";
}

/* -------------------------------------------------------------------------- */
/* Chrome: top bar, rail, toolbar                                             */
/* -------------------------------------------------------------------------- */

function renderTopbar() {
  const bar = $("#studio-topbar");
  if (!bar) return;
  bar.innerHTML = "";
  const file = state.file;
  const fileLine = file
    ? `${state.pages} page${state.pages === 1 ? "" : "s"} · ${formatBytes(file.size)}`
    : "Open a document to begin";

  bar.append(
    h(
      "div",
      { class: "studio-file" },
      h("span", { class: "studio-file-mark", html: icon("file", 18) }),
      h(
        "span",
        { class: "studio-file-copy" },
        h("strong", { text: file ? file.name : "No PDF open" }),
        h("span", { text: state.loading ? "Reading the document…" : fileLine })
      )
    ),
    h(
      "div",
      { class: "studio-modes", role: "tablist", "aria-label": "Studio mode" },
      MODES.map((mode) =>
        h(
          "button",
          {
            class: `studio-mode ${state.mode === mode.id ? "is-active" : ""}`,
            type: "button",
            role: "tab",
            title: mode.label,
            "aria-selected": state.mode === mode.id ? "true" : "false",
            html: icon(mode.icon, 14),
            onclick: () => setMode(mode.id),
          },
          h("span", { text: mode.label })
        )
      )
    ),
    h(
      "div",
      { class: "studio-actions" },
      h(
        "button",
        {
          class: "btn btn-quiet btn-sm studio-open",
          type: "button",
          onclick: () => $("#studio-file-input")?.click(),
        },
        h("span", { html: icon("upload", 15) }),
        "Open"
      ),
      h("button", {
        class: "icon-button",
        id: "studio-undo",
        type: "button",
        title: "Undo (⌘Z)",
        "aria-label": "Undo",
        html: icon("undo", 16),
        onclick: undo,
      }),
      h("button", {
        class: "icon-button",
        id: "studio-redo",
        type: "button",
        title: "Redo (⇧⌘Z)",
        "aria-label": "Redo",
        html: icon("redo", 16),
        onclick: redo,
      }),
      h(
        "button",
        {
          class: "btn btn-primary btn-sm studio-export-btn",
          id: "studio-export-btn",
          type: "button",
          onclick: exportCurrent,
        },
        h("span", { html: icon("download", 15) }),
        "Export PDF"
      )
    )
  );
  updateHistoryButtons();
  updateExportButton();
}

function renderRail() {
  const rail = $("#studio-rail");
  if (!rail) return;
  rail.innerHTML = "";
  const tools = RAILS[state.mode] || RAILS.edit;
  for (const tool of tools) {
    const active =
      state.tool === tool.id ||
      (state.mode === "organize" && tool.id === "arrange");
    const button = h(
      "button",
      {
        class: `studio-tool ${active ? "is-active" : ""}`,
        type: "button",
        title: tool.label,
        "aria-pressed": active ? "true" : "false",
        html: icon(tool.icon, 18),
        onclick: () => chooseTool(tool.id),
      },
      h("span", { text: tool.label })
    );
    if (!state.file && tool.id !== "organize-reset") button.disabled = true;
    rail.append(button);
  }
  rail.append(h("div", { class: "studio-rail-sep" }));
  rail.append(
    h("div", {
      class: "studio-rail-note",
      text: state.file ? "Edits stay local until export" : "Open a PDF to begin",
    })
  );
}

function chooseTool(id) {
  if (!state.file) {
    toast("Open a PDF first.", "error");
    return;
  }
  if (id === "image") {
    state.replaceImageId = null;
    $("#studio-image-input")?.click();
    return;
  }
  if (id === "signature" && state.mode === "edit") {
    setMode("sign");
    state.tool = "signature";
    renderRail();
    renderInspector();
    updateCursor();
    return;
  }
  if (id === "redact-search") {
    state.tool = "redact-search";
    renderRail();
    renderInspector();
    setTimeout(() => $("#redact-search-input")?.focus(), 30);
    return;
  }
  if (id === "organize-rotate") {
    rotateAllPages();
    return;
  }
  if (id === "organize-reset") {
    resetOrganize();
    return;
  }
  state.tool = id;
  renderRail();
  renderInspector();
  updateCursor();
}

function renderToolbar() {
  const bar = $("#studio-toolbar");
  if (!bar) return;
  bar.innerHTML = "";
  if (!state.file) {
    bar.append(
      h("span", { class: "studio-toolbar-note", text: "Open a PDF to start" })
    );
    return;
  }
  if (state.mode === "organize") {
    bar.append(
      h(
        "div",
        { class: "studio-toolbar-group" },
        h("span", { class: "mono", text: "Contact sheet" }),
        h("strong", { text: `${state.organize.length} pages` })
      ),
      h("span", {
        class: "studio-toolbar-note",
        text: MODE_NOTE.organize,
      })
    );
    return;
  }

  const prev = h(
    "button",
    {
      class: "studio-pagebtn",
      type: "button",
      title: "Previous page",
      "aria-label": "Previous page",
      onclick: () => goPage(state.current - 1),
    },
    h("span", {
      style: "display:grid;transform:rotate(180deg)",
      html: icon("chevron", 14),
    })
  );
  const next = h(
    "button",
    {
      class: "studio-pagebtn",
      type: "button",
      title: "Next page",
      "aria-label": "Next page",
      onclick: () => goPage(state.current + 1),
    },
    h("span", { html: icon("chevron", 14) })
  );
  prev.disabled = state.current <= 1;
  next.disabled = state.current >= state.pages;

  const pageInput = h("input", {
    class: "studio-page-input",
    type: "number",
    min: 1,
    max: state.pages,
    "aria-label": "Page number",
    onchange: (event) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) goPage(value);
      else event.target.value = String(state.current);
    },
    onkeydown: (event) => {
      if (event.key === "Enter") event.target.blur();
    },
  });
  pageInput.value = String(state.current);

  bar.append(
    h(
      "div",
      { class: "studio-toolbar-group" },
      prev,
      pageInput,
      h("span", { class: "studio-page-total", text: `/ ${state.pages}` }),
      next
    ),
    h(
      "div",
      { class: "studio-toolbar-group" },
      h(
        "button",
        {
          class: "studio-pagebtn",
          type: "button",
          title: "Zoom out",
          "aria-label": "Zoom out",
          onclick: () => setZoom(state.zoom - 0.1),
        },
        h("span", { html: icon("zoomOut", 14) })
      ),
      h("span", { class: "studio-zoom", text: `${Math.round(state.zoom * 100)}%` }),
      h(
        "button",
        {
          class: "studio-pagebtn",
          type: "button",
          title: "Zoom in",
          "aria-label": "Zoom in",
          onclick: () => setZoom(state.zoom + 0.1),
        },
        h("span", { html: icon("zoomIn", 14) })
      ),
      h(
        "button",
        {
          class: "studio-pagebtn",
          type: "button",
          title: "Fit to width",
          "aria-label": "Fit to width",
          onclick: () => setZoom(1),
        },
        h("span", { html: icon("fit", 14) })
      )
    ),
    h("span", { class: "studio-toolbar-note", text: MODE_NOTE[state.mode] || "" })
  );
}

function updateHistoryButtons() {
  const undoBtn = $("#studio-undo");
  const redoBtn = $("#studio-redo");
  if (undoBtn) undoBtn.disabled = !state.history.length;
  if (redoBtn) redoBtn.disabled = !state.future.length;
}

function updateExportButton() {
  const button = $("#studio-export-btn");
  if (button) button.disabled = !state.file || state.busy || state.loading;
}

function updateCursor() {
  const wrap = $("#studio-canvas-wrap");
  if (!wrap) return;
  wrap.dataset.cursor = DRAW_TOOLS.has(state.tool)
    ? state.tool === "text"
      ? "text"
      : "crosshair"
    : "move";
}

/* -------------------------------------------------------------------------- */
/* Mode + page navigation                                                     */
/* -------------------------------------------------------------------------- */

function setMode(mode) {
  if (!MODES.some((m) => m.id === mode)) return;
  if (state.busy) {
    toast("Wait for the export to finish.", "info");
    return;
  }
  state.mode = mode;
  state.selection = null;
  state.tool = defaultTool(mode);
  renderTopbar();
  renderRail();
  renderToolbar();
  renderInspector();
  if (!state.file) {
    renderEmpty();
    return;
  }
  if (mode === "organize") {
    showOrganizeView();
    renderOrganize();
    ensureThumbs();
  } else {
    showCanvasView();
    renderPage();
  }
  updateCursor();
}

function goPage(value) {
  if (!state.file) return;
  const next = clamp(Math.round(value), 1, state.pages);
  state.current = next;
  state.selection = null;
  renderToolbar();
  renderPage();
  renderInspector();
}

function setZoom(value) {
  if (!state.file || state.mode === "organize") return;
  state.zoom = clamp(Number(value) || 1, 0.4, 3.5);
  renderToolbar();
  renderPage();
}

function showCanvasView() {
  const empty = $("#studio-empty");
  const organize = $("#studio-organize");
  const wrap = $("#studio-canvas-wrap");
  if (empty) empty.hidden = true;
  if (organize) organize.hidden = true;
  if (wrap) wrap.hidden = false;
}

function showOrganizeView() {
  const empty = $("#studio-empty");
  const wrap = $("#studio-canvas-wrap");
  const organize = $("#studio-organize");
  if (empty) empty.hidden = true;
  if (wrap) wrap.hidden = true;
  if (organize) organize.hidden = false;
}

/* -------------------------------------------------------------------------- */
/* Empty state + opening files                                                */
/* -------------------------------------------------------------------------- */

function renderEmpty(loadingLabel = "") {
  const wrap = $("#studio-canvas-wrap");
  const organize = $("#studio-organize");
  const slot = $("#studio-empty");
  if (!slot) return;
  if (wrap) wrap.hidden = true;
  if (organize) organize.hidden = true;
  slot.hidden = false;
  slot.innerHTML = "";

  if (loadingLabel) {
    slot.append(
      h(
        "div",
        { class: "studio-empty-card" },
        h("span", {
          class: "studio-empty-icon",
          html: icon("file", 30),
        }),
        h("span", { class: "eyebrow", text: "Reading PDF" }),
        h("h1", { text: "One moment." }),
        h(
          "p",
          { class: "form-loading", style: "justify-content:center" },
          h("span", { class: "spinner" }),
          h("span", { dataset: { loadingLabel: "" }, text: loadingLabel })
        )
      )
    );
    return;
  }

  const card = h(
    "div",
    { class: "studio-empty-card" },
    h("span", {
      class: "studio-empty-icon",
      html: icon("studio", 30),
    }),
    h("span", { class: "eyebrow", text: "PaperLab Studio" }),
    h("h1", {}, "Work on the page,", h("br"), h("em", { text: "not around it." })),
    h("p", {
      text: "Drop a PDF to edit, sign, organise, redact or crop it. Everything is rendered in your browser; the file only leaves your device when you export.",
    }),
    h(
      "div",
      { class: "studio-empty-actions" },
      h(
        "button",
        {
          class: "btn btn-primary btn-lg",
          type: "button",
          onclick: () => $("#studio-file-input")?.click(),
        },
        h("span", { html: icon("upload", 17) }),
        "Open a PDF",
        h("span", { class: "btn-arrow", html: icon("arrow", 16) })
      ),
      h("a", { class: "btn btn-quiet", href: "tools.html" }, "Browse tools")
    ),
    h("div", {
      class: "studio-empty-drop",
      text: "… or drop a PDF anywhere in this panel",
    }),
    h(
      "div",
      { class: "studio-empty-modes" },
      MODES.map((mode) => h("span", { text: mode.label }))
    )
  );
  slot.append(card);
  setupDropTarget(card);
}

function updateLoadingLabel(text) {
  const label = document.querySelector("[data-loading-label]");
  if (label) label.textContent = text;
}

function promptPassword(file, wrong = false) {
  const input = h("input", {
    class: "inspector-input",
    type: "password",
    autocomplete: "current-password",
    placeholder: "PDF password",
  });
  openModal({
    title: "Password required",
    body: h(
      "div",
      {},
      h("p", {
        class: "modal-copy",
        text: wrong
          ? "That password did not work. Try again."
          : "This PDF is encrypted. Enter its password to open it in the studio.",
      }),
      input
    ),
    actions: [
      {
        label: "Cancel",
        onClick: () => {
          state.password = "";
          if (!state.file) renderEmpty();
        },
      },
      {
        label: "Open PDF",
        variant: "btn-primary",
        onClick: () => {
          state.password = input.value;
          setTimeout(() => openFile(file, { keepPassword: true }), 0);
        },
      },
    ],
  });
  setTimeout(() => input.focus(), 60);
}

async function openFile(file, { keepPassword = false } = {}) {
  if (!file) return;
  if (fileExt(file.name) !== "pdf" && file.type !== "application/pdf") {
    toast("The studio only opens PDF files.", "error");
    return;
  }
  if (!keepPassword) state.password = "";
  const token = ++state.loadToken;
  state.loading = true;
  updateExportButton();
  if (!state.file) renderEmpty("Reading the document…");
  else toast(`Opening ${file.name}…`, "info", 2200);

  try {
    const pdfjs = await loadPDFJS();
    const bytes = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({
      data: bytes,
      ...(state.password ? { password: state.password } : {}),
      isEvalSupported: false,
    }).promise;
    if (token !== state.loadToken) {
      Promise.resolve(doc.destroy?.()).catch(() => {});
      return;
    }

    const sizes = [];
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push({ width: viewport.width, height: viewport.height });
      if (index % 8 === 0) {
        updateLoadingLabel(`Reading page ${index} of ${doc.numPages}…`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    if (token !== state.loadToken) {
      Promise.resolve(doc.destroy?.()).catch(() => {});
      return;
    }

    const old = state.pdf;
    state.pdf = doc;
    state.file = file;
    state.pages = doc.numPages;
    state.sizes = sizes;
    state.current = 1;
    state.zoom = 1;
    state.scale = 1;
    state.elements = [];
    state.redactions = [];
    state.crops = [];
    state.organize = Array.from({ length: state.pages }, (_, i) => ({
      uid: uid(),
      page: i + 1,
      rotate: 0,
    }));
    state.thumbs.clear();
    state.history = [];
    state.future = [];
    state.selection = null;
    state.dirty = false;
    state.loading = false;
    if (old && old !== doc) Promise.resolve(old.destroy?.()).catch(() => {});

    renderTopbar();
    renderRail();
    renderToolbar();
    renderInspector();
    if (state.mode === "organize") {
      showOrganizeView();
      renderOrganize();
      ensureThumbs();
    } else {
      showCanvasView();
      renderPage();
    }
    toast(
      `Opened ${file.name} · ${state.pages} page${state.pages === 1 ? "" : "s"}`,
      "success",
      3000
    );
  } catch (error) {
    if (token !== state.loadToken) return;
    state.loading = false;
    updateExportButton();
    if (error?.name === "PasswordException") {
      if (!state.file) renderEmpty();
      else renderPage();
      promptPassword(file, error.code === 2);
      return;
    }
    if (!state.file) renderEmpty();
    else {
      showCanvasView();
      renderPage();
    }
    toast(`Could not open the PDF: ${error.message || "unknown error"}`, "error");
  }
}

/* -------------------------------------------------------------------------- */
/* Page rendering                                                             */
/* -------------------------------------------------------------------------- */

async function renderPage() {
  if (!state.pdf || state.mode === "organize" || state.loading) return;
  const token = ++state.renderToken;
  const scroll = $("#studio-scroll");
  const wrap = $("#studio-canvas-wrap");
  if (!scroll || !wrap) return;
  showCanvasView();

  try {
    const page = await state.pdf.getPage(state.current);
    if (token !== state.renderToken) return;
    const base = page.getViewport({ scale: 1 });
    const available = Math.max(280, scroll.clientWidth - 64);
    const fit = clamp(available / base.width, 0.12, 2.6);
    const scale = fit * state.zoom;
    const viewport = page.getViewport({ scale });
    const canvas = $("#studio-canvas");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    state.scale = scale;

    await page.render({
      canvasContext: context,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    }).promise;
    if (token !== state.renderToken) return;
    renderOverlay();
    updateCursor();
  } catch (error) {
    if (error?.name === "RenderingCancelledException") return;
    toast(`Could not render this page: ${error.message || "unknown error"}`, "error");
  }
}

/* -------------------------------------------------------------------------- */
/* Overlay: marks, redaction boxes, crop boxes                                */
/* -------------------------------------------------------------------------- */

function renderOverlay() {
  const overlay = $("#studio-overlay");
  if (!overlay) return;
  overlay.innerHTML = "";
  if (!state.pdf || state.mode === "organize") return;
  const scale = state.scale || 1;
  const items = [];
  if (state.mode === "edit" || state.mode === "sign") {
    for (const item of state.elements) {
      if (item.page === state.current) items.push(["element", item]);
    }
  } else if (state.mode === "redact") {
    for (const item of state.redactions) {
      if (item.page === state.current) items.push(["redact", item]);
    }
  } else if (state.mode === "crop") {
    for (const item of state.crops) {
      if (item.page === state.current) items.push(["crop", item]);
    }
  }
  for (const [kind, item] of items) overlay.append(itemNode(kind, item, scale));
}

function isSelected(kind, item) {
  return Boolean(
    state.selection &&
      state.selection.kind === kind &&
      state.selection.id === item.id
  );
}

function applyBoxStyle(node, item) {
  node.style.left = `${item.x * 100}%`;
  node.style.top = `${item.y * 100}%`;
  node.style.width = `${item.w * 100}%`;
  node.style.height = `${item.h * 100}%`;
}

function addHandles(node) {
  for (const handle of ["nw", "ne", "sw", "se"]) {
    node.append(h("span", { class: "el-handle", dataset: { handle } }));
  }
}

function itemNode(kind, item, scale) {
  if (kind === "redact") {
    const node = h("div", {
      class: "redact-box",
      dataset: { kind, id: item.id },
      title: item.term || "Redaction",
    });
    applyBoxStyle(node, item);
    if (item.term) node.append(h("span", { class: "redact-tag", text: item.term }));
    if (isSelected(kind, item)) addHandles(node);
    return node;
  }
  if (kind === "crop") {
    const node = h("div", {
      class: "crop-box",
      dataset: { kind, id: item.id },
    });
    applyBoxStyle(node, item);
    node.append(h("span", { class: "crop-label", text: "KEEP" }));
    if (isSelected(kind, item)) addHandles(node);
    return node;
  }

  const node = h("div", {
    class: `el el-${item.type} ${isSelected(kind, item) ? "is-selected" : ""}`,
    dataset: { kind, id: item.id },
    "aria-label": `${TYPE_LABEL[item.type] || "Mark"} on page ${item.page}`,
  });
  applyBoxStyle(node, item);
  node.style.opacity = String(clamp(item.opacity ?? 1, 0.05, 1));

  if (item.type === "text") {
    node.textContent = item.text || "Type here";
    if (!item.text) node.classList.add("is-empty");
    node.style.fontSize = `${Math.max(6, item.fontSize || 18) * scale}px`;
    node.style.color = item.color || "#14171b";
    node.style.fontWeight = item.bold ? "700" : "400";
    node.style.textAlign = item.align || "left";
  } else if (item.type === "rect") {
    node.style.border = `${Math.max(1, (item.lineWidth || 2) * scale)}px solid ${item.color || "#2547ff"}`;
    node.style.background = item.filled ? item.fill || "#ffffff" : "transparent";
  } else if (item.type === "highlight") {
    node.style.background = item.fill || "#ffd60a";
  } else if (item.type === "ellipse") {
    node.style.border = `${Math.max(1, (item.lineWidth || 2) * scale)}px solid ${item.color || "#2547ff"}`;
    node.style.borderRadius = "50%";
  } else if (item.type === "line" || item.type === "ink") {
    node.append(vectorNode(item, scale));
  } else if (item.type === "image" || item.type === "signature") {
    node.append(
      h("img", {
        class: "el-image",
        src: item.image,
        alt: item.type === "signature" ? "Signature" : "Placed image",
        draggable: "false",
      })
    );
  }

  if (isSelected(kind, item)) addHandles(node);
  return node;
}

function vectorNode(item, scale) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", item.type === "ink" ? "el-ink-svg" : "el-line-svg");
  svg.setAttribute("viewBox", "0 0 1000 1000");
  svg.setAttribute("preserveAspectRatio", "none");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  const points = [];
  const raw = item.points || [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const x = item.w > 0 ? (raw[i] - item.x) / item.w : 0;
    const y = item.h > 0 ? (raw[i + 1] - item.y) / item.h : 0;
    points.push(`${(x * 1000).toFixed(2)},${(y * 1000).toFixed(2)}`);
  }
  line.setAttribute("points", points.join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", item.color || "#2547ff");
  line.setAttribute("stroke-width", String(Math.max(1, (item.lineWidth || 2) * scale)));
  line.setAttribute("vector-effect", "non-scaling-stroke");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  svg.append(line);
  return svg;
}

/* -------------------------------------------------------------------------- */
/* Pointer interactions                                                       */
/* -------------------------------------------------------------------------- */

function pagePoint(event) {
  const overlay = $("#studio-overlay");
  const rect = overlay.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
    y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
  };
}

function onOverlayPointerDown(event) {
  if (!state.file || state.mode === "organize" || event.button !== 0) return;
  const overlay = $("#studio-overlay");
  const handle = event.target.closest?.(".el-handle");
  const node = event.target.closest?.("[data-kind][data-id]");

  if (handle && node) {
    const item = findItem(node.dataset.kind, node.dataset.id);
    if (item) {
      event.preventDefault();
      select(node.dataset.kind, item.id, { render: false });
      startDrag("resize", node.dataset.kind, item, handle.dataset.handle, event);
    }
    return;
  }
  if (node) {
    const item = findItem(node.dataset.kind, node.dataset.id);
    if (item) {
      event.preventDefault();
      select(node.dataset.kind, item.id, { render: false });
      startDrag("move", node.dataset.kind, item, null, event);
    }
    return;
  }
  if (DRAW_TOOLS.has(state.tool)) {
    event.preventDefault();
    startDraw(event);
    return;
  }
  state.selection = null;
  renderOverlay();
  renderInspector();
  if (overlay) overlay.focus();
}

function startDrag(mode, kind, item, handle, event) {
  const overlay = $("#studio-overlay");
  state.drag = {
    mode,
    kind,
    id: item.id,
    handle,
    start: pagePoint(event),
    origin: { x: item.x, y: item.y, w: item.w, h: item.h },
    points: item.points ? [...item.points] : null,
    pushed: false,
  };
  try {
    overlay.setPointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
}

function onOverlayPointerMove(event) {
  const drag = state.drag;
  if (!drag) return;
  event.preventDefault();
  const point = pagePoint(event);
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;

  if (!drag.pushed && (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001)) {
    pushHistory();
    drag.pushed = true;
  }
  if (drag.mode === "draw") {
    if (drag.tool === "ink") {
      const last = drag.points[drag.points.length - 1];
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 0.0015) {
        drag.points.push(point);
      }
    }
    drag.last = point;
    updateDrawPreview(drag, point);
    return;
  }

  const item = findItem(drag.kind, drag.id);
  if (!item) return;

  if (drag.mode === "move") {
    const nextX = clamp(drag.origin.x + dx, 0, 1 - drag.origin.w);
    const nextY = clamp(drag.origin.y + dy, 0, 1 - drag.origin.h);
    const shiftX = nextX - item.x;
    const shiftY = nextY - item.y;
    item.x = nextX;
    item.y = nextY;
    if (item.points) {
      item.points = item.points.map((value, index) =>
        index % 2 === 0 ? value + shiftX : value + shiftY
      );
    }
  } else if (drag.mode === "resize") {
    const minW = 0.01;
    const minH = 0.01;
    let x = drag.origin.x;
    let y = drag.origin.y;
    let w = drag.origin.w;
    let h = drag.origin.h;
    if (drag.handle.includes("e")) w = clamp(drag.origin.w + dx, minW, 1 - x);
    if (drag.handle.includes("s")) h = clamp(drag.origin.h + dy, minH, 1 - y);
    if (drag.handle.includes("w")) {
      const nextX = clamp(drag.origin.x + dx, 0, x + w - minW);
      w += x - nextX;
      x = nextX;
    }
    if (drag.handle.includes("n")) {
      const nextY = clamp(drag.origin.y + dy, 0, y + h - minH);
      h += y - nextY;
      y = nextY;
    }
    item.x = x;
    item.y = y;
    item.w = w;
    item.h = h;
    if (item.points && drag.points) {
      const scaleX = w / Math.max(0.0001, drag.origin.w);
      const scaleY = h / Math.max(0.0001, drag.origin.h);
      item.points = drag.points.map((value, index) =>
        index % 2 === 0
          ? x + (value - drag.origin.x) * scaleX
          : y + (value - drag.origin.y) * scaleY
      );
    }
  }
  renderOverlay();
}

function onOverlayPointerUp(event) {
  const drag = state.drag;
  if (!drag) return;
  const overlay = $("#studio-overlay");
  try {
    overlay.releasePointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
  state.drag = null;
  if (drag.mode === "draw") {
    finishDraw(drag, event);
    return;
  }
  if (!drag.pushed) {
    renderOverlay();
    renderInspector();
    return;
  }
  state.dirty = true;
  updateHistoryButtons();
  renderOverlay();
  renderInspector();
}

function startDraw(event) {
  const point = pagePoint(event);
  if (state.tool === "text") {
    createText(point);
    return;
  }
  if (state.tool === "signature") {
    placeSignature(point);
    return;
  }
  state.drag = {
    mode: "draw",
    tool: state.tool,
    start: point,
    last: point,
    points: [point],
    pushed: false,
  };
  try {
    $("#studio-overlay").setPointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
  updateDrawPreview(state.drag, point);
}

function clearPreview() {
  document.querySelector("#studio-preview")?.remove();
}

function updateDrawPreview(drag, point) {
  const overlay = $("#studio-overlay");
  const rect = overlay.getBoundingClientRect();
  let node = document.querySelector("#studio-preview");

  if (drag.tool === "ink") {
    if (!node || node.tagName.toLowerCase() !== "svg") {
      node?.remove();
      node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      node.id = "studio-preview";
      node.setAttribute("class", "el-ink-svg");
      node.setAttribute("viewBox", "0 0 1000 1000");
      node.setAttribute("preserveAspectRatio", "none");
      node.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:7";
      overlay.append(node);
    }
    let line = node.querySelector("polyline");
    if (!line) {
      line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "#2547ff");
      line.setAttribute("stroke-width", "2");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("stroke-linejoin", "round");
      node.append(line);
    }
    line.setAttribute(
      "points",
      drag.points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ")
    );
    return;
  }

  if (drag.tool === "line") {
    if (!node || node.tagName.toLowerCase() !== "div") {
      node?.remove();
      node = h("div", { id: "studio-preview", class: "el-preview-line" });
      overlay.append(node);
    }
    const x1 = drag.start.x * rect.width;
    const y1 = drag.start.y * rect.height;
    const x2 = point.x * rect.width;
    const y2 = point.y * rect.height;
    const length = Math.hypot(x2 - x1, y2 - y1);
    node.style.left = `${x1}px`;
    node.style.top = `${y1}px`;
    node.style.width = `${length}px`;
    node.style.transform = `rotate(${Math.atan2(y2 - y1, x2 - x1)}rad)`;
    return;
  }

  if (!node || node.tagName.toLowerCase() !== "div") {
    node?.remove();
    node = h("div", { id: "studio-preview", class: "el-preview" });
    overlay.append(node);
  }
  const box = normalizeBox(drag.start, point);
  node.style.left = `${box.x * 100}%`;
  node.style.top = `${box.y * 100}%`;
  node.style.width = `${box.w * 100}%`;
  node.style.height = `${box.h * 100}%`;
}

function normalizeBox(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function defaultBox(tool, point) {
  const sizes = {
    highlight: [0.24, 0.032],
    rect: [0.2, 0.12],
    ellipse: [0.18, 0.14],
    "redact-box": [0.24, 0.038],
    "crop-box": [0.6, 0.6],
  };
  const [w, h] = sizes[tool] || [0.2, 0.1];
  return {
    x: clamp(point.x - w / 2, 0, 1 - w),
    y: clamp(point.y - h / 2, 0, 1 - h),
    w,
    h,
  };
}

function finishDraw(drag, event) {
  clearPreview();
  const point = pagePoint(event);
  const tool = drag.tool;

  if (tool === "line") {
    if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 0.008) return;
    const points = [drag.start.x, drag.start.y, point.x, point.y];
    const x = Math.min(drag.start.x, point.x);
    const y = Math.min(drag.start.y, point.y);
    pushHistory();
    const item = {
      id: uid(),
      page: state.current,
      type: "line",
      x,
      y,
      w: Math.max(0.004, Math.abs(point.x - drag.start.x)),
      h: Math.max(0.004, Math.abs(point.y - drag.start.y)),
      points,
      color: "#2547ff",
      lineWidth: 2,
      opacity: 1,
    };
    state.elements.push(item);
    state.selection = { kind: "element", id: item.id };
    afterChange();
    return;
  }

  if (tool === "ink") {
    if (drag.points.length < 2) return;
    const xs = drag.points.map((p) => p.x);
    const ys = drag.points.map((p) => p.y);
    const pad = 0.003;
    const x = clamp(Math.min(...xs) - pad, 0, 1);
    const y = clamp(Math.min(...ys) - pad, 0, 1);
    const w = clamp(Math.max(...xs) + pad - x, 0.004, 1 - x);
    const h = clamp(Math.max(...ys) + pad - y, 0.004, 1 - y);
    pushHistory();
    const item = {
      id: uid(),
      page: state.current,
      type: "ink",
      x,
      y,
      w,
      h,
      points: drag.points.flatMap((p) => [p.x, p.y]),
      color: "#14171b",
      lineWidth: 2.4,
      opacity: 1,
    };
    state.elements.push(item);
    state.selection = { kind: "element", id: item.id };
    afterChange();
    return;
  }

  let box = normalizeBox(drag.start, point);
  if (box.w < 0.008 || box.h < 0.008) box = defaultBox(tool, point);

  if (tool === "redact-box") {
    pushHistory();
    const item = {
      id: uid(),
      page: state.current,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      term: "Box",
    };
    state.redactions.push(item);
    state.selection = { kind: "redact", id: item.id };
    afterChange();
    return;
  }

  if (tool === "crop-box") {
    pushHistory();
    const existing = state.crops.find((crop) => crop.page === state.current);
    if (existing) {
      existing.x = box.x;
      existing.y = box.y;
      existing.w = box.w;
      existing.h = box.h;
      state.selection = { kind: "crop", id: existing.id };
    } else {
      const item = {
        id: uid(),
        page: state.current,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
      };
      state.crops.push(item);
      state.selection = { kind: "crop", id: item.id };
    }
    afterChange();
    return;
  }

  pushHistory();
  const item = {
    id: uid(),
    page: state.current,
    type: tool,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    color: tool === "highlight" ? "#ffd60a" : "#2547ff",
    fill: tool === "highlight" ? "#ffd60a" : "",
    filled: false,
    opacity: tool === "highlight" ? 0.45 : 1,
    lineWidth: tool === "highlight" ? 1 : 2,
  };
  state.elements.push(item);
  state.selection = { kind: "element", id: item.id };
  afterChange();
}

function createText(point) {
  const size = state.sizes[state.current - 1] || { width: 612, height: 792 };
  const w = 0.4;
  const h = clamp((18 * 1.4 * 2) / size.height, 0.04, 0.2);
  pushHistory();
  const item = {
    id: uid(),
    page: state.current,
    type: "text",
    x: clamp(point.x, 0, 1 - w),
    y: clamp(point.y, 0, 1 - h),
    w,
    h,
    text: "",
    fontSize: 18,
    color: "#14171b",
    bold: false,
    align: "left",
    opacity: 1,
    lineWidth: 1,
  };
  state.elements.push(item);
  state.selection = { kind: "element", id: item.id };
  afterChange();
  setTimeout(() => $("#inspector-text")?.focus(), 50);
}

function placeSignature(point) {
  if (!state.signature?.dataURL) {
    toast("Create a signature in the panel first.", "error");
    return;
  }
  const size = state.sizes[state.current - 1] || { width: 612, height: 792 };
  const aspect = state.signature.aspect || 2.6;
  const w = 0.26;
  const h = clamp((w * size.width) / aspect / size.height, 0.035, 0.35);
  pushHistory();
  const item = {
    id: uid(),
    page: state.current,
    type: "signature",
    x: clamp(point.x - w / 2, 0, 1 - w),
    y: clamp(point.y - h / 2, 0, 1 - h),
    w,
    h,
    image: state.signature.dataURL,
    opacity: 1,
  };
  state.elements.push(item);
  state.selection = { kind: "element", id: item.id };
  afterChange();
  toast(`Signature placed on page ${state.current}`, "success", 2400);
}

async function addImageElement(dataURL) {
  const image = await loadImage(dataURL);
  const aspect = image.width / Math.max(1, image.height);
  const size = state.sizes[state.current - 1] || { width: 612, height: 792 };
  const w = 0.34;
  const h = clamp((w * size.width) / aspect / size.height, 0.02, 0.8);
  pushHistory();
  const item = {
    id: uid(),
    page: state.current,
    type: "image",
    x: clamp(0.5 - w / 2, 0, 1 - w),
    y: clamp(0.5 - h / 2, 0, 1 - h),
    w,
    h,
    image: dataURL,
    opacity: 1,
  };
  state.elements.push(item);
  state.selection = { kind: "element", id: item.id };
  afterChange();
}

/* -------------------------------------------------------------------------- */
/* Selection, history and mutation                                            */
/* -------------------------------------------------------------------------- */

function collectionFor(kind) {
  if (kind === "element") return state.elements;
  if (kind === "redact") return state.redactions;
  if (kind === "crop") return state.crops;
  return [];
}

function findItem(kind, id) {
  return collectionFor(kind).find((item) => item.id === id) || null;
}

function selectionItem() {
  if (!state.selection) return null;
  return findItem(state.selection.kind, state.selection.id);
}

function select(kind, id, { render = true } = {}) {
  state.selection = { kind, id };
  if (render) {
    renderOverlay();
    renderInspector();
  }
}

function snapshot() {
  return JSON.stringify({
    elements: state.elements,
    redactions: state.redactions,
    crops: state.crops,
    organize: state.organize,
  });
}

function restore(snap) {
  const data = JSON.parse(snap);
  state.elements = data.elements || [];
  state.redactions = data.redactions || [];
  state.crops = data.crops || [];
  state.organize = data.organize || [];
  state.selection = null;
}

function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 60) state.history.shift();
  state.future = [];
  updateHistoryButtons();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(snapshot());
  restore(state.history.pop());
  state.dirty = true;
  updateHistoryButtons();
  if (state.mode === "organize") {
    renderOrganize();
    ensureThumbs();
  } else {
    renderOverlay();
  }
  renderInspector();
}

function redo() {
  if (!state.future.length) return;
  state.history.push(snapshot());
  restore(state.future.pop());
  state.dirty = true;
  updateHistoryButtons();
  if (state.mode === "organize") {
    renderOrganize();
    ensureThumbs();
  } else {
    renderOverlay();
  }
  renderInspector();
}

function afterChange({ overlay = true, inspector = true, organize = false } = {}) {
  state.dirty = true;
  updateHistoryButtons();
  if (organize || state.mode === "organize") renderOrganize();
  else if (overlay) renderOverlay();
  if (inspector) renderInspector();
}

function duplicateSelection() {
  const selected = selectionItem();
  if (!selected || !state.selection) return;
  pushHistory();
  const copy = {
    ...selected,
    id: uid(),
    x: clamp(selected.x + 0.02, 0, 1 - selected.w),
    y: clamp(selected.y + 0.02, 0, 1 - selected.h),
  };
  if (copy.points) {
    copy.points = copy.points.map((value, index) =>
      index % 2 === 0 ? value + 0.02 : value + 0.02
    );
  }
  collectionFor(state.selection.kind).push(copy);
  state.selection = { kind: state.selection.kind, id: copy.id };
  afterChange();
}

function deleteSelection() {
  if (!state.selection) return;
  deleteItem(state.selection.kind, state.selection.id);
}

function deleteItem(kind, id) {
  const list = collectionFor(kind);
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return;
  pushHistory();
  list.splice(index, 1);
  if (state.selection?.id === id) state.selection = null;
  afterChange();
}

function moveLayer(item, direction) {
  const index = state.elements.indexOf(item);
  if (index < 0) return;
  const next = clamp(index + direction, 0, state.elements.length - 1);
  if (next === index) return;
  pushHistory();
  state.elements.splice(index, 1);
  state.elements.splice(next, 0, item);
  afterChange();
}

function nudgeSelection(dx, dy) {
  const item = selectionItem();
  if (!item) return;
  pushHistory();
  item.x = clamp(item.x + dx, 0, 1 - item.w);
  item.y = clamp(item.y + dy, 0, 1 - item.h);
  if (item.points) {
    item.points = item.points.map((value, index) =>
      index % 2 === 0 ? value + dx : value + dy
    );
  }
  afterChange({ inspector: false });
}

/* -------------------------------------------------------------------------- */
/* Inspector primitives                                                       */
/* -------------------------------------------------------------------------- */

function inspectorTitle(iconName, text, count = "") {
  return h(
    "div",
    { class: "inspector-title" },
    h("span", { html: icon(iconName, 14) }),
    h("span", { text }),
    count ? h("span", { class: "count", text: count }) : null
  );
}

function inspectorCard(title, copy, ...children) {
  return h(
    "div",
    { class: "inspector-card" },
    title ? h("h3", { text: title }) : null,
    copy ? h("p", { text: copy }) : null,
    ...children
  );
}

function inspectorEmpty(title, copy, iconName = "layers") {
  return h(
    "div",
    { class: "inspector-empty" },
    h("span", { html: icon(iconName, 22) }),
    h("strong", { text: title }),
    h("p", { text: copy })
  );
}

function inspectorNote(text, iconName = "spark") {
  return h(
    "p",
    { class: "inspector-note" },
    h("span", { html: icon(iconName, 13) }),
    h("span", { text })
  );
}

function field(label, control, full = false, meta = "") {
  return h(
    "div",
    { class: `inspector-field${full ? " full" : ""}` },
    h(
      "label",
      { class: "inspector-label" },
      h("span", { text: label }),
      meta ? h("span", { text: meta }) : null
    ),
    control
  );
}

function textInput({ value, placeholder = "", onInput, onFocus, id }) {
  const input = h("input", {
    class: "inspector-input",
    type: "text",
    placeholder,
    id,
    oninput: (event) => onInput(event.target.value),
    onfocus: onFocus,
  });
  input.value = value == null ? "" : String(value);
  return input;
}

function numberInput({ value, min, max, step = 1, onInput, onFocus, placeholder = "" }) {
  const input = h("input", {
    class: "inspector-input",
    type: "number",
    min,
    max,
    step,
    placeholder,
    oninput: (event) => {
      const next = Number(event.target.value);
      if (Number.isFinite(next)) onInput(next);
    },
    onfocus: onFocus,
  });
  input.value = value == null ? "" : String(value);
  return input;
}

function colorInput(value, onInput, onFocus) {
  const code = h("code", { text: String(value || "#000000").toUpperCase() });
  const input = h("input", {
    type: "color",
    value: value || "#000000",
    oninput: (event) => {
      code.textContent = event.target.value.toUpperCase();
      onInput(event.target.value);
    },
    onfocus: onFocus,
  });
  return h("div", { class: "inspector-color" }, input, code);
}

function rangeInput({ value, min = 0, max = 1, step = 0.05, onInput, onFocus, percent = true }) {
  const format = (next) =>
    percent ? `${Math.round(Number(next) * 100)}%` : String(next);
  const output = h("output", { text: format(value) });
  const input = h("input", {
    type: "range",
    min,
    max,
    step,
    oninput: (event) => {
      const next = Number(event.target.value);
      output.textContent = format(next);
      onInput(next);
    },
    onfocus: onFocus,
  });
  input.value = String(value);
  return h("div", { class: "inspector-range" }, input, output);
}

function selectInput(options, value, onChange) {
  const select = h("select", {
    class: "inspector-select",
    onchange: (event) => onChange(event.target.value),
  });
  for (const [optionValue, label] of options) {
    const option = h("option", { value: optionValue, text: label });
    if (String(optionValue) === String(value)) option.selected = true;
    select.append(option);
  }
  return select;
}

function checkRow(label, checked, onChange) {
  const input = h("input", {
    type: "checkbox",
    onchange: (event) => onChange(event.target.checked),
  });
  input.checked = Boolean(checked);
  return h(
    "label",
    { class: "check-row", style: "padding:0;min-height:32px" },
    input,
    h("span", { text: label })
  );
}

function actionRow(...children) {
  return h("div", { class: "inspector-actions" }, ...children.filter(Boolean));
}

function markRow(kind, item, iconName, label, { removable = false } = {}) {
  const row = h(
    "div",
    { class: "inspector-list-row", role: "button", tabindex: "0" },
    h("span", { html: icon(iconName, 13) }),
    h("span", { text: label }),
    h("span", { class: "mono", text: `p.${item.page}` })
  );
  row.addEventListener("click", () => gotoItem(kind, item));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      gotoItem(kind, item);
    }
  });
  if (removable) {
    row.append(
      h("button", {
        type: "button",
        title: "Remove",
        "aria-label": `Remove ${label}`,
        html: icon("trash", 13),
        onclick: (event) => {
          event.stopPropagation();
          deleteItem(kind, item.id);
        },
      })
    );
  }
  return row;
}

function gotoItem(kind, item) {
  if (item.page !== state.current) {
    state.current = item.page;
    renderToolbar();
    renderPage();
  }
  select(kind, item.id);
}

/* -------------------------------------------------------------------------- */
/* Inspector                                                                  */
/* -------------------------------------------------------------------------- */

function renderInspector() {
  const box = $("#studio-inspector");
  if (!box) return;
  box.innerHTML = "";
  state.sigPreviewEl = null;
  state.sigPlaceBtn = null;

  if (!state.file) {
    box.append(
      inspectorTitle("studio", "Studio"),
      inspectorCard(
        "Open a PDF to begin",
        "Every mode works on the same document. Switch between edit, sign, arrange, redact and crop without uploading again."
      ),
      inspectorNote("Files stay in your browser until you export.", "lock")
    );
    return;
  }

  let fragment = null;
  if (state.mode === "edit") fragment = editInspector();
  else if (state.mode === "sign") fragment = signInspector();
  else if (state.mode === "organize") fragment = organizeInspector();
  else if (state.mode === "redact") fragment = redactInspector();
  else if (state.mode === "crop") fragment = cropInspector();
  if (fragment) box.append(fragment);
}

function markLabel(item) {
  if (item.type === "text") {
    const text = String(item.text || "").trim();
    return text ? text.slice(0, 28) : "Empty text";
  }
  return TYPE_LABEL[item.type] || "Mark";
}

function editInspector() {
  if (state.selection?.kind === "element") {
    const item = selectionItem();
    if (item) return elementInspector(item);
  }
  const fragment = document.createDocumentFragment();
  fragment.append(
    inspectorTitle("edit", "Edit", `${state.elements.length} marks`),
    inspectorCard(
      "Mark up the page.",
      "Choose a tool from the rail and drag on the page. Click any mark to adjust its colour, size or position."
    )
  );
  const marks = state.elements.filter((item) => item.page === state.current);
  fragment.append(inspectorTitle("layers", "On this page", String(marks.length)));
  if (!marks.length) {
    fragment.append(
      inspectorEmpty(
        "Nothing here yet",
        "Pick a tool from the left and drag on the page.",
        "edit"
      )
    );
  } else {
    fragment.append(
      h(
        "div",
        { class: "inspector-list" },
        marks.map((item) =>
          markRow("element", item, TYPE_ICON[item.type] || "edit", markLabel(item), {
            removable: true,
          })
        )
      )
    );
  }
  fragment.append(
    inspectorNote(
      "Marks are baked into the PDF on export. Undo is available until you close the tab.",
      "spark"
    )
  );
  return fragment;
}

function elementInspector(item) {
  const fragment = document.createDocumentFragment();
  fragment.append(
    inspectorTitle(
      TYPE_ICON[item.type] || "edit",
      TYPE_LABEL[item.type] || "Mark",
      `PAGE ${item.page}`
    )
  );
  const card = h("div", { class: "inspector-card" });
  const after = () => afterChange({ inspector: false });

  if (item.type === "text") {
    const textarea = h("textarea", {
      class: "inspector-textarea",
      id: "inspector-text",
      placeholder: "Type your text…",
      onfocus: pushHistory,
      oninput: (event) => {
        item.text = event.target.value;
        after();
      },
    });
    textarea.value = item.text || "";
    card.append(field("Text", textarea, true));
    const grid = h("div", { class: "inspector-grid" });
    grid.append(
      field(
        "Colour",
        colorInput(item.color, (value) => {
          item.color = value;
          after();
        }, pushHistory)
      ),
      field(
        "Size",
        numberInput({
          value: item.fontSize,
          min: 6,
          max: 144,
          step: 1,
          onInput: (value) => {
            item.fontSize = value;
            after();
          },
          onFocus: pushHistory,
        }),
        false,
        "pt"
      ),
      field(
        "Align",
        selectInput(
          [
            ["left", "Left"],
            ["center", "Centre"],
            ["right", "Right"],
          ],
          item.align || "left",
          (value) => {
            item.align = value;
            after();
          }
        )
      ),
      field(
        "Weight",
        checkRow("Bold", item.bold, (value) => {
          item.bold = value;
          after();
        })
      )
    );
    card.append(grid);
    card.append(
      field(
        "Opacity",
        rangeInput({
          value: item.opacity ?? 1,
          min: 0.1,
          max: 1,
          step: 0.05,
          onInput: (value) => {
            item.opacity = value;
            after();
          },
          onFocus: pushHistory,
        })
      )
    );
  } else if (item.type === "rect") {
    card.append(
      field(
        "Stroke",
        colorInput(item.color, (value) => {
          item.color = value;
          after();
        }, pushHistory)
      ),
      field(
        "Line",
        numberInput({
          value: item.lineWidth || 2,
          min: 0.5,
          max: 12,
          step: 0.5,
          onInput: (value) => {
            item.lineWidth = value;
            after();
          },
          onFocus: pushHistory,
        }),
        false,
        "pt"
      ),
      field(
        "Fill",
        checkRow("Fill this box", item.filled, (value) => {
          item.filled = value;
          if (value && !item.fill) item.fill = "#ffffff";
          afterChange();
        })
      )
    );
    if (item.filled) {
      card.append(
        field(
          "Fill colour",
          colorInput(item.fill, (value) => {
            item.fill = value;
            after();
          }, pushHistory)
        )
      );
    }
    card.append(
      field(
        "Opacity",
        rangeInput({
          value: item.opacity ?? 1,
          min: 0.1,
          max: 1,
          step: 0.05,
          onInput: (value) => {
            item.opacity = value;
            after();
          },
          onFocus: pushHistory,
        })
      )
    );
  } else if (item.type === "highlight") {
    card.append(
      field(
        "Ink",
        colorInput(item.fill || "#ffd60a", (value) => {
          item.fill = value;
          after();
        }, pushHistory)
      ),
      field(
        "Opacity",
        rangeInput({
          value: item.opacity ?? 0.45,
          min: 0.1,
          max: 1,
          step: 0.05,
          onInput: (value) => {
            item.opacity = value;
            after();
          },
          onFocus: pushHistory,
        })
      )
    );
  } else if (item.type === "ellipse") {
    card.append(
      field(
        "Stroke",
        colorInput(item.color, (value) => {
          item.color = value;
          after();
        }, pushHistory)
      ),
      field(
        "Line",
        numberInput({
          value: item.lineWidth || 2,
          min: 0.5,
          max: 12,
          step: 0.5,
          onInput: (value) => {
            item.lineWidth = value;
            after();
          },
          onFocus: pushHistory,
        }),
        false,
        "pt"
      ),
      field(
        "Opacity",
        rangeInput({
          value: item.opacity ?? 1,
          min: 0.1,
          max: 1,
          step: 0.05,
          onInput: (value) => {
            item.opacity = value;
            after();
          },
          onFocus: pushHistory,
        })
      )
    );
  } else if (item.type === "line" || item.type === "ink") {
    card.append(
      field(
        "Stroke",
        colorInput(item.color, (value) => {
          item.color = value;
          after();
        }, pushHistory)
      ),
      field(
        "Width",
        numberInput({
          value: item.lineWidth || 2,
          min: 0.5,
          max: 16,
          step: 0.5,
          onInput: (value) => {
            item.lineWidth = value;
            after();
          },
          onFocus: pushHistory,
        }),
        false,
        "pt"
      ),
      field(
        "Opacity",
        rangeInput({
          value: item.opacity ?? 1,
          min: 0.1,
          max: 1,
          step: 0.05,
          onInput: (value) => {
            item.opacity = value;
            after();
          },
          onFocus: pushHistory,
        })
      )
    );
  } else if (item.type === "image" || item.type === "signature") {
    card.append(
      field(
        "Opacity",
        rangeInput({
          value: item.opacity ?? 1,
          min: 0.1,
          max: 1,
          step: 0.05,
          onInput: (value) => {
            item.opacity = value;
            after();
          },
          onFocus: pushHistory,
        })
      )
    );
    if (item.type === "image") {
      card.append(
        h(
          "button",
          {
            class: "btn btn-quiet btn-sm btn-block",
            type: "button",
            style: "margin-top:10px",
            onclick: () => {
              state.replaceImageId = item.id;
              $("#studio-image-input")?.click();
            },
          },
          h("span", { html: icon("image", 14) }),
          "Replace image"
        )
      );
    } else {
      card.append(
        h(
          "button",
          {
            class: "btn btn-quiet btn-sm btn-block",
            type: "button",
            style: "margin-top:10px",
            onclick: () => {
              state.selection = null;
              setMode("sign");
              toast("Draw or choose a new signature in the panel.", "info");
            },
          },
          h("span", { html: icon("sign", 14) }),
          "Make a new signature"
        )
      );
    }
  }

  card.append(
    inspectorNote(
      `Page ${item.page} · ${Math.round(item.x * 100)}% from left · ${Math.round(
        item.y * 100
      )}% from top · ${Math.round(item.w * 100)}×${Math.round(item.h * 100)}%`,
      "cursor"
    )
  );
  card.append(
    actionRow(
      h(
        "button",
        { class: "btn btn-quiet btn-sm", type: "button", onclick: duplicateSelection },
        h("span", { html: icon("duplicate", 14) }),
        "Duplicate"
      ),
      h(
        "button",
        { class: "btn btn-danger btn-sm", type: "button", onclick: deleteSelection },
        h("span", { html: icon("trash", 14) }),
        "Delete"
      )
    )
  );
  card.append(
    actionRow(
      h(
        "button",
        { class: "btn btn-ghost btn-sm", type: "button", onclick: () => moveLayer(item, -1) },
        "Send back"
      ),
      h(
        "button",
        { class: "btn btn-ghost btn-sm", type: "button", onclick: () => moveLayer(item, 1) },
        "Bring forward"
      )
    )
  );
  fragment.append(card);
  return fragment;
}

function signInspector() {
  if (state.selection?.kind === "element") {
    const item = selectionItem();
    if (item) return elementInspector(item);
  }
  const placements = state.elements.filter((item) => item.type === "signature");
  const fragment = document.createDocumentFragment();
  fragment.append(
    inspectorTitle("sign", "Sign", `${placements.length} placed`),
    signatureCard(),
    signerCard(),
    placementsCard(placements),
    inspectorNote(
      "This is an electronic signature, not a qualified digital certificate. The audit JSON records SHA-256 hashes of the source and result.",
      "lock"
    )
  );
  return fragment;
}

function signatureCard() {
  const card = inspectorCard("Your signature");
  const tabs = h("div", { class: "sig-tabs" });
  for (const [id, label] of [
    ["draw", "Draw"],
    ["type", "Type"],
    ["upload", "Upload"],
  ]) {
    tabs.append(
      h("button", {
        class: `sig-tab ${state.sigSource === id ? "is-active" : ""}`,
        type: "button",
        text: label,
        onclick: () => {
          state.sigSource = id;
          renderInspector();
        },
      })
    );
  }
  card.append(tabs);

  if (state.sigSource === "draw") {
    const pad = signaturePad();
    state.sigPadCanvas = pad.canvas;
    card.append(pad.wrap);
    card.append(
      actionRow(
        h(
          "button",
          {
            class: "btn btn-quiet btn-sm",
            type: "button",
            onclick: () => {
              pad.clear();
              state.signature = null;
              updateSigPreview();
            },
          },
          "Clear"
        ),
        h(
          "button",
          { class: "btn btn-primary btn-sm", type: "button", onclick: usePadSignature },
          "Use signature"
        )
      )
    );
  } else if (state.sigSource === "type") {
    state.sigTyped = state.sigTyped || "";
    state.sigFont = state.sigFont || "script";
    const input = textInput({
      value: state.sigTyped,
      placeholder: "Type your name",
      onInput: (value) => {
        state.sigTyped = value;
      },
    });
    input.id = "sig-typed-input";
    const style = selectInput(
      [
        ["script", "Script"],
        ["serif", "Serif"],
        ["mono", "Mono"],
      ],
      state.sigFont,
      (value) => {
        state.sigFont = value;
      }
    );
    card.append(field("Name", input, true), field("Style", style));
    card.append(
      h(
        "button",
        {
          class: "btn btn-primary btn-sm btn-block",
          type: "button",
          style: "margin-top:10px",
          onclick: () => createTypedSignature(state.sigTyped, state.sigFont),
        },
        "Create signature"
      )
    );
  } else {
    const upload = h("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/webp",
      class: "visually-hidden",
      onchange: async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
          const dataURL = await imageToPNG(file, { trim: true });
          setSignature(dataURL);
        } catch (error) {
          toast(error.message || "Could not read that image.", "error");
        }
      },
    });
    card.append(
      upload,
      h(
        "button",
        {
          class: "btn btn-quiet btn-sm btn-block",
          type: "button",
          style: "margin-top:10px",
          onclick: () => upload.click(),
        },
        h("span", { html: icon("upload", 14) }),
        "Choose a signature image"
      ),
      h("p", {
        class: "field-help",
        text: "PNG with a transparent background works best.",
      })
    );
  }

  const preview = h("div", { class: "sig-preview" });
  const place = h(
    "button",
    {
      class: "btn btn-primary btn-sm btn-block",
      type: "button",
      style: "margin-top:10px",
      onclick: () => {
        state.tool = "signature";
        renderRail();
        updateCursor();
        toast("Click anywhere on the page to place the signature.", "info");
      },
    },
    h("span", { html: icon("sign", 14) }),
    "Place on page"
  );
  state.sigPreviewEl = preview;
  state.sigPlaceBtn = place;
  card.append(preview, place);
  updateSigPreview();
  return card;
}

function signerCard() {
  const grid = h("div", { class: "inspector-grid" });
  grid.append(
    field(
      "Signer",
      textInput({
        value: state.sigMeta.signer,
        placeholder: "Full name",
        onInput: (value) => {
          state.sigMeta.signer = value;
        },
      }),
      true
    ),
    field(
      "Email",
      textInput({
        value: state.sigMeta.email,
        placeholder: "name@example.com",
        onInput: (value) => {
          state.sigMeta.email = value;
        },
      }),
      true
    ),
    field(
      "Reason",
      textInput({
        value: state.sigMeta.reason,
        placeholder: "Approved",
        onInput: (value) => {
          state.sigMeta.reason = value;
        },
      }),
      true
    )
  );
  return inspectorCard(
    "Signer details",
    "Written to the optional certificate page and audit JSON.",
    grid,
    h(
      "div",
      { style: "margin-top:10px" },
      checkRow(
        "Add a signature certificate page",
        state.sigMeta.certificatePage,
        (value) => {
          state.sigMeta.certificatePage = value;
        }
      )
    )
  );
}

function placementsCard(placements) {
  const card = inspectorCard(
    "Placements",
    placements.length
      ? "Click a placement to move or resize it."
      : "No signature on the page yet."
  );
  if (placements.length) {
    card.append(
      h(
        "div",
        { class: "inspector-list" },
        placements.map((item) =>
          markRow("element", item, "sign", "Signature", { removable: true })
        )
      )
    );
  }
  return card;
}

function redactInspector() {
  if (state.selection?.kind === "redact") {
    const item = selectionItem();
    if (item) return redactionInspector(item);
  }
  const fragment = document.createDocumentFragment();
  fragment.append(
    inspectorTitle("redact", "Redact", `${state.redactions.length} marks`)
  );

  const textarea = h("textarea", {
    class: "inspector-textarea",
    id: "redact-search-input",
    placeholder: "Account number\nJane Doe",
    oninput: (event) => {
      state.redactTermsText = event.target.value;
    },
  });
  textarea.value = state.redactTermsText;
  const status = h("p", {
    class: "field-help",
    text: state.redactStatus || "One term per line. Case-insensitive.",
  });
  const button = h(
    "button",
    {
      class: "btn btn-primary btn-sm btn-block",
      type: "button",
      onclick: () => runRedactSearch(button, status),
    },
    h("span", { html: icon("search", 14) }),
    "Find & mark"
  );
  fragment.append(
    inspectorCard(
      "Find words",
      "PaperLab reads the text layer and adds a box over every match.",
      field("Terms", textarea, true),
      h("div", { style: "margin-top:8px" }, button),
      status
    )
  );

  const marks = state.redactions;
  fragment.append(inspectorTitle("layers", "Redaction marks", String(marks.length)));
  if (!marks.length) {
    fragment.append(
      inspectorEmpty(
        "Nothing blacked out",
        "Draw a box on the page, or search for a word to mark every match.",
        "redact"
      )
    );
  } else {
    fragment.append(
      h(
        "div",
        { class: "inspector-list" },
        marks.map((item) =>
          markRow("redact", item, "redact", item.term || "Box", {
            removable: true,
          })
        )
      )
    );
    fragment.append(
      h(
        "button",
        {
          class: "btn btn-quiet btn-sm btn-block",
          type: "button",
          style: "margin-top:8px",
          onclick: () => {
            if (!state.redactions.length) return;
            pushHistory();
            state.redactions = [];
            state.selection = null;
            afterChange();
          },
        },
        "Clear all marks"
      )
    );
  }
  fragment.append(
    inspectorNote(
      "Redaction is permanent: affected pages are rasterised, so the text underneath is gone. Work on a copy.",
      "warning"
    )
  );
  return fragment;
}

function redactionInspector(item) {
  const fragment = document.createDocumentFragment();
  fragment.append(inspectorTitle("redact", "Redaction", `PAGE ${item.page}`));
  fragment.append(
    inspectorCard(
      item.term || "Box",
      "This area will be blacked out and the page rasterised on export.",
      actionRow(
        h(
          "button",
          { class: "btn btn-quiet btn-sm", type: "button", onclick: duplicateSelection },
          h("span", { html: icon("duplicate", 14) }),
          "Duplicate"
        ),
        h(
          "button",
          { class: "btn btn-danger btn-sm", type: "button", onclick: deleteSelection },
          h("span", { html: icon("trash", 14) }),
          "Delete"
        )
      )
    )
  );
  return fragment;
}

function cropInspector() {
  if (state.selection?.kind === "crop") {
    const item = selectionItem();
    if (item) {
      const fragment = document.createDocumentFragment();
      fragment.append(inspectorTitle("crop", "Crop", `PAGE ${item.page}`));
      fragment.append(
        inspectorCard(
          "Keep this area.",
          "The page box is changed without re-rendering text. Everything outside the blue box is hidden.",
          inspectorNote(
            `Page ${item.page} · ${Math.round(item.x * 100)}% / ${Math.round(
              item.y * 100
            )}% · ${Math.round(item.w * 100)}×${Math.round(item.h * 100)}%`,
            "crop"
          ),
          actionRow(
            h(
              "button",
              {
                class: "btn btn-primary btn-sm",
                type: "button",
                onclick: () => copyCropToAll(item),
              },
              "Use on all pages"
            ),
            h(
              "button",
              { class: "btn btn-danger btn-sm", type: "button", onclick: deleteSelection },
              h("span", { html: icon("trash", 14) }),
              "Delete"
            )
          )
        )
      );
      return fragment;
    }
  }

  const fragment = document.createDocumentFragment();
  fragment.append(inspectorTitle("crop", "Crop", `${state.crops.length} pages`));
  fragment.append(
    inspectorCard(
      "Draw the area to keep.",
      "Choose the crop tool, then drag a box on the page. Each page can have its own crop."
    )
  );
  if (state.crops.length) {
    fragment.append(
      inspectorTitle("layers", "Cropped pages", String(state.crops.length))
    );
    fragment.append(
      h(
        "div",
        { class: "inspector-list" },
        state.crops.map((item) =>
          markRow("crop", item, "crop", `Page ${item.page}`, { removable: true })
        )
      )
    );
    fragment.append(
      h(
        "button",
        {
          class: "btn btn-quiet btn-sm btn-block",
          type: "button",
          style: "margin-top:8px",
          onclick: () => {
            pushHistory();
            state.crops = [];
            state.selection = null;
            afterChange();
          },
        },
        "Clear all crops"
      )
    );
  } else {
    fragment.append(
      inspectorEmpty(
        "No crop yet",
        "Drag a box on the page to choose what remains.",
        "crop"
      )
    );
  }
  return fragment;
}

function copyCropToAll(source) {
  pushHistory();
  state.crops = Array.from({ length: state.pages }, (_, index) => ({
    id: uid(),
    page: index + 1,
    x: source.x,
    y: source.y,
    w: source.w,
    h: source.h,
  }));
  state.selection = null;
  afterChange();
  toast(`Crop applied to ${state.pages} pages`, "success", 2800);
}

function organizeInspector() {
  const fragment = document.createDocumentFragment();
  fragment.append(
    inspectorTitle("arrange", "Arrange", `${state.organize.length} pages`)
  );
  fragment.append(
    inspectorCard(
      "Rebuild the document.",
      "Drag cards to reorder. Rotate, duplicate or delete pages before exporting.",
      actionRow(
        h(
          "button",
          { class: "btn btn-quiet btn-sm", type: "button", onclick: resetOrganize },
          h("span", { html: icon("refresh", 14) }),
          "Reset order"
        ),
        h(
          "button",
          { class: "btn btn-quiet btn-sm", type: "button", onclick: rotateAllPages },
          h("span", { html: icon("rotateCw", 14) }),
          "Rotate all"
        )
      )
    )
  );
  fragment.append(
    inspectorNote(
      "Thumbnails are previews; the export rebuilds every page at full quality.",
      "spark"
    )
  );
  return fragment;
}

/* -------------------------------------------------------------------------- */
/* Signature pad                                                              */
/* -------------------------------------------------------------------------- */

function signaturePad() {
  const wrap = h("div", { class: "sig-pad-wrap" });
  const canvas = h("canvas", { width: 640, height: 264 });
  const hint = h("span", { class: "sig-pad-hint", text: "Sign here" });
  wrap.append(canvas, hint);
  const context = canvas.getContext("2d");
  let drawing = false;

  const position = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
  };
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    drawing = true;
    hint.hidden = true;
    const point = position(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    event.preventDefault();
    const point = position(event);
    context.lineTo(point.x, point.y);
    context.strokeStyle = "#14171b";
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  });
  const stop = () => {
    drawing = false;
  };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  return {
    wrap,
    canvas,
    clear() {
      context.clearRect(0, 0, canvas.width, canvas.height);
      hint.hidden = false;
    },
  };
}

function usePadSignature() {
  if (!state.sigPadCanvas) return;
  const trimmed = trimCanvas(state.sigPadCanvas);
  if (!trimmed) {
    toast("Draw a signature first.", "error");
    return;
  }
  setSignature(trimmed.toDataURL("image/png"));
}

function createTypedSignature(text, style) {
  const value = String(text || "").trim();
  if (!value) {
    toast("Type your name first.", "error");
    return;
  }
  const fonts = {
    script: 'italic 700 96px "Snell Roundhand", "Segoe Script", "Brush Script MT", cursive',
    serif: 'italic 600 92px Georgia, "Times New Roman", serif',
    mono: '500 80px "IBM Plex Mono", ui-monospace, monospace',
  };
  const font = fonts[style] || fonts.script;
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font;
  const width = Math.ceil(measure.measureText(value).width) + 96;
  const height = 208;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(320, width);
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.font = font;
  context.fillStyle = "#14171b";
  context.textBaseline = "middle";
  context.fillText(value, 48, height / 2);
  setSignature(trimCanvas(canvas).toDataURL("image/png"));
}

function setSignature(dataURL) {
  loadImage(dataURL)
    .then((image) => {
      state.signature = {
        dataURL,
        aspect: image.width / Math.max(1, image.height),
      };
      updateSigPreview();
      state.tool = "signature";
      renderRail();
      updateCursor();
      toast("Signature ready. Click the page to place it.", "success", 3200);
    })
    .catch(() => toast("Could not prepare that signature.", "error"));
}

function updateSigPreview() {
  if (state.sigPreviewEl) {
    state.sigPreviewEl.innerHTML = "";
    if (state.signature?.dataURL) {
      state.sigPreviewEl.append(
        h("img", { src: state.signature.dataURL, alt: "Signature preview" })
      );
    } else {
      state.sigPreviewEl.append(h("span", { class: "mono", text: "No signature yet" }));
    }
  }
  if (state.sigPlaceBtn) {
    state.sigPlaceBtn.disabled = !state.signature?.dataURL;
  }
}

function trimCanvas(canvas, padding = 14) {
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const x0 = Math.max(0, minX - padding);
  const y0 = Math.max(0, minY - padding);
  const x1 = Math.min(width, maxX + padding + 1);
  const y1 = Math.min(height, maxY + padding + 1);
  const out = document.createElement("canvas");
  out.width = Math.max(1, x1 - x0);
  out.height = Math.max(1, y1 - y0);
  out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Redaction search                                                           */
/* -------------------------------------------------------------------------- */

function normalizeRemoteBox(raw) {
  const page = Number(raw.Page ?? raw.page);
  const x = Number(raw.X ?? raw.x);
  const y = Number(raw.Y ?? raw.y);
  const w = Number(raw.W ?? raw.w);
  const h = Number(raw.H ?? raw.h);
  if (!Number.isFinite(page) || page < 1 || page > state.pages) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(w > 0) || !(h > 0)) return null;
  const left = clamp(x, 0, 1);
  const top = clamp(y, 0, 1);
  return {
    page,
    x: left,
    y: top,
    w: clamp(w, 0.001, 1 - left),
    h: clamp(h, 0.001, 1 - top),
  };
}

function boxKey(box) {
  return [
    box.page,
    Math.round(box.x * 500),
    Math.round(box.y * 500),
    Math.round(box.w * 500),
    Math.round(box.h * 500),
  ].join(":");
}

async function runRedactSearch(button, status) {
  if (!state.file) return;
  const terms = state.redactTermsText
    .split(/[\n,]+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!terms.length) {
    toast("Enter at least one word or phrase.", "error");
    return;
  }
  button.disabled = true;
  status.textContent = "Searching the text layer…";
  try {
    const data = await analyzeRedact(state.file, terms, state.password);
    const boxes = (data.boxes || [])
      .map(normalizeRemoteBox)
      .filter(Boolean);
    const existing = new Set(state.redactions.map(boxKey));
    const added = [];
    for (const box of boxes) {
      const key = boxKey(box);
      if (existing.has(key)) continue;
      existing.add(key);
      added.push({ ...box, id: uid(), term: terms[0] });
    }
    if (!added.length) {
      state.redactStatus = "No new matches found.";
      status.textContent = state.redactStatus;
      toast("No new matches found. The page may be a scan without a text layer.", "info");
      return;
    }
    pushHistory();
    state.redactions.push(...added);
    state.redactStatus = `${added.length} match${added.length === 1 ? "" : "es"} added.`;
    status.textContent = state.redactStatus;
    state.current = added[0].page;
    state.selection = null;
    renderToolbar();
    afterChange({ overlay: false });
    renderPage();
    toast(
      `${added.length} match${added.length === 1 ? "" : "es"} marked for redaction.`,
      "success"
    );
  } catch (error) {
    status.textContent = error.message || "Search failed.";
    toast(error.message || "Could not search this PDF.", "error");
  } finally {
    button.disabled = false;
  }
}

/* -------------------------------------------------------------------------- */
/* Organize contact sheet                                                     */
/* -------------------------------------------------------------------------- */

function renderOrganize() {
  const slot = $("#studio-organize");
  if (!slot) return;
  showOrganizeView();
  slot.innerHTML = "";

  const head = h(
    "div",
    { class: "organize-head" },
    h(
      "div",
      {},
      h("h2", { text: "Contact sheet" }),
      h("p", {
        text: "Drag pages into order. Rotate, duplicate or delete before rebuilding.",
      })
    ),
    h("span", {
      class: "mono",
      text: `${state.organize.length} page${state.organize.length === 1 ? "" : "s"}`,
    })
  );
  const grid = h("div", { class: "organize-grid" });

  state.organize.forEach((item, index) => {
    const card = h("div", {
      class: "organize-card",
      draggable: "true",
      dataset: { index: String(index) },
    });
    const frame = h("div", { class: "organize-card-frame" });
    const size = state.sizes[item.page - 1];
    if (size?.width && size?.height) {
      frame.style.aspectRatio = `${size.width} / ${size.height}`;
    }
    const cached = state.thumbs.get(item.page);
    const image = h("img", {
      alt: `Page ${item.page}`,
      draggable: "false",
      dataset: { thumbPage: String(item.page) },
    });
    if (cached) image.src = cached;
    else image.hidden = true;
    if (item.rotate) {
      const aspect = size?.width && size?.height ? size.width / size.height : 1 / Math.SQRT2;
      const turned = item.rotate % 180 !== 0;
      const scale = turned ? Math.min(aspect, 1 / aspect) : 1;
      image.style.transform = `rotate(${item.rotate}deg) scale(${scale})`;
    }
    frame.append(image);
    if (!cached) {
      frame.append(
        h(
          "span",
          { class: "thumb-loading" },
          h("span", { class: "spinner", "aria-hidden": "true" }),
          "Rendering…"
        )
      );
    }
    card.append(frame);
    if (item.rotate) {
      card.append(h("span", { class: "organize-rot", text: `${item.rotate}°` }));
    }
    card.append(
      h(
        "div",
        { class: "organize-card-foot" },
        h(
          "span",
          { class: "organize-card-no" },
          h("strong", { text: String(index + 1).padStart(2, "0") }),
          ` · p.${item.page}`
        ),
        h(
          "span",
          { class: "organize-card-actions" },
          organizeAction("rotateCw", "Rotate page", () => rotatePage(index)),
          organizeAction("duplicate", "Duplicate page", () => duplicatePage(index)),
          organizeAction("trash", "Delete page", () => deletePage(index), true)
        )
      )
    );

    card.addEventListener("click", () => {
      state.current = item.page;
    });
    card.addEventListener("dragstart", (event) => {
      state.dragIndex = index;
      card.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
      state.dragIndex = null;
      document
        .querySelectorAll(".organize-card.is-drop-target")
        .forEach((node) => node.classList.remove("is-drop-target"));
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      card.classList.add("is-drop-target");
    });
    card.addEventListener("dragleave", () => {
      card.classList.remove("is-drop-target");
    });
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      card.classList.remove("is-drop-target");
      const from = state.dragIndex;
      state.dragIndex = null;
      if (from != null) moveOrganize(from, index);
    });
    grid.append(card);
  });

  slot.append(head, grid);
  ensureThumbs();
}

function organizeAction(iconName, label, onClick, danger = false) {
  return h("button", {
    type: "button",
    title: label,
    "aria-label": label,
    draggable: "false",
    class: danger ? "is-danger" : "",
    html: icon(iconName, 13),
    onclick: (event) => {
      event.stopPropagation();
      onClick();
    },
  });
}

async function ensureThumbs() {
  if (!state.pdf || state.thumbBusy) return;
  const doc = state.pdf;
  state.thumbBusy = true;
  try {
    const pages = [...new Set(state.organize.map((item) => item.page))];
    for (const pageNumber of pages) {
      if (state.pdf !== doc) return;
      if (state.thumbs.has(pageNumber)) continue;
      try {
        const data = await renderThumb(pageNumber);
        if (state.pdf !== doc) return;
        state.thumbs.set(pageNumber, data);
        updateThumb(pageNumber, data);
      } catch {
        /* a single page may fail; keep going */
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    state.thumbBusy = false;
  }
}

async function renderThumb(pageNumber) {
  const page = await state.pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.6, 190 / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
  }).promise;
  return canvas.toDataURL("image/jpeg", 0.82);
}

function updateThumb(pageNumber, data) {
  document
    .querySelectorAll(`[data-thumb-page="${pageNumber}"]`)
    .forEach((image) => {
      image.src = data;
      image.hidden = false;
      image.closest(".organize-card-frame")?.querySelector(".thumb-loading")?.remove();
    });
}

function rotatePage(index) {
  const item = state.organize[index];
  if (!item) return;
  pushHistory();
  item.rotate = (item.rotate + 90) % 360;
  afterChange({ organize: true });
}

function duplicatePage(index) {
  const item = state.organize[index];
  if (!item) return;
  pushHistory();
  state.organize.splice(index + 1, 0, {
    uid: uid(),
    page: item.page,
    rotate: item.rotate,
  });
  afterChange({ organize: true });
}

function deletePage(index) {
  if (state.organize.length <= 1) {
    toast("Keep at least one page in the document.", "error");
    return;
  }
  pushHistory();
  state.organize.splice(index, 1);
  afterChange({ organize: true });
}

function moveOrganize(from, to) {
  if (from === to || from < 0 || to < 0) return;
  if (from >= state.organize.length || to >= state.organize.length) return;
  pushHistory();
  const [item] = state.organize.splice(from, 1);
  state.organize.splice(to, 0, item);
  afterChange({ organize: true });
}

function rotateAllPages() {
  if (!state.file) return;
  pushHistory();
  state.organize.forEach((item) => {
    item.rotate = (item.rotate + 90) % 360;
  });
  afterChange({ organize: true });
  toast("Every page rotated 90° clockwise.", "success", 2600);
}

function resetOrganize() {
  if (!state.file) return;
  pushHistory();
  state.organize = Array.from({ length: state.pages }, (_, index) => ({
    uid: uid(),
    page: index + 1,
    rotate: 0,
  }));
  afterChange({ organize: true });
  toast("Page order reset.", "success", 2400);
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

function round6(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

function boxOut(box) {
  return {
    page: box.page,
    x: round6(box.x),
    y: round6(box.y),
    w: round6(box.w),
    h: round6(box.h),
  };
}

function serializeElement(item) {
  const base = {
    page: item.page,
    type: item.type,
    x: round6(item.x),
    y: round6(item.y),
    w: round6(item.w),
    h: round6(item.h),
    opacity: round6(clamp(item.opacity ?? 1, 0.05, 1)),
  };
  if (item.type === "text") {
    return {
      ...base,
      text: item.text,
      fontSize: round6(item.fontSize || 18),
      color: item.color || "#14171b",
      bold: Boolean(item.bold),
      align: item.align || "left",
    };
  }
  if (item.type === "rect") {
    return {
      ...base,
      color: item.color || "#2547ff",
      fill: item.filled ? item.fill || "#ffffff" : "",
      lineWidth: round6(item.lineWidth || 2),
    };
  }
  if (item.type === "highlight") {
    return {
      ...base,
      fill: item.fill || "#ffd60a",
      color: item.fill || "#ffd60a",
      lineWidth: 1,
    };
  }
  if (item.type === "ellipse") {
    return {
      ...base,
      color: item.color || "#2547ff",
      lineWidth: round6(item.lineWidth || 2),
    };
  }
  if (item.type === "line" || item.type === "ink") {
    return {
      ...base,
      points: (item.points || []).map(round6),
      color: item.color || "#2547ff",
      lineWidth: round6(item.lineWidth || 2),
    };
  }
  if (item.type === "image" || item.type === "signature") {
    return { ...base, image: item.image };
  }
  return base;
}

function buildExport() {
  const password = state.password ? { password: state.password } : {};
  if (state.mode === "edit") {
    const elements = state.elements.filter(
      (item) => !(item.type === "text" && !String(item.text || "").trim())
    );
    if (!elements.length) {
      throw new Error("Add at least one mark before exporting.");
    }
    return {
      tool: "edit",
      options: { elements: elements.map(serializeElement), ...password },
    };
  }
  if (state.mode === "sign") {
    const placements = state.elements.filter((item) => item.type === "signature");
    if (!placements.length) {
      throw new Error("Place your signature on the page first.");
    }
    return {
      tool: "sign",
      options: {
        signer: state.sigMeta.signer || "PaperLab signer",
        email: state.sigMeta.email || "",
        reason: state.sigMeta.reason || "Approved",
        certificatePage: Boolean(state.sigMeta.certificatePage),
        placements: placements.map((item) => ({
          page: item.page,
          x: round6(item.x),
          y: round6(item.y),
          w: round6(item.w),
          h: round6(item.h),
          image: item.image,
        })),
        ...password,
      },
    };
  }
  if (state.mode === "organize") {
    if (!state.organize.length) throw new Error("There are no pages to export.");
    return {
      tool: "organize",
      options: {
        order: state.organize.map((item) => ({
          page: item.page,
          rotate: item.rotate || 0,
        })),
        ...password,
      },
    };
  }
  if (state.mode === "redact") {
    if (!state.redactions.length) {
      throw new Error("Mark at least one area or find a term to redact.");
    }
    return {
      tool: "redact",
      options: { boxes: state.redactions.map(boxOut), ...password },
    };
  }
  if (state.mode === "crop") {
    if (!state.crops.length) {
      throw new Error("Draw the area you want to keep first.");
    }
    return {
      tool: "crop",
      options: { boxes: state.crops.map(boxOut), ...password },
    };
  }
  throw new Error("Choose a studio mode first.");
}

function exportCurrent() {
  if (!state.file || state.busy) return;
  let spec;
  try {
    spec = buildExport();
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  state.busy = true;
  updateExportButton();

  const drawer = $("#studio-export");
  drawer.hidden = false;
  drawer.innerHTML = "";
  const close = h("button", {
    class: "studio-export-close",
    type: "button",
    "aria-label": "Close export panel",
    html: icon("close", 16),
  });
  const container = h("div");
  drawer.append(close, container);

  const cleanup = () => {
    drawer.hidden = true;
    drawer.innerHTML = "";
    state.busy = false;
    updateExportButton();
  };
  close.addEventListener("click", () => {
    if (state.busy) {
      toast("The export is still running.", "info");
      return;
    }
    cleanup();
  });

  runToolJob({
    container,
    tool: TOOL_MAP[spec.tool],
    files: [state.file],
    options: spec.options,
    onReset: cleanup,
    onComplete: () => {
      state.busy = false;
      state.dirty = false;
      updateExportButton();
      toast("Export ready. Download it below.", "success", 3200);
    },
  }).finally(() => {
    state.busy = false;
    updateExportButton();
  });
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

function hasFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function setupDropTarget(node) {
  node.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    node.classList.add("is-dragging");
  });
  node.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    node.classList.add("is-dragging");
  });
  node.addEventListener("dragleave", (event) => {
    if (node.contains(event.relatedTarget)) return;
    node.classList.remove("is-dragging");
  });
  node.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    node.classList.remove("is-dragging");
    const file = event.dataTransfer.files?.[0];
    if (file) openFile(file);
  });
}

function bindEvents() {
  $("#studio-file-input")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) openFile(file);
  });

  $("#studio-image-input")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const dataURL = await imageToPNG(file);
      if (state.replaceImageId) {
        const item = findItem("element", state.replaceImageId);
        state.replaceImageId = null;
        if (item) {
          pushHistory();
          item.image = dataURL;
          afterChange();
          toast("Image replaced.", "success", 2400);
          return;
        }
      }
      if (!state.file) {
        toast("Open a PDF first.", "error");
        return;
      }
      await addImageElement(dataURL);
      toast("Image placed. Drag it into position.", "success", 2600);
    } catch (error) {
      toast(error.message || "Could not read that image.", "error");
    }
  });

  const overlay = $("#studio-overlay");
  overlay?.addEventListener("pointerdown", onOverlayPointerDown);
  overlay?.addEventListener("pointermove", onOverlayPointerMove);
  overlay?.addEventListener("pointerup", onOverlayPointerUp);
  overlay?.addEventListener("pointercancel", () => {
    state.drag = null;
    clearPreview();
  });
  overlay?.addEventListener("dblclick", (event) => {
    const node = event.target.closest?.(".el-text");
    if (!node) return;
    select(node.dataset.kind, node.dataset.id);
    setTimeout(() => $("#inspector-text")?.focus(), 30);
  });

  const stage = $("#studio-stage");
  if (stage) setupDropTarget(stage);

  $("#studio-scroll")?.addEventListener(
    "wheel",
    (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (!state.file || state.mode === "organize") return;
      event.preventDefault();
      setZoom(state.zoom * (event.deltaY > 0 ? 0.92 : 1.08));
    },
    { passive: false }
  );

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.file && state.mode !== "organize") renderPage();
    }, 180);
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const tag = target?.tagName?.toLowerCase();
    const typing =
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      target?.isContentEditable;
    const modifier = event.metaKey || event.ctrlKey;

    if (modifier && event.key.toLowerCase() === "s") {
      event.preventDefault();
      exportCurrent();
      return;
    }
    if (modifier && event.key.toLowerCase() === "z" && !typing) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "y" && !typing) {
      event.preventDefault();
      redo();
      return;
    }
    if (typing) return;

    if ((event.key === "Delete" || event.key === "Backspace") && state.selection) {
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (event.key === "Escape") {
      state.drag = null;
      clearPreview();
      state.selection = null;
      state.tool = defaultTool(state.mode);
      renderRail();
      renderOverlay();
      renderInspector();
      updateCursor();
      return;
    }
    if (event.key === "PageDown" || (event.altKey && event.key === "ArrowRight")) {
      event.preventDefault();
      goPage(state.current + 1);
      return;
    }
    if (event.key === "PageUp" || (event.altKey && event.key === "ArrowLeft")) {
      event.preventDefault();
      goPage(state.current - 1);
      return;
    }
    if (
      state.selection &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      const step = event.shiftKey ? 0.01 : 0.002;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      nudgeSelection(dx, dy);
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty || !state.file) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function uid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read that image."));
    image.src = source;
  });
}

async function imageToPNG(file, { trim = false } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const max = 1400;
    const scale = Math.min(1, max / Math.max(1, image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = trim ? trimCanvas(canvas) : canvas;
    if (!result) throw new Error("That image is empty.");
    return result.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function restoreHandoff(id) {
  if (!id) return;
  try {
    const record = await takeHandoff(id);
    if (record?.files?.length) await openFile(record.files[0]);
  } catch {
    /* hand-off is best-effort */
  }
}

init();
