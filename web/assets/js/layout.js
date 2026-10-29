import { icon } from "./icons.js";
import { $, h, initTheme, applyTheme, currentTheme, hydrateIcons } from "./ui.js";
import { health, API_BASE } from "./api.js";
import { mountAccountButton } from "./account.js";

const NAV = [
  { href: "tools.html", label: "Tools", key: "tools" },
  { href: "studio.html", label: "Studio", key: "studio" },
  { href: "chat.html", label: "Chat", key: "chat" },
  { href: "index.html#how", label: "How it works", key: "how" },
];

const ENGINE_ROWS = [
  ["poppler", "Poppler"],
  ["ghostscript", "Ghostscript"],
  ["qpdf", "qpdf"],
  ["tesseract", "Tesseract"],
  ["chrome", "Chrome"],
  ["libreoffice", "LibreOffice"],
];
const CORE_ENGINES = ENGINE_ROWS.slice(0, 3);

function buildEngineStatus() {
  const bars = h("span", { class: "engine-bars", "aria-hidden": "true" });
  for (const [key] of CORE_ENGINES) {
    bars.append(h("span", { class: "engine-bar", "data-engine": key }));
  }

  const list = h("ul", { class: "engine-list" });
  for (const [key, label] of ENGINE_ROWS) {
    list.append(
      h(
        "li",
        { class: "engine-row", "data-engine": key },
        h("span", { class: "engine-row-dot", "aria-hidden": "true" }),
        h("span", { class: "engine-row-name", text: label }),
        h("span", { class: "engine-row-state", text: "—" })
      )
    );
  }

  const card = h(
    "div",
    { class: "engine-card" },
    h(
      "div",
      { class: "engine-card-head" },
      h("span", { class: "engine-card-title", text: "Processing engines" }),
      h("span", { class: "engine-version mono", text: "API" })
    ),
    list,
    h(
      "a",
      { class: "engine-card-link", href: "index.html#status" },
      "API health",
      h("span", { html: icon("arrow", 12) })
    )
  );

  return h(
    "div",
    {
      class: "engine-status",
      "data-engine-status": "",
      tabindex: "0",
      title: "Checking the processing API",
      "aria-label": "Checking the processing API",
    },
    bars,
    h("span", { class: "engine-label", text: "Checking" }),
    card
  );
}

function brandMark(size = 30) {
  return `<svg class="brand-mark-svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M3 11V3h8M21 3h8v8M29 21v8h-8M11 29H3v-8" stroke="currentColor" stroke-width="1.6"/>
    <rect x="9" y="9" width="14" height="14" fill="currentColor"/>
    <path d="M12 22V10h5.2a4 4 0 0 1 0 8H12" stroke="var(--paper)" stroke-width="2"/>
  </svg>`;
}

export function brand() {
  return h(
    "a",
    { class: "brand", href: "index.html", "aria-label": "PaperLab home" },
    h("span", { class: "brand-mark", html: brandMark(30) }),
    h(
      "span",
      { class: "brand-type" },
      h("span", { class: "brand-word", text: "PaperLab" }),
      h("span", { class: "brand-sub", text: "PDF workshop" })
    )
  );
}

function buildHeader(active) {
  const header = h("header", { class: "site-header" });
  const inner = h("div", { class: "header-inner" });
  inner.append(brand());

  const nav = h("nav", { class: "primary-nav", "aria-label": "Primary" });
  for (const item of NAV) {
    nav.append(
      h(
        "a",
        {
          href: item.href,
          class: `nav-link ${active === item.key ? "is-active" : ""}`,
          "aria-current": active === item.key ? "page" : null,
        },
        item.label
      )
    );
  }
  inner.append(nav);

  const status = buildEngineStatus();

  const accountSlot = h("span", { class: "account-slot" });
  const actions = h(
    "div",
    { class: "header-actions" },
    status,
    h("button", {
      class: "icon-button theme-toggle",
      type: "button",
      "data-theme-toggle": "",
      "aria-label": "Switch theme",
      html: icon(currentTheme() === "dark" ? "sun" : "moon", 18),
    }),
    accountSlot,
    h("button", {
      class: "icon-button nav-toggle",
      type: "button",
      "aria-label": "Open menu",
      "aria-expanded": "false",
      html: icon("menu", 20),
    })
  );
  inner.append(actions);
  mountAccountButton(accountSlot);
  header.append(inner);

  const mobile = h("div", { class: "mobile-nav", hidden: true });
  const mobileInner = h("div", { class: "mobile-nav-inner" });
  for (const item of NAV) {
    mobileInner.append(h("a", { href: item.href, class: "mobile-nav-link" }, item.label, h("span", { html: icon("chevron", 16) })));
  }
  mobileInner.append(
    h("div", { class: "mobile-nav-foot" },
      h("a", { class: "btn btn-primary btn-block", href: "tools.html" }, "Browse all 41 tools"),
      h("p", { class: "micro", text: "Files are processed on the server you configure and expire automatically." })
    )
  );
  mobile.append(mobileInner);
  header.append(mobile);

  const toggle = actions.querySelector(".nav-toggle");
  toggle.addEventListener("click", () => {
    const open = mobile.hidden;
    mobile.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.innerHTML = icon(open ? "close" : "menu", 20);
    document.body.classList.toggle("nav-open", open);
  });
  mobile.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      mobile.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.innerHTML = icon("menu", 20);
      document.body.classList.remove("nav-open");
    }
  });
  return header;
}

function buildFooter() {
  const footer = h("footer", { class: "site-footer" });
  const top = h("div", { class: "footer-top" });
  const statement = h(
    "div",
    { class: "footer-statement" },
    h("div", { class: "footer-brand" }, brand()),
    h("p", { class: "footer-lede", text: "A calm, complete workshop for the documents that matter. No dark patterns, no watermarks on your work." }),
    h(
      "div",
      { class: "footer-badges" },
      h("span", { class: "badge-mono" }, h("span", { class: "dot dot-blue" }), "LOCAL-FIRST"),
      h("span", { class: "badge-mono" }, h("span", { class: "dot dot-yellow" }), "41 TOOLS"),
      h("span", { class: "badge-mono" }, h("span", { class: "dot dot-magenta" }), "OPTIONAL CLOUD")
    )
  );
  const columns = h("div", { class: "footer-columns" });
  const cols = [
    {
      title: "Popular tools",
      links: [
        ["Merge PDF", "tool.html?tool=merge"],
        ["Split PDF", "tool.html?tool=split"],
        ["Compress PDF", "tool.html?tool=compress"],
        ["Edit PDF", "tool.html?tool=edit"],
        ["Sign PDF", "tool.html?tool=sign"],
        ["PDF to Word", "tool.html?tool=pdf-to-word"],
      ],
    },
    {
      title: "Workshop",
      links: [
        ["All tools", "tools.html"],
        ["Studio", "studio.html"],
        ["Chat with PDF", "chat.html"],
        ["How it works", "index.html#how"],
        ["Privacy", "privacy.html"],
        ["API health", "index.html#status"],
      ],
    },
    {
      title: "Good to know",
      links: [
        ["Files expire after 2 hours", "index.html#privacy"],
        ["Cloud connections", "privacy.html"],
        ["Open API", "index.html#api"],
        ["Deploy your own", "index.html#api"],
        ["Sponsor on GitHub", "https://github.com/sponsors/c0d3h01"],
      ],
    },
  ];
  for (const col of cols) {
    const node = h("div", { class: "footer-col" }, h("h3", { class: "footer-col-title", text: col.title }));
    for (const [label, href] of col.links) {
      const external = /^https?:/i.test(href);
      node.append(
        h("a", {
          href,
          text: label,
          target: external ? "_blank" : null,
          rel: external ? "noopener" : null,
        })
      );
    }
    columns.append(node);
  }
  top.append(statement, columns);
  footer.append(top);

  const bottom = h("div", { class: "footer-bottom" });
  bottom.append(
    h("p", { class: "footer-fine", text: `© ${new Date().getFullYear()} PaperLab. An independent PDF workshop.` }),
    h("p", { class: "footer-fine footer-disclaimer", text: "Not affiliated with iLovePDF or any other PDF brand. Built with Go, pdfcpu, Poppler and Ghostscript." }),
    h("a", { class: "footer-top-link", href: "#top" }, "Back to top", h("span", { html: icon("arrow", 14) }))
  );
  footer.append(bottom);
  return footer;
}

async function updateEngineStatus() {
  const nodes = document.querySelectorAll("[data-engine-status]");
  if (!nodes.length) return;
  const set = (tone, label, title) => {
    nodes.forEach((node) => {
      node.dataset.tone = tone;
      node.title = title || label;
      node.setAttribute("aria-label", title || label);
      const text = node.querySelector(".engine-label");
      if (text) text.textContent = label;
    });
  };
  const paint = (engines, version) => {
    nodes.forEach((node) => {
      for (const [key] of ENGINE_ROWS) {
        const on = Boolean(engines[key]);
        const bar = node.querySelector(`.engine-bar[data-engine="${key}"]`);
        if (bar) bar.dataset.state = on ? "on" : "off";
        const row = node.querySelector(`.engine-row[data-engine="${key}"]`);
        if (!row) continue;
        row.dataset.state = on ? "on" : "off";
        row.querySelector(".engine-row-state").textContent = on ? "Ready" : "Missing";
      }
      const label = node.querySelector(".engine-version");
      if (label) label.textContent = version;
    });
  };

  nodes.forEach((node) => {
    node.querySelectorAll(".engine-bar, .engine-row").forEach((el) => delete el.dataset.state);
    node.querySelectorAll(".engine-row-state").forEach((el) => (el.textContent = "—"));
    const version = node.querySelector(".engine-version");
    if (version) version.textContent = "API";
  });
  set("pending", "Checking", "Checking the processing API");

  try {
    const data = await health();
    const engines = data.engines || {};
    const version = data.version ? `API ${data.version}` : "API";
    paint(engines, version);
    const ready = CORE_ENGINES.filter(([key]) => engines[key]).length;
    if (ready === CORE_ENGINES.length) {
      set("ok", "Engines ready", `${version} · Poppler, Ghostscript and qpdf are online`);
    } else {
      set("partial", "Limited engines", `${ready} of 3 core document engines are online`);
    }
  } catch (error) {
    paint({}, "—");
    set("offline", "API offline", `${API_BASE || "Same origin"} could not be reached`);
  }
}

export function initLayout({ active = "", title = "" } = {}) {
  if (title) document.title = `${title} · PaperLab`;
  initTheme();
  const headerSlot = $("#site-header");
  const footerSlot = $("#site-footer");
  if (headerSlot) headerSlot.replaceWith(buildHeader(active));
  if (footerSlot) footerSlot.replaceWith(buildFooter());
  updateEngineStatus();
  // Keep the status fresh without hammering the API.
  setInterval(updateEngineStatus, 120000);
  hydrateIcons(document);
  document.documentElement.classList.add("is-ready");
}

export function setStatus(tone, label, title = "") {
  document.querySelectorAll("[data-engine-status]").forEach((node) => {
    node.dataset.tone = tone;
    node.title = title || label;
    node.setAttribute("aria-label", title || label);
    const text = node.querySelector(".engine-label");
    if (text) text.textContent = label;
  });
}

export { applyTheme };
