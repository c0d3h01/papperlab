import { initLayout } from "./layout.js";
import { icon } from "./icons.js";
import {
  $,
  h,
  createDropzone,
  toast,
  formatBytes,
  fileExt,
} from "./ui.js";
import {
  TOOLS,
  TOOL_MAP,
  GROUP_MAP,
  GROUPS,
  POPULAR_TOOLS,
  toolsByGroup,
  toolsForExtension,
  toolHref,
} from "./tools-data.js";
import { toolCard, toolLine, groupMark } from "./cards.js";
import { saveHandoff } from "./file-store.js";
import { config, tools as fetchTools, API_BASE } from "./api.js";

initLayout({ active: "" });

const HOME_PICKS = [
  "merge",
  "split",
  "compress",
  "pdf-to-word",
  "jpg-to-pdf",
  "edit",
  "sign",
  "redact",
];

let toolInfo = {};
let configData = null;

function handoffAndGo(tool, files, extra = {}) {
  if (!files.length) return;
  saveHandoff(files, { tool: tool?.id || "", source: "home" })
    .then((id) => {
      if (tool?.studio) {
        location.href = `studio.html?tool=${encodeURIComponent(tool.studio)}&handoff=${id}`;
      } else if (tool) {
        location.href = toolHref(tool.id, { handoff: id });
      } else {
        location.href = `studio.html?handoff=${id}`;
      }
    })
    .catch((error) => {
      toast(error.message || "Could not hand the files to the next page. Try again.", "error");
    });
}

function suggestionChip(tool, files, { studio = false, reason = "" } = {}) {
  const group = GROUP_MAP[tool?.group];
  return h(
    "button",
    {
      class: `suggestion ${studio ? "suggestion-studio" : ""}`,
      type: "button",
      "data-accent": group?.accent,
      title: reason || tool?.tagline || "",
      onclick: () => handoffAndGo(studio ? null : tool, files),
    },
    h("span", { class: "suggestion-icon", html: icon(studio ? "studio" : tool.icon, 18) }),
    h("span", { class: "suggestion-copy" },
      h("strong", { text: studio ? "Open in Studio" : tool.name }),
      h("span", { text: studio ? "Edit, sign or rearrange visually" : tool.tagline })
    ),
    h("span", { class: "suggestion-arrow", html: icon("arrow", 14) })
  );
}

function buildSuggestions(container, files) {
  container.innerHTML = "";
  if (!files.length) {
    container.append(
      h("span", { class: "suggestions-label mono", text: "Popular right now" }),
      h(
        "div",
        { class: "suggestion-grid" },
        POPULAR_TOOLS.slice(0, 6).map((tool) => suggestionChip(tool, []))
      )
    );
    // Empty-state chips need a file, so make them jump to the tool instead.
    container.querySelectorAll(".suggestion").forEach((chip, index) => {
      const tool = POPULAR_TOOLS[index];
      chip.onclick = () => {
        location.href = toolHref(tool.id);
      };
    });
    return;
  }

  const pdfs = files.filter((f) => fileExt(f.name) === "pdf");
  const suggestions = [];
  const seen = new Set();
  for (const file of files) {
    for (const tool of toolsForExtension(fileExt(file.name))) {
      if (seen.has(tool.id)) continue;
      if (tool.id === "compare" && files.length < 2) continue;
      if (tool.id === "merge" && pdfs.length < 2) continue;
      if (tool.minFiles > files.length && tool.id !== "merge" && tool.id !== "compare") continue;
      seen.add(tool.id);
      suggestions.push(tool);
    }
  }
  const ordered = suggestions
    .sort((a, b) => Number(Boolean(b.popular)) - Number(Boolean(a.popular)))
    .slice(0, 6);

  if (pdfs.length) {
    container.append(h("span", { class: "suggestions-label mono", text: "With these files you can" }));
    const grid = h("div", { class: "suggestion-grid" });
    grid.append(suggestionChip(null, files, { studio: true }));
    ordered.forEach((tool) => grid.append(suggestionChip(tool, files)));
    container.append(grid);
  } else if (ordered.length) {
    container.append(h("span", { class: "suggestions-label mono", text: "Suggested for these files" }));
    const grid = h("div", { class: "suggestion-grid" });
    ordered.forEach((tool) => grid.append(suggestionChip(tool, files)));
    container.append(grid);
  } else {
    container.append(
      h("div", { class: "quick-note" },
        h("span", { html: icon("warning", 16) }),
        h("p", {}, h("strong", { text: "No matching tool yet." }), " Open the toolbox to see all 41 tools, or try a PDF.")
      )
    );
  }
  if (files.length > 1) {
    container.append(
      h("p", { class: "quick-total mono", text: `${files.length} files · ${formatBytes(files.reduce((n, f) => n + f.size, 0))}` })
    );
  }
}

function renderPopular() {
  const grid = $("#popular-grid");
  if (!grid) return;
  grid.innerHTML = "";
  HOME_PICKS.forEach((id, index) => {
    const tool = TOOL_MAP[id];
    if (!tool) return;
    grid.append(toolCard(tool, { index: index + 1, info: toolInfo[id] }));
  });
}

function renderGroups() {
  const list = $("#groups-list");
  if (!list) return;
  list.innerHTML = "";
  GROUPS.forEach((group) => {
    const tools = toolsByGroup(group.id);
    const row = h(
      "div",
      { class: "group-row", "data-accent": group.accent },
      groupMark(group, tools.length),
      h(
        "div",
        { class: "group-tools" },
        tools.map((tool) => toolLine(tool, { info: toolInfo[tool.id] }))
      ),
      h(
        "a",
        { class: "group-open", href: `tools.html?group=${group.id}` },
        h("span", { class: "mono micro", text: "VIEW GROUP" }),
        h("span", { html: icon("arrow", 16) })
      )
    );
    list.append(row);
  });
}

function engineRow(name, desc, online, note = "") {
  return h(
    "div",
    { class: "status-row" },
    h("span", { class: `status-dot ${online ? "is-on" : "is-off"}` }),
    h("span", { class: "status-name", text: name }),
    h("span", { class: "status-desc", text: desc }),
    h("span", { class: `status-state mono ${online ? "is-on" : "is-off"}`, text: online ? "ONLINE" : note || "OFF" })
  );
}

async function renderStatus() {
  const board = $("#status-board");
  if (!board) return;
  const [configResult, toolsResult] = await Promise.allSettled([config(), fetchTools()]);
  configData = configResult.status === "fulfilled" ? configResult.value : null;
  if (toolsResult.status === "fulfilled") {
    for (const info of toolsResult.value.tools || []) toolInfo[info.id] = info;
  }

  board.innerHTML = "";
  board.append(
    h(
      "div",
      { class: "status-board-head" },
      h("span", { class: "mono micro", text: "LIVE INVENTORY" }),
      h("span", { class: `status-pulse ${configData ? "is-live" : "is-off"}` })
    )
  );

  if (!configData) {
    board.append(
      h(
        "div",
        { class: "status-offline" },
        h("span", { html: icon("warning", 22) }),
        h("strong", { text: "API not reachable" }),
        h("p", { text: `The front end could not reach ${API_BASE || "this origin"}. If you are running the static site separately, set the API origin in assets/js/config.js.` }),
        h("a", { class: "text-link", href: "tools.html" }, "Browse the catalog anyway", h("span", { html: icon("arrow", 14) }))
      )
    );
    renderPopular();
    renderGroups();
    return;
  }

  const engines = configData.engines || {};
  const total = (toolsResult.status === "fulfilled" ? toolsResult.value.tools : TOOLS).length;
  const available = Object.values(toolInfo).filter((t) => t.available).length || total;
  const rows = h("div", { class: "status-rows" });
  rows.append(
    engineRow("pdfcpu", "Document structure, pages, stamps", true),
    engineRow("Poppler", "Text, rendering, page images", engines.poppler),
    engineRow("Ghostscript", "Compression, PDF/A, repair", engines.ghostscript),
    engineRow("qpdf", "Encryption, repair, unlocking", engines.qpdf),
    engineRow("Tesseract", "Optical character recognition", engines.tesseract, "OFF"),
    engineRow("Chrome", "HTML and web-page rendering", engines.chrome, "OFF"),
    engineRow("LibreOffice", "High-fidelity Office conversion", engines.libreoffice, "NATIVE"),
    engineRow("AI provider", "Summaries, answers, translation", configData.ai, "LOCAL"),
    engineRow("Translation", "LibreTranslate or AI", configData.translate, "OFF")
  );
  board.append(
    h(
      "div",
      { class: "status-summary" },
      h("strong", { text: `${available} of ${total}` }),
      h("span", { text: "tools ready on this server" })
    ),
    rows,
    h(
      "p",
      { class: "status-note" },
      h("span", { html: icon("clock", 14) }),
      ` Jobs expire after ${configData.jobTTLMinutes || 120} minutes. Max upload ${configData.maxUploadMB || 250} MB.`
    )
  );
  renderPopular();
  renderGroups();
}

/* -------------------------------------------------------------------------- */
/* Quick drop                                                                  */

function setupQuickDrop() {
  const slot = $("#quick-drop");
  const suggestions = $("#quick-suggestions");
  if (!slot) return;
  let currentFiles = [];
  const drop = createDropzone(slot, {
    accept: "",
    multiple: true,
    maxFiles: 20,
    title: "Drop files here",
    hint: "or click to browse · PDF, Word, slides, images, HTML",
    onChange(files) {
      currentFiles = files;
      buildSuggestions(suggestions, files);
    },
  });
  buildSuggestions(suggestions, []);

  // Support a file drop anywhere on the board.
  const board = slot.closest(".hero-board");
  if (board) {
    ["dragenter", "dragover"].forEach((type) =>
      board.addEventListener(type, (event) => {
        if (!event.dataTransfer?.types?.includes("Files")) return;
        event.preventDefault();
        board.classList.add("is-dragging");
      })
    );
    ["dragleave", "drop"].forEach((type) =>
      board.addEventListener(type, (event) => {
        event.preventDefault();
        board.classList.remove("is-dragging");
      })
    );
    board.addEventListener("drop", (event) => {
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) drop.setFiles(files);
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Reveal                                                                      */

function setupReveal() {
  if (!("IntersectionObserver" in window)) return;
  const targets = document.querySelectorAll(
    ".section-head, .tool-card, .group-row, .step, .privacy-copy, .studio-callout-copy, .studio-mock, .status-copy, .status-board, .api-copy, .api-terminal"
  );
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
  targets.forEach((target, index) => {
    target.classList.add("reveal");
    target.style.setProperty("--reveal-delay", `${Math.min(index % 6, 5) * 60}ms`);
    observer.observe(target);
  });
}

renderPopular();
renderGroups();
setupQuickDrop();
renderStatus().finally(setupReveal);
