import { apiFetch, apiJson, resetCsrfTokenCache as resetApiCsrfTokenCache } from "./api.js";

async function getCurrentUser() {
  try {
    const data = await apiJson("/api/me");
    if (!data) return null;
    if (data.authenticated === false) return null;
    return data.user || data;
  } catch (_) {
    return null;
  }
}

async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "/login";
    return null;
  }
  return user;
}

function hasRequiredRole(user, requiredRole) {
  if (!requiredRole) return true;
  return String(user?.role || "").toLowerCase() === String(requiredRole).toLowerCase();
}

function wireLogoutLinks() {
  document.querySelectorAll("[data-logout-link]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        await apiFetch("/api/logout", { method: "POST" });
      } catch (_) {}
      resetCsrfTokenCache();
      window.location.href = "/login";
    });
  });
}

function populateHeader(user) {
  if (!user) return;
  const name = document.querySelector(".app-header-name p:first-child");
  const role = document.querySelector(".app-header-name p:last-child");
  const email = document.querySelector(".app-header-email");

  if (name && user.name) name.textContent = user.name;
  if (role && user.role) role.textContent = user.role;
  if (email && user.email) email.textContent = user.email;
}

async function protectPage(options = {}) {
  const user = await requireAuth();
  if (!user) return null;

  if (!hasRequiredRole(user, options.requiredRole)) {
    window.location.href = "/dashboard";
    return null;
  }

  if (user) populateHeader(user);
  wireLogoutLinks();
  return user;
}

async function initAuthPage() {
  const user = await getCurrentUser();
  if (user) {
    window.location.href = "/dashboard";
    return user;
  }
  return null;
}

function resetCsrfTokenCache() {
  resetApiCsrfTokenCache();
}

export { getCurrentUser, initAuthPage, protectPage, wireLogoutLinks, resetCsrfTokenCache };
