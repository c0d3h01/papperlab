import { initLayout } from "./layout.js";
import { icon } from "./icons.js";
import { $, h, debounce, hydrateIcons } from "./ui.js";
import {
  TOOLS,
  GROUPS,
  GROUP_MAP,
  toolsByGroup,
  searchTools,
} from "./tools-data.js";
import { toolCard } from "./cards.js";
import { tools as fetchTools } from "./api.js";

initLayout({ active: "tools", title: "The toolbox" });

const state = {
  query: "",
  group: "all",
  availableOnly: false,
  info: {},
  serverTools: [],
};

const filtersSlot = $("#catalog-filters");
const groupsSlot = $("#catalog-groups");
const emptySlot = $("#catalog-empty");
const countSlot = $("#catalog-count");
const searchInput = $("#catalog-q");
const availableToggle = $("#catalog-available");

function toolAvailable(id) {
  const info = state.info[id];
  if (!info) return true;
  return info.available !== false;
}

function availableReason(id) {
  return state.info[id]?.reason || "This tool needs an engine that is not configured on this server.";
}

function buildFilters() {
  filtersSlot.innerHTML = "";
  const total = TOOLS.length;
  const chips = [{ id: "all", name: "All tools", count: total }];
  for (const group of GROUPS) {
    const count = toolsByGroup(group.id).length;
    chips.push({ id: group.id, name: group.name, count, accent: group.accent });
  }
  for (const chip of chips) {
    const button = h(
      "button",
      {
        type: "button",
        class: `filter-chip ${state.group === chip.id ? "is-active" : ""}`,
        "aria-pressed": state.group === chip.id ? "true" : "false",
        dataset: chip.accent ? { accent: chip.accent } : {},
        onclick: () => {
          state.group = chip.id;
          update();
        },
      },
      chip.name,
      h("span", { class: "count", text: String(chip.count).padStart(2, "0") })
    );
    if (chip.accent) {
      button.style.setProperty("--chip-accent", `var(--${chip.accent === "ink" ? "ink" : chip.accent})`);
    }
    filtersSlot.append(button);
  }
  filtersSlot.append(
    h("span", {
      class: "mono micro",
      style: "margin-left:auto;white-space:nowrap;padding-left:12px",
      text: `${Object.values(state.info).filter((t) => t.available !== false).length || TOOLS.length} ready`,
    })
  );
}

function matchesFilters(tool) {
  if (state.group !== "all" && tool.group !== state.group) return false;
  if (state.availableOnly && !toolAvailable(tool.id)) return false;
  return true;
}

function render() {
  const searched = state.query ? searchTools(state.query) : TOOLS;
  const visible = searched.filter(matchesFilters);
  groupsSlot.innerHTML = "";
  emptySlot.hidden = visible.length > 0;

  const shownGroups = GROUPS.filter((group) => visible.some((t) => t.group === group.id));
  for (const group of shownGroups) {
    const tools = visible.filter((t) => t.group === group.id);
    const section = h(
      "section",
      { class: "catalog-group", "data-accent": group.accent, "aria-labelledby": `group-${group.id}` },
      h(
        "div",
        { class: "catalog-group-head" },
        h(
          "div",
          {},
          h("h2", { id: `group-${group.id}`, text: group.name }),
          h("p", { text: group.blurb })
        ),
        h("span", { class: "group-label mono", text: `${group.label} · ${tools.length} tool${tools.length === 1 ? "" : "s"}` })
      ),
      h(
        "div",
        { class: "tool-grid" },
        tools.map((tool, index) =>
          toolCard(tool, {
            index: index + 1,
            info: state.info[tool.id],
          })
        )
      )
    );
    groupsSlot.append(section);
  }

  countSlot.textContent = state.query
    ? `${visible.length} result${visible.length === 1 ? "" : "s"} for “${state.query}”`
    : `${visible.length} tool${visible.length === 1 ? "" : "s"} across ${shownGroups.length} famil${shownGroups.length === 1 ? "y" : "ies"}`;

  if (state.availableOnly) {
    const unavailable = visible.filter((t) => !toolAvailable(t.id));
    if (unavailable.length) {
      countSlot.textContent += ` · ${unavailable.length} hidden`;
    }
  }
  hydrateIcons(groupsSlot);
}

function syncURL() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.group !== "all") params.set("group", state.group);
  if (state.availableOnly) params.set("available", "1");
  const next = `${location.pathname}${params.toString() ? `?${params}` : ""}`;
  history.replaceState(null, "", next);
}

function update({ url = true } = {}) {
  buildFilters();
  render();
  if (url) syncURL();
}

function readURL() {
  const params = new URLSearchParams(location.search);
  state.query = params.get("q") || "";
  const group = params.get("group");
  state.group = group && GROUP_MAP[group] ? group : "all";
  state.availableOnly = params.get("available") === "1";
  searchInput.value = state.query;
  availableToggle.checked = state.availableOnly;
}

searchInput.addEventListener(
  "input",
  debounce(() => {
    state.query = searchInput.value.trim();
    update();
  }, 140)
);

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchInput.value = "";
    state.query = "";
    update();
    searchInput.blur();
  }
});

availableToggle.addEventListener("change", () => {
  state.availableOnly = availableToggle.checked;
  update();
});

$("#catalog-reset").addEventListener("click", () => {
  state.query = "";
  state.group = "all";
  state.availableOnly = false;
  searchInput.value = "";
  availableToggle.checked = false;
  update();
  searchInput.focus();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  event.preventDefault();
  searchInput.focus();
});

async function loadInventory() {
  readURL();
  update({ url: false });
  hydrateIcons(document);
  try {
    const data = await fetchTools();
    state.serverTools = data.tools || [];
    for (const info of state.serverTools) state.info[info.id] = info;
    // Flag tools the server marks unavailable without hiding them by default.
    const unavailable = state.serverTools.filter((t) => t.available === false);
    if (unavailable.length) {
      const notice = h(
        "div",
        { class: "quick-note", style: "margin-bottom:18px" },
        h("span", { html: icon("warning", 16) }),
        h(
          "p",
          {},
          h("strong", { text: `${unavailable.length} tool${unavailable.length === 1 ? "" : "s"} need setup on this server.` }),
          " They are marked “Setup” below. ",
          h("span", { class: "mono", text: unavailable.map((t) => t.id).join(", ") })
        )
      );
      groupsSlot.before(notice);
    }
  } catch {
    // The catalog still works offline; availability is simply unknown.
  }
  update({ url: false });
}

loadInventory();
