"use strict";
// Standard browser protections, shared by the real server and the test server.
// The app uses inline scripts and styles, so those stay allowed; everything else is limited to this site (and Google Fonts).
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
function securityHeaders(req, res, next) {
  const h = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": CSP,
  };
  const get = (n) => (req.get ? req.get(n) : req.headers[n.toLowerCase()]);
  if (get("x-forwarded-proto") === "https") h["Strict-Transport-Security"] = "max-age=15552000";
  if ((req.path || req.url || "").startsWith("/api")) h["Cache-Control"] = "no-store";
  for (const k of Object.keys(h)) res.setHeader(k, h[k]);
  next();
}
module.exports = { securityHeaders, CSP };
