/*
 * PaperLab runtime configuration.
 *
 * Same-origin setup (Gin serves the frontend): leave this empty.
 * Separate frontend and API hosts: set the public API origin,
 * for example "https://api.example.com".
 *
 * You can also override it at runtime with:
 *   ?api=https://api.example
 * or by setting localStorage.paperlab_api.
 *
 * Google Drive is optional. Fill these public identifiers to enable it;
 * leave the client ID empty to hide every Drive affordance.
 */
if (typeof window !== "undefined") {
  window.PAPERLAB_API = window.PAPERLAB_API || "";
  window.PAPERLAB_GOOGLE = window.PAPERLAB_GOOGLE || {
    clientId: "",
    apiKey: "",
    appId: "",
  };
}
