// js/features/users/usersPage.js
"use strict";

// Utiliza la API REST para gestionar usuarios en lugar de localStorage
async function getUsers() {
  const res = await fetch("/api/users");
  if (!res.ok) throw new Error("failed to fetch users");
  return res.json();
}

async function addUser(u) {
  const res = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(u),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => {});
    throw new Error(err && err.error ? err.error : "error creating user");
  }
  return res.json();
}

async function updateUser(id, changes) {
  const res = await fetch(`/api/users/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => {});
    throw new Error(err && err.error ? err.error : "error updating user");
  }
  return res.json();
}

async function deleteUser(id) {
  const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => {});
    throw new Error(err && err.error ? err.error : "error deleting user");
  }
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

async function renderUsers() {
  const container = document.getElementById("users-table-container");
  if (!container) return;

  let rows = [];
  try {
    rows = await getUsers();
  } catch (e) {
    container.innerHTML = `<div class="text-sm text-red-600">Error cargando usuarios: ${e.message}</div>`;
    return;
  }

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
    b.addEventListener("click", async () => {
      const id = parseInt(b.getAttribute("data-id"), 10);
      if (!confirm("Eliminar usuario #" + id + "?")) return;
      try {
        await deleteUser(id);
        await renderUsers();
      } catch (e) {
        alert("Error: " + e.message);
      }
    });
  });

  container.querySelectorAll(".btn-user-edit").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = parseInt(b.getAttribute("data-id"), 10);
      let u;
      try {
        const all = await getUsers();
        u = all.find((x) => x.id === id);
      } catch {
        return alert("Error al obtener usuario");
      }
      if (!u) return alert("Usuario no encontrado");
      alert("Editar usuario pendiente de migración.\nID: " + u.id);
    });
  });
}

// por ahora no gestionamos solicitudes desde el servidor, así que dejamos los helpers en silencio
function renderRequests() {
  // esta app ya no usa solicitudes automáticas
}

function initUsersPage() {
  // solo actúa en la página de usuarios o configuraciones
  const file = (window.location.pathname || "").split("/").pop() || "index.html";
  if (!/usuari|configuraci/i.test(file)) return;

  // renderizamos lista actual
  renderUsers().catch((e) => console.error(e));

  // formulario de creación/edición
  const form = document.getElementById("form-user");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const u = {
        name: document.getElementById("user-name").value,
        email: document.getElementById("user-email").value,
        role: document.getElementById("user-role").value,
        active: document.getElementById("user-active").checked,
      };
      try {
        await addUser(u);
        // cerrar modal si existe
        const modal = document.getElementById("modal-user");
        if (modal) modal.classList.add("opacity-0", "pointer-events-none");
        await renderUsers();
      } catch (err) {
        alert("Error creando usuario: " + err.message);
      }
    });
  }
}

export { initUsersPage };