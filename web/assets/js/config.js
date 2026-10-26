/*
 * PaperLab runtime configuration.
 *
 * Same-origin deployment (Gin serves the frontend): leave this empty.
 * Cloudflare Pages frontend + container API: set the public API origin,
 * for example "https://api.paperlab.example".
 *
 * You can also override it at runtime with:
 *   ?api=https://api.example
 * or by setting localStorage.paperlab_api.
 */
window.PAPERLAB_API = window.PAPERLAB_API || "";
