"use strict";

const crypto = require("crypto");

function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  return req.session.csrfToken;
}

function isUnsafeMethod(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(String(method || "").toUpperCase());
}

function getCsrfHeader(req) {
  return req.get("x-csrf-token") || req.get("x-xsrf-token") || "";
}

function isCsrfProtectedPath(req) {
  if (
    req.path === "/api/login" ||
    req.path === "/api/register" ||
    req.path === "/api/logout" ||
    req.path === "/api/csrf"
  ) {
    return false;
  }
  return req.path.startsWith("/api/") || req.path === "/login" || req.path === "/logout";
}

function requireCsrf(req, res, next) {
  if (!isUnsafeMethod(req.method) || !isCsrfProtectedPath(req)) return next();
  const token = getCsrfToken(req);
  const header = getCsrfHeader(req);
  if (!header || header !== token) {
    return res.status(403).json({ error: "Token CSRF inválido" });
  }
  return next();
}

function attachSecurityHeaders(app, isProduction) {
  app.disable("x-powered-by");
  if (isProduction) app.set("trust proxy", 1);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  });
}

function attachCsrfContext(req, res, next) {
  if (req.session) {
    res.locals.csrfToken = getCsrfToken(req);
  }
  next();
}

function ensureAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect("/login");
}

function ensureGuest(req, res, next) {
  if (req.session && req.session.user) return res.redirect("/dashboard");
  return next();
}

function ensureAdmin(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  if (String(req.session.user.role || "").toLowerCase() !== "admin") {
    return res.status(403).send("Permiso denegado");
  }
  return next();
}

function ensureApiAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: "no autenticado" });
}

function ensureAdminApi(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "no autenticado" });
  }
  if (String(req.session.user.role || "").toLowerCase() !== "admin") {
    return res.status(403).json({ error: "Permiso denegado" });
  }
  return next();
}

module.exports = {
  attachSecurityHeaders,
  attachCsrfContext,
  ensureAdmin,
  ensureAdminApi,
  ensureApiAuth,
  ensureAuth,
  ensureGuest,
  getCsrfToken,
  requireCsrf,
};
