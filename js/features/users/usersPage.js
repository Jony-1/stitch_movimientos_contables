// js/features/users/usersPage.js
"use strict";

// Si todavía NO has migrado users a API, puedes dejarlo funcionando con localStorage.
// Esto evita que app.js truene por falta de export.

function dbRead(DB_KEY) {
  try {
    return JSON.parse(localStorage.getItem(DB_KEY) || "{}");
  } catch {
    return {};
  }
}

function dbWrite(DB_KEY, obj) {
  localStorage.setItem(DB_KEY, JSON.stringify(obj));
}

function getUsers(DB_KEY) {
  return (dbRead(DB_KEY).users || []).slice().sort((a, b) => a.id - b.id);
}

function addUser(DB_KEY, u) {
  const db = dbRead(DB_KEY);
  db.users = db.users || [];
  u.id = (db.users.reduce((m, x) => Math.max(m, x.id || 0), 0) || 0) + 1;
  u.active = typeof u.active === "undefined" ? true : !!u.active;
  u.createdAt = u.createdAt || new Date().toISOString();
  db.users.push(u);
  dbWrite(DB_KEY, db);
  return u;
}

function updateUser(DB_KEY, id, changes) {
  const db = dbRead(DB_KEY);
  db.users = db.users || [];
  const idx = db.users.findIndex((x) => x.id === id);
  if (idx === -1) return null;
  db.users[idx] = Object.assign({}, db.users[idx], changes);
  dbWrite(DB_KEY, db);
  return db.users[idx];
}

function deleteUser(DB_KEY, id) {
  const db = dbRead(DB_KEY);
  db.users = (db.users || []).filter((x) => x.id !== id);
  dbWrite(DB_KEY, db);
}

function getRequests(DB_KEY) {
  return (dbRead(DB_KEY).requests || []).slice().sort((a, b) => b.id - a.id);
}

function addRequest(DB_KEY, r) {
  const db = dbRead(DB_KEY);
  db.requests = db.requests || [];
  r.id = (db.requests.reduce((m, x) => Math.max(m, x.id || 0), 0) || 0) + 1;
  r.status = r.status || "pending";
  r.createdAt = r.createdAt || new Date().toISOString();
  db.requests.push(r);
  dbWrite(DB_KEY, db);
  return r;
}

function updateRequest(DB_KEY, id, changes) {
  const db = dbRead(DB_KEY);
  db.requests = db.requests || [];
  const idx = db.requests.findIndex((x) => x.id === id);
  if (idx === -1) return null;
  db.requests[idx] = Object.assign({}, db.requests[idx], changes);
  dbWrite(DB_KEY, db);
  return db.requests[idx];
}

function ensureAdminRequestIfNoSession(DB_KEY) {
  try {
    const userRaw = sessionStorage.getItem("stitch_user");
    const db = dbRead(DB_KEY);
    db.users = db.users || [];
    db.requests = db.requests || [];

    if (!userRaw && (!db.users || db.users.length === 0)) {
      const exists = (db.requests || []).some(
        (r) => (r.requestedRole || "").toLowerCase() === "admin" && r.status === "pending"
      );
      if (!exists) {
        addRequest(DB_KEY, {
          email: "admin@demo.com",
          name: "Administrador",
          requestedRole: "Admin",
          note: "Solicitud automática: crear admin por defecto",
          system: true,
        });
      }
    }
  } catch (e) {
    console.warn(e);
  }
}

function renderUsers(DB_KEY) {
  const container = document.getElementById("users-table-container");
  if (!container) return;

  const rows = getUsers(DB_KEY);
  if (!rows.length) {
    container.innerHTML =
      '<div class="text-sm text-gray-500">No hay usuarios. Puedes crear uno con "Nuevo Usuario".</div>';
    return;
  }

  const html =
    '<div class="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50">' +
    '<table class="w-full">' +
    '<thead class="bg-gray-50 dark:bg-gray-900">' +
    "<tr>" +
    '<th class="px-4 py-2 text-left text-sm">Nombre</th>' +
    '<th class="px-4 py-2 text-left text-sm">Correo</th>' +
    '<th class="px-4 py-2 text-left text-sm">Rol</th>' +
    '<th class="px-4 py-2 text-left text-sm">Activo</th>' +
    '<th class="px-4 py-2 text-right text-sm">Acciones</th>' +
    "</tr>" +
    "</thead>" +
    '<tbody class="divide-y divide-gray-200 dark:divide-gray-800">' +
    rows
      .map((u) => {
        return (
          '<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">' +
          `<td class="px-4 py-3">${u.name || ""}</td>` +
          `<td class="px-4 py-3">${u.email || ""}</td>` +
          `<td class="px-4 py-3">${u.role || ""}</td>` +
          `<td class="px-4 py-3">${u.active ? "Sí" : "No"}</td>` +
          '<td class="px-4 py-3 text-right">' +
          `<button data-id="${u.id}" class="btn-user-edit text-sm text-primary mr-2">Editar</button>` +
          `<button data-id="${u.id}" class="btn-user-del text-sm text-red-600">Eliminar</button>` +
          "</td>" +
          "</tr>"
        );
      })
      .join("") +
    "</tbody></table></div>";

  container.innerHTML = html;

  container.querySelectorAll(".btn-user-del").forEach((b) => {
    b.addEventListener("click", () => {
      const id = parseInt(b.getAttribute("data-id"), 10);
      if (!confirm("Eliminar usuario #" + id + "?")) return;
      deleteUser(DB_KEY, id);
      renderUsers(DB_KEY);
    });
  });

  // Edit modal (mínimo): por ahora solo alert para no romper
  container.querySelectorAll(".btn-user-edit").forEach((b) => {
    b.addEventListener("click", () => {
      const id = parseInt(b.getAttribute("data-id"), 10);
      const u = getUsers(DB_KEY).find((x) => x.id === id);
      if (!u) return alert("Usuario no encontrado");
      alert("Editar usuario pendiente de migración.\nID: " + u.id);
    });
  });
}

function renderRequests(DB_KEY) {
  const box = document.getElementById("users-requests");
  if (!box) return;

  const reqs = getRequests(DB_KEY).filter((r) => r.status === "pending");
  if (!reqs.length) {
    box.innerHTML = '<div class="text-sm text-gray-500">No hay solicitudes pendientes.</div>';
    return;
  }

  const html =
    '<div class="space-y-3">' +
    reqs
      .map((r) => {
        return (
          '<div class="p-3 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 flex justify-between items-start">' +
          "<div>" +
          `<div class="text-sm font-medium">${r.name || ""} <span class="text-xs text-gray-500">(${r.email ||
            ""})</span></div>` +
          `<div class="text-xs text-gray-500">Rol: ${r.requestedRole || ""} • ${new Date(
            r.createdAt || ""
          ).toLocaleString()}</div>` +
          `<div class="text-sm text-gray-700 mt-2">${r.note || ""}</div>` +
          "</div>" +
          '<div class="flex flex-col gap-2">' +
          `<button data-id="${r.id}" class="btn-req-approve inline-flex items-center px-3 py-1 rounded bg-green-100 text-green-800">Aprobar</button>` +
          `<button data-id="${r.id}" class="btn-req-reject inline-flex items-center px-3 py-1 rounded bg-red-100 text-red-800">Rechazar</button>` +
          "</div>" +
          "</div>"
        );
      })
      .join("") +
    "</div>";

  box.innerHTML = html;

  box.querySelectorAll(".btn-req-approve").forEach((b) => {
    b.addEventListener("click", () => {
      const id = parseInt(b.getAttribute("data-id"), 10);
      const req = getRequests(DB_KEY).find((x) => x.id === id);
      if (!req) return;

      addUser(DB_KEY, {
        name: req.name || req.email,
        email: req.email,
        role: req.requestedRole || "Productor",
        active: true,
      });

      updateRequest(DB_KEY, id, { status: "approved" });
      renderRequests(DB_KEY);
      renderUsers(DB_KEY);
    });
  });

  box.querySelectorAll(".btn-req-reject").forEach((b) => {
    b.addEventListener("click", () => {
      const id = parseInt(b.getAttribute("data-id"), 10);
      if (!confirm("Rechazar solicitud #" + id + "?")) return;
      updateRequest(DB_KEY, id, { status: "rejected" });
      renderRequests(DB_KEY);
    });
  });
}

function initUsersPage() {
  // MISMA KEY que usabas antes
  const DB_KEY = "stitch_db";

  // Solo corre en configuraciones.html
  const file = (window.location.pathname || "").split("/").pop() || "index.html";
  if (!/configuraci/i.test(file)) return;

  ensureAdminRequestIfNoSession(DB_KEY);
  renderUsers(DB_KEY);
  renderRequests(DB_KEY);
}

export { initUsersPage, ensureAdminRequestIfNoSession };