import { initLayout } from "./layout.js";
import {
  ACCOUNT_EVENT,
  accountAvatar,
  getAccount,
  safeNext,
  signIn,
  signOut,
} from "./account.js";
import { googleConfigured } from "./google-drive.js";
import { h, toast } from "./ui.js";
import { googleG, icon } from "./icons.js";

initLayout({ title: "Sign in" });

const panel = document.querySelector("#login-panel");
const params = new URLSearchParams(location.search);
let next = safeNext(params.get("next"));
if (/^\/login(?:\.html)?(?:[?#]|$)/.test(next)) next = "";

let state = "signedout";
let error = "";

function scopeItem(text) {
  return h(
    "li",
    {},
    h("span", { class: "login-scope-mark", html: icon("check", 13) }),
    text
  );
}

function unconfiguredView() {
  return h(
    "div",
    { class: "login-body" },
    h("span", { class: "login-state-mark", html: icon("lock", 24) }),
    h("h2", { class: "login-state-title", text: "Google sign-in is not set up here." }),
    h("p", {
      class: "login-state-copy",
      text: "This deployment has no Google client ID, so the account button and Drive controls stay hidden. Every tool still works with local files.",
    }),
    h(
      "div",
      { class: "login-actions" },
      h("a", { class: "btn btn-ink", href: "tools.html" }, "Browse the toolbox")
    ),
    h(
      "p",
      { class: "login-fine" },
      h("a", { class: "login-inline-link", href: "privacy.html" }, "Privacy")
    )
  );
}

function signedOutView() {
  return h(
    "div",
    { class: "login-body" },
    error ? h("p", { class: "login-error", role: "alert", text: error }) : null,
    h(
      "button",
      { class: "btn btn-google btn-lg btn-block", type: "button", onclick: connect },
      h("span", { html: googleG(18) }),
      "Continue with Google"
    ),
    h(
      "ul",
      { class: "login-scope-list" },
      scopeItem("Your name, email and profile photo"),
      scopeItem("PDFs you pick in Google Drive"),
      scopeItem("Files PaperLab saves to your Drive")
    ),
    h("p", {
      class: "login-note",
      text: "No PaperLab account is created. Google returns your name, email, and photo for display only.",
    }),
    h(
      "p",
      { class: "login-fine" },
      "By continuing you agree to Google's terms. ",
      h("a", { class: "login-inline-link", href: "privacy.html" }, "Privacy")
    )
  );
}

function connectingView() {
  return h(
    "div",
    { class: "login-body" },
    h(
      "button",
      { class: "btn btn-google btn-lg btn-block", type: "button", disabled: true },
      h("span", { class: "spinner", "aria-hidden": "true" }),
      "Opening Google…"
    ),
    h("p", {
      class: "login-note",
      text: "Finish choosing your Google account in the popup.",
    })
  );
}

function signedInView(profile) {
  return h(
    "div",
    { class: "login-body" },
    h(
      "div",
      { class: "login-account" },
      accountAvatar(profile, 48),
      h(
        "div",
        { class: "login-account-id" },
        h("strong", { class: "login-account-name", text: profile.name }),
        profile.email ? h("span", { class: "login-account-email", text: profile.email }) : null
      )
    ),
    h(
      "div",
      { class: "login-drive-row" },
      h("span", { class: "login-drive-dot", "aria-hidden": "true" }),
      h(
        "div",
        {},
        h("strong", { text: "Google Drive connected" }),
        h("span", { text: "PDF import and save are ready in every tool." })
      )
    ),
    h(
      "div",
      { class: "login-actions" },
      h(
        "a",
        { class: `btn ${next ? "btn-primary" : "btn-ink"}`, href: next || "tools.html" },
        next ? "Continue" : "Back to tools"
      ),
      h(
        "button",
        {
          class: "btn btn-quiet",
          type: "button",
          onclick: (event) => disconnect(event.currentTarget),
        },
        "Disconnect Google Drive"
      )
    ),
    h("p", {
      class: "login-note",
      text: "Disconnecting revokes the token and clears the cached profile from this tab.",
    })
  );
}

function render() {
  let view;
  if (state === "unconfigured") {
    view = unconfiguredView();
  } else if (state === "connecting") {
    view = connectingView();
  } else if (state === "signedin") {
    const profile = getAccount();
    if (profile) {
      view = signedInView(profile);
    } else {
      state = googleConfigured() ? "signedout" : "unconfigured";
      view = state === "signedout" ? signedOutView() : unconfiguredView();
    }
  } else {
    view = signedOutView();
  }
  panel.replaceChildren(view);
}

async function connect() {
  if (state === "connecting") return;
  state = "connecting";
  error = "";
  render();
  try {
    await signIn();
    state = "signedin";
  } catch (reason) {
    error = reason?.message || "Google sign-in was cancelled.";
    state = "signedout";
  }
  render();
}

async function disconnect(button) {
  button.disabled = true;
  try {
    await signOut();
    toast("Google Drive disconnected.", "success");
    state = googleConfigured() ? "signedout" : "unconfigured";
    error = "";
    render();
  } catch (reason) {
    toast(reason?.message || "Could not disconnect Google Drive.", "error");
    button.disabled = false;
  }
}

state = googleConfigured() ? (getAccount() ? "signedin" : "signedout") : "unconfigured";
render();

window.addEventListener(ACCOUNT_EVENT, () => {
  if (state === "connecting") return;
  state = googleConfigured() ? (getAccount() ? "signedin" : "signedout") : "unconfigured";
  error = "";
  render();
});
