/*
 * PaperLab Chat with PDF.
 *
 * One document, one grounded conversation. The file is only uploaded to the
 * configured PaperLab API when a question is sent; the browser keeps the
 * transcript and page citations.
 */

import { initLayout } from "./layout.js";
import { icon } from "./icons.js";
import {
  $,
  h,
  formatBytes,
  toast,
  createDropzone,
  openModal,
} from "./ui.js";
import { inspectPDF, chatWithPDF } from "./api.js";
import { handoffFromQuery } from "./file-store.js";

initLayout({ active: "chat", title: "Chat with PDF" });

const SUGGESTIONS = [
  "What are the main findings?",
  "Summarise this document in five bullets.",
  "What actions are assigned, and to whom?",
  "Which dates, amounts or deadlines appear?",
  "What does the document say about privacy?",
];

const state = {
  file: null,
  info: null,
  password: "",
  messages: [],
  busy: false,
  loading: false,
  engine: "",
  lastQuestion: "",
};

const els = {
  side: $("#chat-side"),
  head: $("#chat-head"),
  log: $("#chat-log"),
  form: $("#chat-form"),
  input: $("#chat-input"),
  send: $("#chat-send"),
  status: $("#chat-status"),
  fileInput: $("#chat-file-input"),
};

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

function pageLabel() {
  const pages = state.info?.pages || 0;
  if (!pages) return "PDF";
  return `${pages} page${pages === 1 ? "" : "s"}`;
}

function renderSide() {
  if (!els.side) return;
  els.side.innerHTML = "";

  if (!state.file) {
    els.side.append(
      h(
        "div",
        { class: "chat-side-card" },
        h("h3", {}, "Document"),
        h("p", {
          class: "field-help",
          style: "margin-bottom:10px",
          text: "Open a PDF to start. Nothing is uploaded until you ask a question.",
        }),
        h(
          "button",
          {
            class: "btn btn-primary btn-sm btn-block",
            type: "button",
            onclick: () => els.fileInput?.click(),
          },
          h("span", { html: icon("upload", 14) }),
          "Open a PDF"
        )
      )
    );
    els.side.append(
      h(
        "div",
        { class: "chat-side-card" },
        h("h3", {}, "Good to know"),
        h("p", {
          class: "field-help",
          text: "Answers are grounded in the document. Without an AI provider configured, PaperLab uses local retrieval and quotes the relevant passages.",
        })
      )
    );
    return;
  }

  const info = state.info || {};
  const meta = [];
  if (info.fileSize || state.file.size) meta.push(formatBytes(info.fileSize || state.file.size));
  meta.push(pageLabel());
  meta.push(info.textLayer ? "Text layer" : "No text layer");

  const docCard = h(
    "div",
    { class: "chat-doc-card" },
    h(
      "div",
      { class: "chat-doc-file" },
      h("span", { html: icon("file", 19) }),
      h(
        "div",
        { style: "min-width:0" },
        h("strong", { text: state.file.name, title: state.file.name }),
        h("span", { text: meta.join(" · ") })
      )
    ),
    h(
      "div",
      { class: "chat-doc-meta" },
      h("span", { text: "READY" }),
      h("span", { text: state.engine ? state.engine.toUpperCase() : "LOCAL RETRIEVAL" })
    ),
    h(
      "div",
      { style: "display:flex;gap:6px;margin-top:12px" },
      h(
        "button",
        {
          class: "btn btn-quiet btn-sm",
          type: "button",
          style: "flex:1",
          onclick: () => els.fileInput?.click(),
        },
        h("span", { html: icon("refresh", 14) }),
        "Replace"
      ),
      h(
        "button",
        {
          class: "btn btn-ghost btn-sm",
          type: "button",
          onclick: resetConversation,
          title: "Clear the conversation",
        },
        h("span", { html: icon("trash", 14) }),
        "New chat"
      )
    )
  );
  els.side.append(docCard);

  const suggestions = h("div", { class: "chat-suggestions" });
  for (const question of SUGGESTIONS) {
    suggestions.append(
      h("button", {
        class: "chat-suggestion",
        type: "button",
        text: question,
        onclick: () => {
          if (state.busy) return;
          els.input.value = question;
          resizeInput();
          sendQuestion();
        },
      })
    );
  }
  els.side.append(
    h(
      "div",
      { class: "chat-side-card" },
      h("h3", {}, "Try asking"),
      suggestions
    )
  );

  if (!info.textLayer) {
    els.side.append(
      h(
        "div",
        { class: "chat-side-card" },
        h("h3", {}, "Scanned document?"),
        h("p", {
          class: "field-help",
          text: "This PDF has no text layer. Run OCR first so the document can be searched and quoted.",
        }),
        h(
          "a",
          { class: "btn btn-quiet btn-sm btn-block", href: "tool.html?tool=ocr" },
          h("span", { html: icon("ocr", 14) }),
          "Open OCR"
        )
      )
    );
  }
}

function renderHead() {
  if (!els.head) return;
  els.head.innerHTML = "";
  els.head.append(
    h("span", { class: "chat-welcome-mark", html: icon("chat", 17) }),
    h(
      "div",
      { class: "chat-head-copy" },
      h("span", { class: "mono", text: "Grounded conversation" }),
      h("strong", { text: state.file ? "Ask this document" : "Ask a document" })
    ),
    h(
      "span",
      { class: `badge ${state.engine ? "is-ok" : ""}` },
      h("span", { class: "dot dot-blue" }),
      state.engine ? state.engine : "Page citations"
    )
  );
}

function assistantAvatar() {
  return h("span", { class: "chat-avatar", text: "PL" });
}

function messageNode(message) {
  const user = message.role === "user";
  const bubble = h("div", { class: "chat-bubble", text: message.content });
  if (!user && message.sources?.length) {
    const sources = h("div", { class: "chat-sources" });
    for (const source of message.sources) {
      sources.append(h("span", { class: "chat-source", text: source }));
    }
    bubble.append(sources);
  }
  if (!user && message.engine) {
    bubble.append(
      h("div", { class: "chat-meta", text: `${message.engine.toUpperCase()} · ANSWERED FROM THIS DOCUMENT` })
    );
  }
  return h(
    "div",
    { class: `chat-message ${user ? "is-user" : "is-assistant"}` },
    user ? h("span", { class: "chat-avatar", text: "YOU" }) : assistantAvatar(),
    bubble
  );
}

function welcomeNode() {
  return h(
    "div",
    { class: "chat-welcome" },
    h("span", { class: "chat-welcome-mark", html: icon("chat", 26) }),
    h("h2", { text: "The document is listening." }),
    h("p", {
      text: "Ask a direct question and PaperLab will answer from the pages, quoting the passages it used. Follow-ups keep the context.",
    })
  );
}

function renderLog() {
  if (!els.log) return;
  els.log.innerHTML = "";

  if (!state.file) {
    const drop = h("div", { class: "chat-drop" });
    els.log.append(h("div", { class: "chat-empty-shell" }, drop));
    createDropzone(drop, {
      accept: ".pdf,application/pdf",
      multiple: false,
      title: "Drop a PDF to start a conversation",
      hint: "or click to browse · answers stay grounded in the document",
      onChange(files) {
        if (files[0]) openFile(files[0]);
      },
    });
    return;
  }

  if (!state.messages.length && !state.busy) {
    els.log.append(welcomeNode());
  } else {
    for (const message of state.messages) els.log.append(messageNode(message));
    if (state.busy) {
      els.log.append(
        h(
          "div",
          { class: "chat-message is-assistant" },
          assistantAvatar(),
          h("div", { class: "chat-bubble" }, h("span", { class: "chat-typing" }, h("i"), h("i"), h("i")))
        )
      );
    }
  }
  requestAnimationFrame(() => {
    els.log.scrollTop = els.log.scrollHeight;
  });
}

function updateComposer() {
  const ready = Boolean(state.file) && !state.loading;
  if (els.input) {
    els.input.disabled = !ready;
    els.input.placeholder = state.file
      ? "Ask a question about this document…"
      : "Open a PDF, then ask a question…";
  }
  if (els.send) els.send.disabled = !ready || state.busy || !els.input?.value.trim();
  if (els.status) {
    if (state.loading) els.status.textContent = "Reading the document…";
    else if (!state.file) els.status.textContent = "No document open";
    else if (state.busy) els.status.textContent = "Reading the pages and composing an answer…";
    else els.status.textContent = `${pageLabel()} · ${state.info?.textLayer ? "text layer ready" : "no text layer"}`;
  }
}

function render() {
  renderSide();
  renderHead();
  renderLog();
  updateComposer();
}

/* -------------------------------------------------------------------------- */
/* File handling                                                              */
/* -------------------------------------------------------------------------- */

function isPDF(file) {
  return /\.pdf$/i.test(file?.name || "") || file?.type === "application/pdf";
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
          : "This PDF is encrypted. Enter its password to read it in the chat.",
      }),
      input
    ),
    actions: [
      {
        label: "Cancel",
        onClick: () => {
          state.loading = false;
          updateComposer();
        },
      },
      {
        label: "Open PDF",
        variant: "btn-primary",
        onClick: () => {
          const password = input.value;
          if (!password) return false;
          state.loading = true;
          setTimeout(() => openFile(file, { password, keepPassword: true }), 0);
        },
      },
    ],
  });
  setTimeout(() => input.focus(), 60);
}

async function openFile(file, { password = "", keepPassword = false } = {}) {
  if (!file) return;
  if (!isPDF(file)) {
    toast("Chat with PDF only opens PDF files.", "error");
    return;
  }
  if (!keepPassword) state.password = password;
  state.loading = true;
  updateComposer();
  try {
    const info = await inspectPDF(file, password);
    state.file = file;
    state.info = info;
    state.password = password;
    state.messages = [];
    state.engine = "";
    state.lastQuestion = "";
    state.loading = false;
    render();
    els.input?.focus();
    toast(`${file.name} opened. Ask anything about it.`, "success", 2800);
  } catch (error) {
    state.loading = false;
    updateComposer();
    const message = error?.message || "Could not open that PDF.";
    if (/password|encrypt|decrypt/i.test(message) && !password) {
      promptPassword(file);
      return;
    }
    toast(message, "error");
  }
}

function resetConversation() {
  if (!state.file) return;
  state.messages = [];
  state.engine = "";
  render();
  toast("Conversation cleared. The document is still open.", "info", 2200);
}

/* -------------------------------------------------------------------------- */
/* Asking                                                                     */
/* -------------------------------------------------------------------------- */

function resizeInput() {
  if (!els.input) return;
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(160, els.input.scrollHeight)}px`;
  updateComposer();
}

async function sendQuestion() {
  if (!state.file || state.busy || state.loading) return;
  const question = els.input?.value.trim();
  if (!question) return;

  const history = state.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }));

  state.messages.push({ role: "user", content: question });
  state.lastQuestion = question;
  state.busy = true;
  els.input.value = "";
  resizeInput();
  renderLog();
  updateComposer();

  try {
    const data = await chatWithPDF(state.file, question, history, state.password);
    state.messages.push({
      role: "assistant",
      content: data.answer || "I could not find an answer in this document.",
      sources: Array.isArray(data.sources) ? data.sources : [],
      engine: data.engine || "local retrieval",
    });
    state.engine = data.engine || "local retrieval";
  } catch (error) {
    const message = error?.message || "The document could not be read.";
    state.messages.push({
      role: "assistant",
      content: message,
      error: true,
      engine: "error",
    });
    toast(message, "error");
  } finally {
    state.busy = false;
    render();
    els.input?.focus();
  }
}

/* -------------------------------------------------------------------------- */
/* Events and boot                                                            */
/* -------------------------------------------------------------------------- */

els.form?.addEventListener("submit", (event) => {
  event.preventDefault();
  sendQuestion();
});

els.input?.addEventListener("input", resizeInput);
els.input?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendQuestion();
  }
});

els.fileInput?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (file) openFile(file);
});

async function restoreHandoff() {
  const handoff = await handoffFromQuery();
  if (handoff?.files?.[0]) openFile(handoff.files[0]);
}

render();
restoreHandoff();
