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
 */
window.PAPERLAB_API = window.PAPERLAB_API || "";
