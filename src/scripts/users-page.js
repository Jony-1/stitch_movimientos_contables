import { apiFetch, apiJson } from "./api.js";
import { protectPage } from "./auth.js";

function getUserFormElements() {
  return {
    name: document.getElementById("user-name"),
    email: document.getElementById("user-email"),
    password: document.getElementById("user-password"),
    role: document.getElementById("user-role"),
    active: document.getElementById("user-active"),
  };
}

function setPasswordState(required, placeholder = "") {
  const { password } = getUserFormElements();
  if (!password) return;
  password.required = required;
  password.placeholder = placeholder;
  if (required) password.value = password.value || "";
}

function resetUserForm(form) {
  if (!form) return;
  form.reset();
  const { active, role } = getUserFormElements();
  if (active) active.checked = true;
  if (role) role.value = "manager";
  setPasswordState(true, "");
}

async function renderUsers(container, currentUser) {
  const status = document.getElementById("users-status");
  if (status) status.textContent = "Cargando miembros...";
    container.innerHTML = `<div class="surface-card p-6 text-sm text-slate-500 dark:text-slate-400">Cargando miembros...</div>`;

  try {
    const rawRows = await apiJson("/api/users");
    const rows = Array.isArray(rawRows) ? rawRows : [];
    container.innerHTML = (rows?.length ?? 0)
    ? `
      <div class="surface-card overflow-hidden">
        <div class="overflow-x-auto">
        <table class="w-full min-w-[640px]">
          <thead class="bg-slate-50 dark:bg-slate-900">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">Nombre</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">Correo</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">Rol</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">Estado</th>
              <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
            ${rows
              .map(
                (u) => `
                  <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td data-label="Nombre" class="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">${u.name || ""}</td>
                    <td data-label="Correo" class="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">${u.email || ""}</td>
                    <td data-label="Rol" class="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">${u.role || u.organizationRole || ""}</td>
                    <td data-label="Estado" class="px-4 py-3 text-sm">
                      <span class="inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-xs font-semibold ${u.active ?"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-gray-100 text-slate-700 dark:bg-gray-800 dark:text-gray-300"}">
                        <span class="size-2 rounded-full ${u.active ?"bg-emerald-500" : "bg-gray-400"}"></span>
                        ${u.active ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td data-label="Acciones" class="px-4 py-3 text-right">
                      <button data-id="${u.id}" class="btn-user-edit mr-3 text-sm font-semibold text-primary hover:underline">Editar</button>
                      <button data-id="${u.id}" class="btn-user-del text-sm font-semibold text-red-600 hover:underline">Eliminar</button>
                    </td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
        </div>
      </div>`
    : `<div class="surface-card p-6 text-sm text-slate-500 dark:text-slate-400">No hay miembros en esta empresa.</div>`;

    if (status) status.textContent = (rows?.length ?? 0) ? `${rows?.length ?? 0} miembro(s) cargado(s).` : "No hay miembros registrados en esta empresa.";

    container.querySelectorAll(".btn-user-edit").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = Number(button.dataset.id);
        const u = rows.find((x) => x.id === id);
        if (!u) return;
        const modal = document.getElementById("modal-user");
        const form = document.getElementById("form-user");
        if (!modal || !form) return;
        modal.dataset.editingId = String(id);
        const heading = modal.querySelector("h2, h3");
        if (heading) heading.textContent = "Editar miembro";
        const { name, email, role, active } = getUserFormElements();
        if (name) name.value = u.name || "";
        if (email) email.value = u.email || "";
        if (role) role.value = u.organizationRole || (String(u.role || "").toLowerCase() === "admin" ? "owner" : String(u.role || "").toLowerCase() === "contador" ? "accountant" : "manager");
        if (active) active.checked = !!u.active;
        const { password } = getUserFormElements();
        if (password) password.value = "";
        setPasswordState(false, "Dejar vacío para mantener");
        modal.classList.remove("opacity-0", "pointer-events-none");
        modal.classList.add("opacity-100", "pointer-events-auto");
      });
    });

    container.querySelectorAll(".btn-user-del").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!confirm("Quitar miembro de la empresa activa?")) return;
        await apiFetch(`/api/users/${button.dataset.id}`, { method: "DELETE" });
        if (currentUser && Number(button.dataset.id) === currentUser.id) {
          window.location.href = "/login";
          return;
        }
        await renderUsers(container, currentUser);
      });
    });
  } catch (error) {
    container.innerHTML = `<div class="surface-card p-6 text-sm text-red-600">${error.message || "No se pudieron cargar los miembros."}</div>`;
    if (status) status.textContent = error.message || "No se pudieron cargar los miembros.";
  }
}

async function initUsersPage() {
  const currentUser = await protectPage({ requiredRole: "admin" });
  if (!currentUser) return;

  const file = (window.location.pathname || "").split("/").pop() || "";
  if (!/usuari|configuraci/i.test(file)) return;

  const container = document.getElementById("users-table-container") || document.getElementById("users-tbody")?.parentElement;
  const form = document.getElementById("form-user");
  const modal = document.getElementById("modal-user");
  const openBtn = document.getElementById("btn-open-user-modal") || document.getElementById("btn-new-user");
  const closeBtn = document.getElementById("btn-close-user-modal") || document.getElementById("btn-cancel-user") || document.getElementById("user-cancel");
  const formStatus = document.getElementById("user-form-status");
  const submitBtn = document.getElementById("user-submit") || document.getElementById("user-save");
  if (!container || !form || !modal || !openBtn || !closeBtn) return;

  const openModal = () => {
    resetUserForm(form);
    modal.classList.remove("opacity-0", "pointer-events-none");
    modal.classList.add("opacity-100", "pointer-events-auto");
    const heading = modal.querySelector("h2, h3");
    if (heading) heading.textContent = "Crear miembro";
    if (formStatus) formStatus.textContent = "";
    delete modal.dataset.editingId;
  };

  const closeModal = () => {
    modal.classList.add("opacity-0", "pointer-events-none");
    modal.classList.remove("opacity-100", "pointer-events-auto");
    resetUserForm(form);
    delete modal.dataset.editingId;
    if (formStatus) formStatus.textContent = "";
  };

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const editingId = modal.dataset.editingId ? Number(modal.dataset.editingId) : null;
    const { name, email, password, role, active } = getUserFormElements();
    const payload = {
      name: name?.value || "",
      email: email?.value || "",
      role: role?.value || "manager",
      active: !!active?.checked,
    };

    const passwordValue = password?.value || "";
    if (!editingId || passwordValue) payload.password = passwordValue;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add("opacity-70");
    }
    if (formStatus) formStatus.textContent = editingId ? "Actualizando miembro..." : "Guardando miembro...";

    try {
      await apiFetch(editingId ? `/api/users/${editingId}` : "/api/users", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeModal();
      delete modal.dataset.editingId;
      if (editingId && editingId === currentUser.id) {
        window.location.reload();
        return;
      }
      await renderUsers(container, currentUser);
    } catch (error) {
      if (formStatus) formStatus.textContent = error.message || "No se pudo guardar.";
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove("opacity-70");
      }
    }
  });

  await renderUsers(container, currentUser);
}

export { initUsersPage };
