import { icon } from "./icons.js";
import { h } from "./ui.js";
import { GROUP_MAP, toolHref } from "./tools-data.js";

export function toolCard(tool, { index = null, info = null, compact = false } = {}) {
  const group = GROUP_MAP[tool.group];
  const unavailable = info && info.available === false;
  const card = h(
    "a",
    {
      class: `tool-card ${compact ? "tool-card-compact" : ""} ${unavailable ? "is-unavailable" : ""}`,
      href: toolHref(tool.id),
      "data-accent": group?.accent || "blue",
      "data-tool": tool.id,
    },
    h(
      "span",
      { class: "tool-card-top" },
      h("span", { class: "tool-card-icon", html: icon(tool.icon, compact ? 19 : 23) }),
      index != null ? h("span", { class: "tool-card-index mono", text: String(index).padStart(2, "0") }) : h("span", { class: "tool-card-arrow", html: icon("arrow", 16) })
    ),
    h("span", { class: "tool-card-body" },
      h("strong", { class: "tool-card-name", text: tool.name }),
      h("span", { class: "tool-card-tagline", text: tool.tagline })
    ),
    h(
      "span",
      { class: "tool-card-foot" },
      h("span", { class: "tool-card-group mono", text: group?.name || tool.group }),
      unavailable
        ? h("span", { class: "tool-card-state", title: info.reason || "Needs a server engine" }, h("span", { class: "dot dot-off" }), "Setup")
        : h("span", { class: "tool-card-open", html: icon("arrow", 14) })
    )
  );
  return card;
}

export function toolLine(tool, { info = null } = {}) {
  const group = GROUP_MAP[tool.group];
  return h(
    "a",
    { class: `tool-line ${info?.available === false ? "is-unavailable" : ""}`, href: toolHref(tool.id), "data-accent": group?.accent },
    h("span", { class: "tool-line-icon", html: icon(tool.icon, 17) }),
    h("span", { class: "tool-line-name", text: tool.name }),
    h("span", { class: "tool-line-arrow", html: icon("arrow", 14) })
  );
}

export function groupMark(group, count) {
  return h(
    "div",
    { class: "group-mark", "data-accent": group.accent },
    h("span", { class: "group-label mono", text: group.label }),
    h("h3", { class: "group-title", text: group.name }),
    h("p", { class: "group-blurb", text: group.blurb }),
    h("span", { class: "group-count mono", text: `${count} tool${count === 1 ? "" : "s"}` })
  );
}
