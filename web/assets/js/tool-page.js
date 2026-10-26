import { initLayout } from "./layout.js";
import { icon } from "./icons.js";
import {
  $,
  h,
  createDropzone,
  toast,
  hydrateIcons,
  fileExt,
  formatBytes,
} from "./ui.js";
import {
  TOOLS,
  TOOL_MAP,
  GROUP_MAP,
  toolsByGroup,
  toolHref,
} from "./tools-data.js";
import { saveHandoff, takeHandoff } from "./file-store.js";
import { runToolJob } from "./job-view.js";
import {
  tools as fetchTools,
  config as fetchConfig,
  inspectPDF,
  inspectForms,
} from "./api.js";

const params = new URLSearchParams(location.search);
const toolId = params.get("tool") || "";
const tool = TOOL_MAP[toolId];

if (!tool) {
  location.replace("tools.html");
} else {
  boot();
}

function boot() {
  if (tool.studio && params.get("handoff")) {
    location.replace(
      `studio.html?tool=${encodeURIComponent(tool.studio)}&handoff=${encodeURIComponent(params.get("handoff"))}`
    );
    return;
  }

  initLayout({
    active: tool.studio ? "studio" : "tools",
    title: tool.name,
  });

  const group = GROUP_MAP[tool.group];
  document.body.dataset.accent = group?.accent || "blue";

  const state = {
    files: [],
    assets: [],
    values: {},
    controls: {},
    fields: [],
    formValues: {},
    inspected: null,
    formFields: [],
    toolInfo: null,
    configData: null,
    busy: false,
    prefilled: false,
  };

  renderHero(group);
  renderAside(group);
  buildLayout(state);
  hydrateIcons(document);
  loadEnvironment(state);
  restoreHandoff(state);
}

/* -------------------------------------------------------------------------- */
/* Hero + aside                                                               */

function renderHero(group) {
  const crumb = $("#tool-breadcrumb");
  crumb.append(
    h("a", { href: "tools.html", text: "Tools" }),
    h("span", { html: icon("chevron", 12) }),
    h("a", { href: `tools.html?group=${tool.group}`, text: group?.name || tool.group }),
    h("span", { html: icon("chevron", 12) }),
    h("span", { text: tool.name })
  );

  const index = TOOLS.findIndex((t) => t.id === tool.id) + 1;
  const inputs = tool.multiple
    ? `${tool.minFiles === tool.maxFiles ? tool.minFiles : `${tool.minFiles}–${tool.maxFiles}`} files`
    : tool.allowNoInput
      ? "File or URL"
      : "1 file";
  const badges = [
    h("span", { class: "badge", text: group?.name || tool.group }),
    h("span", { class: "badge", text: inputs }),
    h("span", { class: "badge", text: `${tool.outputs.length || 1} output${tool.outputs.length === 1 ? "" : "s"}` }),
    tool.studio ? h("span", { class: "badge is-ok" }, h("span", { html: icon("studio", 11) }), "Visual studio") : null,
    tool.ai ? h("span", { class: "badge" }, h("span", { html: icon("spark", 11) }), "AI assisted") : null,
    tool.multiple ? h("span", { class: "badge" }, h("span", { html: icon("layers", 11) }), "Batch") : null,
  ].filter(Boolean);

  $("#tool-hero").append(
    h("span", { class: "tool-hero-icon", html: icon(tool.icon, 30) }),
    h(
      "div",
      { class: "tool-hero-copy" },
      h("h1", { text: tool.name }),
      h("p", { text: tool.description }),
      h("div", { class: "tool-hero-badges" }, badges)
    ),
    h(
      "div",
      { class: "tool-hero-aside" },
      h("span", { class: "mono", text: "PAPERLAB / TOOL" }),
      h("strong", { text: `${String(index).padStart(2, "0")} of ${TOOLS.length}` }),
      h("span", { class: "mono", style: "margin-top:10px", text: tool.studio ? "STUDIO JOB" : "SINGLE PASS" })
    )
  );
}

function relatedTools() {
  const same = toolsByGroup(tool.group).filter((t) => t.id !== tool.id);
  if (same.length >= 3) return same.slice(0, 4);
  const extra = TOOLS.filter((t) => t.id !== tool.id && !same.includes(t) && t.popular).slice(0, 3);
  return [...same, ...extra].slice(0, 4);
}

function renderAside(group) {
  const aside = $("#tool-aside");

  const outputs = h("div", { class: "aside-card" });
  outputs.append(
    h("h3", { class: "aside-card-title" }, h("span", { html: icon("download", 14) }), "You will receive"),
    h(
      "ul",
      { class: "aside-list" },
      (tool.outputs.length ? tool.outputs : ["Processed file"]).map((item) => h("li", { text: item }))
    )
  );
  aside.append(outputs);

  if (tool.tips?.length || tool.notes) {
    const tips = h("div", { class: "aside-card" });
    tips.append(
      h("h3", { class: "aside-card-title" }, h("span", { html: icon("spark", 14) }), "Good to know"),
      h(
        "ul",
        { class: "aside-list" },
        [...(tool.tips || []), ...(tool.notes ? [tool.notes] : [])].map((tip) => h("li", { text: tip }))
      )
    );
    aside.append(tips);
  }

  const related = h("div", { class: "aside-card" });
  related.append(
    h("h3", { class: "aside-card-title" }, h("span", { html: icon("layers", 14) }), "Nearby tools"),
    h(
      "div",
      { class: "related-list" },
      relatedTools().map((other) =>
        h(
          "a",
          { href: toolHref(other.id) },
          h("span", { html: icon(other.icon, 15) }),
          h("span", { text: other.name }),
          h("span", { style: "margin-left:auto", html: icon("arrow", 13) })
        )
      )
    )
  );
  aside.append(related);

  if (tool.id === "ask-pdf") {
    aside.append(
      h(
        "div",
        { class: "aside-promo" },
        h("span", { class: "eyebrow", text: "Interactive" }),
        h("h3", { text: "Ask follow-ups." }),
        h("p", { text: "The chat view keeps the conversation and shows page citations for every answer." }),
        h("a", { class: "btn btn-primary btn-sm", href: "chat.html?tool=ask-pdf" }, "Open chat", h("span", { html: icon("arrow", 14) }))
      )
    );
  } else if (!tool.studio) {
    aside.append(
      h(
        "div",
        { class: "aside-promo" },
        h("span", { class: "eyebrow", text: "PaperLab Studio" }),
        h("h3", { text: "Need eyes on the page?" }),
        h("p", { text: "Open the visual editor to place marks, redact areas, crop by hand or sign." }),
        h("a", { class: "btn btn-primary btn-sm", href: "studio.html" }, "Open studio", h("span", { html: icon("arrow", 14) }))
      )
    );
  }

  aside.append(
    h(
      "div",
      { class: "aside-card" },
      h("h3", { class: "aside-card-title" }, h("span", { html: icon("lock", 14) }), "House rules"),
      h("p", { text: "No account. No added watermark. Files are deleted when the job window closes." })
    )
  );
}

/* -------------------------------------------------------------------------- */
/* Form scaffolding                                                           */

function cardStep(number, title, copy, extra = null) {
  return h(
    "div",
    { class: "tool-step" },
    h("span", { class: "mono", text: number }),
    h("h2", { text: title }),
    copy ? h("p", { text: copy }) : null,
    extra
  );
}

function buildLayout(state) {
  const area = $("#tool-form-area");

  const uploadCard = h("section", { class: "tool-form-card", id: "upload-card" });
  uploadCard.append(
    cardStep(
      "01",
      tool.studio ? "Choose a PDF" : tool.id === "html-to-pdf" ? "Choose a source" : "Add your file",
      tool.multiple ? `Up to ${tool.maxFiles} files. Order matters.` : tool.allowNoInput ? "Optional when you enter a URL below." : "One file, processed privately."
    )
  );
  const dropHost = h("div");
  uploadCard.append(dropHost);
  area.append(uploadCard);

  const drop = createDropzone(dropHost, {
    accept: tool.accept || "",
    multiple: Boolean(tool.multiple),
    maxFiles: tool.maxFiles || 1,
    title: tool.multiple ? "Drop files here" : "Drop a file here",
    hint: tool.multiple
      ? `or click to browse · up to ${tool.maxFiles} files`
      : `or click to browse · ${acceptLabel(tool.accept)}`,
    onChange(files) {
      state.files = files;
      refreshRunState(state);
      handleSelection(state, files);
    },
  });
  state.drop = drop;

  const optionsCard = h("section", { class: "tool-form-card", id: "options-card" });
  area.append(optionsCard);
  state.optionsCard = optionsCard;

  if (tool.studio) {
    renderStudioHandoff(state, optionsCard);
  } else {
    renderOptions(state, optionsCard);
  }

  if (tool.visual) {
    // The visual route lives beside the regular form.
    const handoff = h(
      "div",
      { class: "studio-handoff" },
      h(
        "div",
        {},
        h("strong", { text: tool.visual === "redact" ? "Prefer to draw the boxes?" : "Prefer to draw the crop?" }),
        h("p", { text: "Open the studio, mark the page by hand, then export the same job." })
      ),
      h(
        "button",
        {
          class: "btn btn-quiet",
          type: "button",
          onclick: () => openStudio(state, tool.visual),
        },
        h("span", { html: icon("studio", 16) }),
        "Draw on the page"
      )
    );
    optionsCard.append(handoff);
  }
}

function acceptLabel(accept = "") {
  if (!accept) return "any file";
  if (accept.includes(".pdf")) return "PDF";
  if (accept.includes(".docx")) return "Word";
  if (accept.includes(".pptx")) return "slides";
  if (accept.includes(".xlsx")) return "spreadsheet";
  if (accept.includes(".html")) return "HTML";
  return "images";
}

function renderStudioHandoff(state, card) {
  const modeCopy = {
    edit: ["Edit on the page", "Add text, highlights, shapes, ink, images and signatures, then bake them into the PDF."],
    sign: ["Place a signature", "Draw, type or upload a signature. Choose a page and position, and get an audit trail."],
    organize: ["Arrange the pages", "Reorder, rotate, duplicate and delete pages on a contact sheet, then rebuild the document."],
  }[tool.studio] || ["Open the studio", "Work visually on the document."];

  card.append(
    cardStep("02", modeCopy[0], modeCopy[1]),
    h(
      "div",
      { class: "studio-handoff" },
      h(
        "div",
        {},
        h("strong", { text: "The studio needs the file in your browser." }),
        h("p", { text: "Your PDF is handed to the studio locally; nothing is uploaded until you export." })
      ),
      h(
        "button",
        {
          class: "btn btn-primary",
          type: "button",
          id: "run-tool",
          onclick: () => openStudio(state, tool.studio),
        },
        h("span", { html: icon("studio", 16) }),
        "Open studio",
        h("span", { class: "btn-arrow", html: icon("arrow", 15) })
      )
    ),
    h("p", { class: "field-help", style: "margin-top:12px", text: "You can also open the studio from the main navigation and drop a PDF there." })
  );
}

async function openStudio(state, mode) {
  if (!state.files.length) {
    toast("Choose a PDF first", "error");
    state.drop?.element?.focus();
    return;
  }
  try {
    const id = await saveHandoff(state.files, { tool: mode, source: "tool-page" });
    location.href = `studio.html?tool=${encodeURIComponent(mode)}&handoff=${encodeURIComponent(id)}`;
  } catch (error) {
    toast(error.message || "Could not open the studio", "error");
  }
}

/* -------------------------------------------------------------------------- */
/* Generic fields                                                             */

function looseEq(a, b) {
  return String(a) === String(b);
}

function conditionMet(state, when) {
  if (!when) return true;
  const value = state.values[when.key];
  if (Object.prototype.hasOwnProperty.call(when, "equals")) return looseEq(value, when.equals);
  if (Object.prototype.hasOwnProperty.call(when, "notEquals")) return !looseEq(value, when.notEquals);
  if (Array.isArray(when.in)) return when.in.some((item) => looseEq(value, item));
  if (Object.prototype.hasOwnProperty.call(when, "truthy")) return Boolean(value) === Boolean(when.truthy);
  return true;
}

function refreshConditions(state) {
  for (const field of state.fields) {
    const control = state.controls[field.key];
    if (!control?.wrapper) continue;
    control.wrapper.hidden = !conditionMet(state, field.when);
  }
}

function setValue(state, key, value) {
  state.values[key] = value;
  refreshConditions(state);
  refreshRunState(state);
}

function renderOptions(state, card) {
  card.append(
    cardStep(
      "02",
      "Set the job",
      tool.fields.length ? "Plain controls. Defaults are a good place to start." : "No settings needed — just press start.",
      null
    )
  );

  const fields = tool.fields || [];
  state.fields = fields;
  for (const field of fields) {
    state.values[field.key] = field.default !== undefined ? field.default : defaultForType(field.type);
  }

  const grid = h("div", { class: "form-grid" });
  const advanced = [];
  for (const field of fields) {
    if (field.advanced) {
      advanced.push(field);
      continue;
    }
    const control = buildField(state, field);
    state.controls[field.key] = control;
    grid.append(control.wrapper);
  }
  card.append(grid);

  if (advanced.length) {
    const details = h("details", { class: "advanced-box" });
    details.append(h("summary", { text: "Advanced settings" }));
    const advGrid = h("div", { class: "form-grid" });
    for (const field of advanced) {
      const control = buildField(state, field);
      state.controls[field.key] = control;
      advGrid.append(control.wrapper);
    }
    details.append(advGrid);
    card.append(details);
  }

  if (tool.id === "fill-form") {
    const fieldsCard = h("div", { class: "dynamic-fields", id: "form-fields" });
    fieldsCard.append(
      h(
        "div",
        { class: "form-loading" },
        h("span", { class: "spinner", "aria-hidden": "true" }),
        "Choose a PDF to read its form fields."
      )
    );
    card.append(h("div", { class: "form-section-label", text: "Form fields" }), fieldsCard);
  }

  if (tool.id === "metadata") {
    card.append(
      h(
        "div",
        { class: "form-loading", id: "metadata-status" },
        h("span", { html: icon("metadata", 16) }),
        "Choose a PDF to load its current properties."
      )
    );
  }

  const errorSlot = h("div", { id: "form-error" });
  const runButton = h(
    "button",
    { class: "btn btn-primary btn-lg", type: "button", id: "run-tool", onclick: () => submitJob(state) },
    h("span", { html: icon(tool.studio ? "studio" : "spark", 17) }),
    tool.studio ? "Open studio" : `Run ${tool.short || tool.name}`,
    h("span", { class: "btn-arrow", html: icon("arrow", 16) })
  );

  const actions = h(
    "div",
    { class: "form-actions" },
    runButton,
    h(
      "span",
      { class: "form-privacy" },
      h("span", { html: icon("lock", 13) }),
      "Private by default · files expire automatically"
    )
  );
  card.append(errorSlot, actions);

  // Keep controls in sync with defaults and conditions.
  refreshConditions(state);
  refreshRunState(state);
  if (tool.id === "html-to-pdf") {
    const urlField = state.controls.url;
    if (urlField) {
      const input = urlField.wrapper.querySelector("input");
      input?.addEventListener("input", () => refreshRunState(state));
    }
  }
}

function defaultForType(type) {
  switch (type) {
    case "toggle":
      return false;
    case "checks":
      return [];
    case "number":
    case "range":
      return 0;
    default:
      return "";
  }
}

function fieldLabel(field) {
  const label = h("label", { class: "field-label", for: `field-${field.key}` }, field.label);
  if (field.required) label.append(h("span", { class: "optional", text: "required" }));
  else if (!field.advanced) label.append(h("span", { class: "optional", text: "optional" }));
  return label;
}

function fieldWrapper(field, control) {
  const wrapper = h("div", {
    class: `field ${field.width === "half" ? "" : "field-full"}`,
    dataset: { field: field.key },
  });
  if (field.type !== "toggle" && field.type !== "checks" && field.type !== "cards") {
    wrapper.append(fieldLabel(field));
  }
  wrapper.append(control);
  if (field.help) wrapper.append(h("span", { class: "field-help", text: field.help }));
  return wrapper;
}

function buildField(state, field) {
  const value = state.values[field.key];
  let control;

  switch (field.type) {
    case "textarea": {
      control = h("textarea", {
        class: "field-textarea",
        id: `field-${field.key}`,
        placeholder: field.placeholder || "",
        rows: 4,
        oninput: (event) => setValue(state, field.key, event.target.value),
      });
      control.value = value || "";
      break;
    }
    case "select": {
      control = h("select", {
        class: "field-select",
        id: `field-${field.key}`,
        onchange: (event) => setValue(state, field.key, event.target.value),
      });
      for (const option of field.options || []) {
        const node = h("option", { value: option.value, text: option.label });
        if (looseEq(option.value, value)) node.selected = true;
        control.append(node);
      }
      break;
    }
    case "segment": {
      control = h("div", { class: "segment-group", role: "group", "aria-label": field.label });
      for (const option of field.options || []) {
        const button = h(
          "button",
          {
            type: "button",
            class: looseEq(option.value, value) ? "is-active" : "",
            "aria-pressed": looseEq(option.value, value) ? "true" : "false",
            onclick: () => {
              state.values[field.key] = option.value;
              control.querySelectorAll("button").forEach((node) => {
                const on = node === button;
                node.classList.toggle("is-active", on);
                node.setAttribute("aria-pressed", String(on));
              });
              refreshConditions(state);
              refreshRunState(state);
            },
          },
          option.label
        );
        control.append(button);
      }
      break;
    }
    case "toggle": {
      const input = h("input", {
        type: "checkbox",
        id: `field-${field.key}`,
        onchange: (event) => setValue(state, field.key, event.target.checked),
      });
      input.checked = Boolean(value);
      control = h(
        "label",
        { class: "switch-row", for: `field-${field.key}` },
        h("span", { class: "switch" }, input, h("span", { class: "switch-track" })),
        h(
          "span",
          { class: "switch-copy" },
          h("strong", { text: field.label }),
          field.help ? h("span", { text: field.help }) : null
        )
      );
      return { wrapper: fieldWrapper({ ...field, help: "" }, control), control };
    }
    case "range": {
      const output = h("span", { class: "range-value", text: formatRange(field, value) });
      const input = h("input", {
        type: "range",
        id: `field-${field.key}`,
        min: field.min ?? 0,
        max: field.max ?? 100,
        step: field.step ?? 1,
        oninput: (event) => {
          const next = Number(event.target.value);
          output.textContent = formatRange(field, next);
          setValue(state, field.key, next);
        },
      });
      input.value = value ?? field.min ?? 0;
      control = h("div", { class: "range-row" }, input, output);
      break;
    }
    case "color": {
      const label = h("span", { class: "color-value", text: String(value || "").toUpperCase() });
      const input = h("input", {
        type: "color",
        id: `field-${field.key}`,
        oninput: (event) => {
          label.textContent = event.target.value.toUpperCase();
          setValue(state, field.key, event.target.value);
        },
      });
      input.value = value || "#000000";
      control = h("div", { class: "color-row" }, input, label);
      break;
    }
    case "checks": {
      control = h("div", { class: "checks-grid" });
      const selected = new Set(Array.isArray(value) ? value : []);
      for (const option of field.options || []) {
        const input = h("input", {
          type: "checkbox",
          value: option.value,
          onchange: () => {
            const next = new Set(selected);
            if (input.checked) next.add(option.value);
            else next.delete(option.value);
            selected.clear();
            next.forEach((item) => selected.add(item));
            setValue(state, field.key, Array.from(selected));
          },
        });
        input.checked = selected.has(option.value);
        control.append(h("label", { class: "check-row" }, input, h("span", { text: option.label })));
      }
      return { wrapper: fieldWrapper(field, control), control };
    }
    case "cards": {
      control = h("div", { class: "option-cards", role: "group", "aria-label": field.label });
      for (const option of field.options || []) {
        const button = h(
          "button",
          {
            type: "button",
            class: `option-card ${looseEq(option.value, value) ? "is-active" : ""}`,
            "aria-pressed": looseEq(option.value, value) ? "true" : "false",
            onclick: () => {
              state.values[field.key] = option.value;
              control.querySelectorAll(".option-card").forEach((node) => {
                const on = node === button;
                node.classList.toggle("is-active", on);
                node.setAttribute("aria-pressed", String(on));
              });
              refreshConditions(state);
              refreshRunState(state);
            },
          },
          h("strong", { text: option.label }),
          option.hint ? h("span", { text: option.hint }) : null
        );
        control.append(button);
      }
      return { wrapper: fieldWrapper(field, control), control };
    }
    case "pages": {
      const input = h("input", {
        class: "field-input",
        id: `field-${field.key}`,
        type: "text",
        placeholder: field.placeholder || "All pages",
        autocomplete: "off",
        oninput: (event) => setValue(state, field.key, event.target.value),
      });
      input.value = value || "";
      const presets = h("div", { class: "pages-presets" });
      for (const [label, preset] of [
        ["All", ""],
        ["Odd", "odd"],
        ["Even", "even"],
        ["Last", "last"],
      ]) {
        presets.append(
          h(
            "button",
            {
              type: "button",
              onclick: () => {
                input.value = preset;
                setValue(state, field.key, preset);
              },
            },
            label
          )
        );
      }
      control = h("div", {}, input, presets);
      break;
    }
    case "asset": {
      const preview = h("span", { class: "asset-preview", html: icon("image", 22) });
      const name = h("strong", { text: "Choose an image" });
      const hint = h("span", { text: field.help || "PNG, JPG or WebP" });
      const input = h("input", {
        type: "file",
        accept: field.accept || "image/*",
        onchange: () => {
          const file = input.files?.[0];
          state.assets = file ? [file] : [];
          if (file) {
            const url = URL.createObjectURL(file);
            preview.innerHTML = "";
            preview.append(h("img", { src: url, alt: file.name }));
            name.textContent = file.name;
            hint.textContent = formatBytes(file.size);
            refreshRunState(state);
          }
        },
      });
      control = h(
        "label",
        { class: "asset-drop" },
        input,
        preview,
        h("span", { class: "asset-copy" }, name, hint),
        h("span", { style: "margin-left:auto", html: icon("upload", 16) })
      );
      break;
    }
    case "number": {
      const input = h("input", {
        class: "field-input",
        id: `field-${field.key}`,
        type: "number",
        min: field.min,
        max: field.max,
        step: field.step ?? 1,
        placeholder: field.placeholder || "",
        oninput: (event) => {
          const raw = event.target.value;
          setValue(state, field.key, raw === "" ? "" : Number(raw));
        },
      });
      input.value = value ?? "";
      control = field.suffix
        ? h("div", { class: "field-suffix" }, input, h("span", { text: field.suffix }))
        : input;
      break;
    }
    default: {
      const input = h("input", {
        class: "field-input",
        id: `field-${field.key}`,
        type: field.type === "password" ? "password" : field.type === "url" ? "url" : "text",
        placeholder: field.placeholder || "",
        autocomplete: field.type === "password" ? "new-password" : "off",
        oninput: (event) => setValue(state, field.key, event.target.value),
      });
      input.value = value || "";
      control = input;
      break;
    }
  }

  return { wrapper: fieldWrapper(field, control), control };
}

function formatRange(field, value) {
  const number = Number(value);
  const step = Number(field.step || 1);
  const decimals = step < 1 ? String(step).split(".")[1]?.length || 2 : 0;
  return number.toFixed(decimals);
}

/* -------------------------------------------------------------------------- */
/* Dynamic form fields                                                        */

function renderFormFields(state) {
  const slot = $("#form-fields");
  if (!slot) return;
  slot.innerHTML = "";
  const fields = state.formFields || [];
  if (!fields.length) {
    slot.append(
      h(
        "div",
        { class: "form-loading" },
        h("span", { html: icon("warning", 16) }),
        "No fillable AcroForm fields were found in this PDF."
      )
    );
    return;
  }
  state.formValues = {};
  const grid = h("div", { class: "form-grid" });
  for (const field of fields) {
    const key = field.id || field.name;
    if (!key) continue;
    const initial = field.value ?? field.default ?? "";
    state.formValues[key] = initial;
    const label = h(
      "label",
      { class: "field-label", for: `form-${key}` },
      field.name || field.id,
      h(
        "span",
        { class: "optional", text: [field.type, field.pages?.length ? `p.${field.pages.join(",")}` : ""].filter(Boolean).join(" · ") }
      )
    );
    let control;
    if (field.type === "checkbox") {
      const input = h("input", { type: "checkbox", id: `form-${key}`, onchange: () => (state.formValues[key] = input.checked) });
      input.checked = Boolean(initial);
      control = h("label", { class: "check-row" }, input, h("span", { text: "Checked" }));
    } else if (field.type === "radio" || field.type === "combo") {
      control = h("select", { class: "field-select", id: `form-${key}`, onchange: (event) => (state.formValues[key] = event.target.value) });
      control.append(h("option", { value: "", text: "— choose —" }));
      for (const option of field.options || []) {
        const node = h("option", { value: option, text: option });
        if (looseEq(option, initial)) node.selected = true;
        control.append(node);
      }
    } else if (field.type === "list") {
      control = h("select", {
        class: "field-select",
        id: `form-${key}`,
        multiple: field.multi ? "" : null,
        onchange: (event) => {
          state.formValues[key] = field.multi
            ? Array.from(event.target.selectedOptions, (o) => o.value)
            : event.target.value;
        },
      });
      control.append(h("option", { value: "", text: "— choose —" }));
      for (const option of field.options || []) {
        const node = h("option", { value: option, text: option });
        if (Array.isArray(initial) ? initial.includes(option) : looseEq(option, initial)) node.selected = true;
        control.append(node);
      }
    } else {
      control = h("input", {
        class: "field-input",
        id: `form-${key}`,
        type: field.type === "date" ? "date" : "text",
        placeholder: field.name || field.id,
        oninput: (event) => (state.formValues[key] = event.target.value),
      });
      control.value = initial == null ? "" : String(initial);
      if (field.maxLen) control.maxLength = field.maxLen;
      if (field.locked) control.disabled = true;
    }
    grid.append(h("div", { class: "field field-full" }, label, control));
  }
  slot.append(grid);
  slot.append(
    h(
      "p",
      { class: "field-help", style: "margin-top:10px" },
      `${fields.length} field${fields.length === 1 ? "" : "s"} found. Empty fields are left untouched.`
    )
  );
}

async function inspectSelection(state, { quiet = false } = {}) {
  if (!state.files.length) return;
  const file = state.files[0];
  if (fileExt(file.name) !== "pdf") return;
  const password = state.values.password || "";
  try {
    if (tool.id === "metadata") {
      const status = $("#metadata-status");
      if (status) status.innerHTML = `<span class="spinner" aria-hidden="true"></span> Reading properties…`;
      const info = await inspectPDF(file, password);
      state.inspected = info;
      const mapping = {
        title: info.title || "",
        author: info.author || "",
        subject: info.subject || "",
        creator: info.creator || "",
        keywords: Array.isArray(info.keywords) ? info.keywords.join(", ") : "",
      };
      for (const [key, value] of Object.entries(mapping)) {
        if (!value) continue;
        if (!state.values[key]) {
          state.values[key] = value;
          const control = state.controls[key]?.control;
          if (control && "value" in control) control.value = value;
        }
      }
      state.prefilled = true;
      if (status) {
        status.className = "form-loading";
        status.innerHTML = "";
        status.append(
          h("span", { html: icon("check", 16) }),
          h("span", {
            text: `${info.pages} page${info.pages === 1 ? "" : "s"} · ${formatBytes(info.fileSize)}${info.textLayer ? " · text layer found" : " · no text layer"}${info.encrypted ? " · encrypted" : ""}`,
          })
        );
      }
    }
    if (tool.id === "fill-form") {
      const slot = $("#form-fields");
      if (slot) slot.innerHTML = "";
      if (slot) slot.append(h("div", { class: "form-loading" }, h("span", { class: "spinner" }), "Reading form fields…"));
      const data = await inspectForms(file, password);
      state.formFields = data.fields || [];
      renderFormFields(state);
      refreshRunState(state);
    }
  } catch (error) {
    if (!quiet) toast(error.message || "Could not inspect the PDF", "error");
    if (tool.id === "metadata") {
      const status = $("#metadata-status");
      if (status) {
        status.className = "form-error";
        status.textContent = error.message;
      }
    }
    if (tool.id === "fill-form") {
      const slot = $("#form-fields");
      if (slot) {
        slot.innerHTML = "";
        slot.append(h("div", { class: "form-error" }, error.message));
      }
    }
  }
}

function handleSelection(state, files) {
  if (!files.length) return;
  if (["metadata", "fill-form"].includes(tool.id)) inspectSelection(state);
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */

function visibleRequiredMissing(state) {
  for (const field of state.fields) {
    if (!field.required) continue;
    const control = state.controls[field.key];
    if (control?.wrapper?.hidden) continue;
    const value = state.values[field.key];
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) {
      return field;
    }
  }
  return null;
}

function refreshRunState(state) {
  const button = $("#run-tool");
  if (!button) return;
  if (tool.studio) {
    button.disabled = !state.files.length;
    return;
  }
  let ready = true;
  if (tool.allowNoInput) {
    ready = Boolean(state.files.length || String(state.values.url || "").trim());
  } else {
    ready = state.files.length >= (tool.minFiles || 1);
  }
  if (tool.id === "fill-form" && !state.formFields.length) ready = false;
  button.disabled = !ready;
}

function collectOptions(state) {
  const options = {};
  for (const field of state.fields) {
    const value = state.values[field.key];
    if (field.type === "checks") {
      const selected = new Set(Array.isArray(value) ? value : []);
      for (const option of field.options || []) {
        options[option.value] = selected.has(option.value);
      }
      continue;
    }
    if (field.type === "asset") continue;
    if (value === "" || value == null) continue;
    if (Array.isArray(value) && !value.length) continue;
    options[field.key] = value;
  }
  if (tool.id === "fill-form") options.values = state.formValues;
  return options;
}

function showFormError(message) {
  const slot = $("#form-error");
  if (!slot) return;
  slot.innerHTML = "";
  if (!message) return;
  slot.append(h("div", { class: "form-error" }, h("span", { html: icon("warning", 16) }), h("span", { text: message })));
}

async function submitJob(state) {
  if (state.busy) return;
  showFormError("");
  const missing = visibleRequiredMissing(state);
  if (missing) {
    showFormError(`${missing.label} is required.`);
    state.controls[missing.key]?.control?.focus?.();
    return;
  }
  if (tool.allowNoInput) {
    if (!state.files.length && !String(state.values.url || "").trim()) {
      showFormError("Upload an HTML file or enter a web address.");
      return;
    }
  } else if (state.files.length < (tool.minFiles || 1)) {
    showFormError(`Add ${tool.minFiles > 1 ? `at least ${tool.minFiles} files` : "a file"} first.`);
    state.drop?.element?.focus();
    return;
  }
  if (tool.id === "watermark" && state.values.kind === "image" && !state.assets.length) {
    showFormError("Choose a watermark image.");
    return;
  }
  if (tool.id === "fill-form" && !state.formFields.length) {
    showFormError("No fillable fields were found. Try another PDF.");
    return;
  }

  state.busy = true;
  const formArea = $("#tool-form-area");
  const resultArea = $("#tool-result-area");
  formArea.hidden = true;
  const options = collectOptions(state);
  await runToolJob({
    container: resultArea,
    tool,
    files: state.files,
    assets: state.assets,
    options,
    onReset: () => {
      resultArea.innerHTML = "";
      formArea.hidden = false;
      state.busy = false;
      refreshRunState(state);
      formArea.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    onOpenStudio:
      ["edit", "sign", "organize"].includes(tool.id) || tool.visual
        ? () => openStudio(state, tool.studio || tool.visual)
        : null,
  });
  state.busy = false;
}

/* -------------------------------------------------------------------------- */
/* Environment + hand-off                                                     */

async function loadEnvironment(state) {
  try {
    const [inventory, cfg] = await Promise.all([fetchTools(), fetchConfig()]);
    state.configData = cfg;
    const info = (inventory.tools || []).find((t) => t.id === tool.id);
    state.toolInfo = info || null;
    if (info && info.available === false) {
      const banner = $("#tool-unavailable");
      banner.append(
        h(
          "div",
          { class: "tool-unavailable" },
          h("span", { html: icon("warning", 20) }),
          h(
            "div",
            {},
            h("strong", { text: "This tool needs a missing engine." }),
            h("p", { text: info.reason || `The server does not have ${info.engine || "the required engine"} available.` }),
            h("p", { class: "mono", style: "margin-top:4px", text: `TOOL ${tool.id} · ENGINE ${info.engine || "unknown"}` })
          )
        )
      );
      const run = $("#run-tool");
      if (run) run.disabled = true;
    }
    if (tool.id === "ocr" && Array.isArray(cfg.ocrLanguages) && cfg.ocrLanguages.length) {
      const select = state.controls.language?.control;
      if (select && select.tagName === "SELECT") {
        select.innerHTML = "";
        for (const lang of cfg.ocrLanguages) {
          const label = {
            eng: "English",
            osd: "Orientation & script detection",
            deu: "German",
            fra: "French",
            spa: "Spanish",
            ita: "Italian",
            por: "Portuguese",
            nld: "Dutch",
            hin: "Hindi",
            mar: "Marathi",
            jpn: "Japanese",
            kor: "Korean",
            chi_sim: "Chinese (simplified)",
            chi_tra: "Chinese (traditional)",
            ara: "Arabic",
            rus: "Russian",
            tur: "Turkish",
          }[lang] || lang;
          select.append(h("option", { value: lang, text: `${label} (${lang})` }));
        }
        if (cfg.ocrLanguages.includes(state.values.language)) select.value = state.values.language;
        else select.value = cfg.ocrLanguages[0];
        state.values.language = select.value;
      }
    }
  } catch {
    // Availability is advisory; the API will report real errors.
  }
}

async function restoreHandoff(state) {
  try {
    const record = await takeHandoff(params.get("handoff"));
    if (record?.files?.length) {
      state.drop?.setFiles(record.files);
      toast(`Loaded ${record.files.length} file${record.files.length === 1 ? "" : "s"} from the home page`, "success", 3600);
    }
  } catch {
    /* ignore */
  }
}
