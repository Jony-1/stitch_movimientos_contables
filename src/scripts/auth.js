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

function isReadOnlyRole(user) {
  return String(user?.role || "").toLowerCase() === "contador";
}

function canWriteAccounting(user) {
  return !isReadOnlyRole(user);
}

function getHomeRoute(user) {
  return isReadOnlyRole(user) ? "/reportes" : "/dashboard";
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
  const activeOrganizationLabel = document.querySelector("[data-active-organization-name]");
  const sidebarOrganizationLabel = document.querySelector("[data-sidebar-organization]");
  const organizationSelect = document.querySelector("[data-organization-select]");

  if (name && user.name) name.textContent = user.name;
  if (role && (user.displayRole || user.role)) role.textContent = user.displayRole || user.role;
  if (email && user.email) email.textContent = user.email;
  const activeOrganizationName = user.activeOrganization?.name || "Sin empresa activa";
  if (activeOrganizationLabel) activeOrganizationLabel.textContent = activeOrganizationName;
  if (sidebarOrganizationLabel) sidebarOrganizationLabel.textContent = activeOrganizationName;

  if (organizationSelect) {
    const organizations = Array.isArray(user.organizations) ? user.organizations : [];
    organizationSelect.innerHTML = organizations.length
      ? organizations.map((organization) => `<option value="${organization.id}">${organization.name}</option>`).join("")
      : '<option value="">Sin empresas</option>';
    organizationSelect.value = String(user.activeOrganizationId || "");

    if (!organizationSelect.dataset.bound) {
      organizationSelect.addEventListener("change", async () => {
        const organizationId = organizationSelect.value;
        if (!organizationId) return;
        try {
          await apiFetch("/api/session/active-organization", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ organizationId }),
          });
          window.location.reload();
        } catch (_) {
          organizationSelect.value = String(user.activeOrganizationId || "");
        }
      });
      organizationSelect.dataset.bound = "true";
    }
  }
}

function syncRoleVisibility(user) {
  const adminOnlyNodes = document.querySelectorAll("[data-admin-only]");
  adminOnlyNodes.forEach((node) => {
    node.classList.toggle("hidden", String(user?.role || "").toLowerCase() !== "admin");
  });
}

async function protectPage(options = {}) {
  const user = await requireAuth();
  if (!user) return null;

  if (!hasRequiredRole(user, options.requiredRole)) {
    window.location.href = "/dashboard";
    return null;
  }

  if (user) populateHeader(user);
  syncRoleVisibility(user);
  wireLogoutLinks();
  return user;
}

async function initAuthPage() {
  const user = await getCurrentUser();
  if (user) {
    window.location.href = getHomeRoute(user);
    return user;
  }
  return null;
}

function resetCsrfTokenCache() {
  resetApiCsrfTokenCache();
}

export { canWriteAccounting, getCurrentUser, getHomeRoute, initAuthPage, protectPage, wireLogoutLinks, resetCsrfTokenCache };
