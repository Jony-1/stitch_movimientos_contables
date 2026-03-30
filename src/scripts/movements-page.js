import { apiJson, apiFetch, formatDate, formatMoney } from "./api.js";
import { canWriteAccounting, protectPage } from "./auth.js";

function getFormValues(form) {
  return {
    date: form.querySelector("#date").value ? new Date(form.querySelector("#date").value).toISOString() : null,
    type: form.querySelector('input[name="type"]:checked')?.value || "ingreso",
    category: form.querySelector("#category").value || null,
    description: form.querySelector("#description").value || null,
    amount: Math.abs(Number(form.querySelector("#amount").value || 0)),
    status: "Registrado",
  };
}

function getAmountClass(type) {
  return String(type || "").toLowerCase() === "ingreso" ? "text-emerald-600" : "text-rose-600";
}

function getAmountLabel(type) {
  return String(type || "").toLowerCase() === "ingreso" ? "Ingreso" : "Gasto";
}

async function initMovementsPage() {
  const user = await protectPage();
  if (!user) return;
  const writable = canWriteAccounting(user);

  const modal = document.getElementById("new-movement-modal");
  const tbody = document.getElementById("movements-tbody");
  const newBtn = document.getElementById("btn-new-movement");
  const form = document.getElementById("movement-form");
  const status = document.getElementById("movements-status");
  const formStatus = document.getElementById("movement-form-status");
  const submitBtn = document.getElementById("movement-submit");
  const filterButtons = Array.from(document.querySelectorAll("[data-movement-filter]"));
  const totalCountEl = document.getElementById("movements-total-count");
  const incomeTotalEl = document.getElementById("movements-income-total");
  const expenseTotalEl = document.getElementById("movements-expense-total");
  const balanceEl = document.getElementById("movements-balance");
  if (!modal || !tbody || !newBtn || !form) return;
  if (!writable) {
    newBtn.disabled = true;
    newBtn.classList.add("cursor-not-allowed", "opacity-60");
    newBtn.title = "Solo lectura para este perfil";
  }

  let editingId = null;
  let currentFilter = "all";
  let cachedRows = [];

  function openModal() {
    modal.classList.remove("opacity-0", "pointer-events-none");
    modal.querySelector("div.max-w-lg")?.classList.remove("scale-95");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    modal.classList.add("opacity-0", "pointer-events-none");
    modal.querySelector("div.max-w-lg")?.classList.add("scale-95");
    modal.setAttribute("aria-hidden", "true");
  }

  function resetForm() {
    editingId = null;
    form.reset();
    form.querySelector('input[name="type"][value="ingreso"]').checked = true;
    if (formStatus) formStatus.textContent = "";
  }

  function setBusy(busy, message) {
    if (submitBtn) {
      submitBtn.disabled = busy;
      submitBtn.classList.toggle("opacity-70", busy);
    }
    if (formStatus && typeof message !== "undefined") formStatus.textContent = message || "";
  }

  function renderLoading() {
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">Cargando movimientos...</td></tr>`;
    if (status) status.textContent = "Cargando movimientos recientes...";
  }

  function renderEmpty() {
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">No hay movimientos todavía. Crea el primero con \"Nuevo movimiento\".</td></tr>`;
    if (status) status.textContent = "No hay movimientos registrados.";
  }

  function renderError(message) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-10 text-center text-sm text-red-600">${message}</td></tr>`;
    if (status) status.textContent = message;
  }

  function renderSummary(summary) {
    if (totalCountEl) totalCountEl.textContent = String(summary.totalCount || 0);
    if (incomeTotalEl) incomeTotalEl.textContent = formatMoney(summary.incomeTotal || 0);
    if (expenseTotalEl) expenseTotalEl.textContent = formatMoney(summary.expenseTotal || 0);
    if (balanceEl) balanceEl.textContent = formatMoney(summary.balance || 0);
  }

  function getVisibleRows(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (currentFilter === "all") return safeRows;
    return safeRows.filter((row) => String(row.type || "").toLowerCase() === currentFilter);
  }

  function renderRows(rows) {
    const visibleRows = getVisibleRows(rows) || [];
    if (!(visibleRows?.length ?? 0)) {
      renderEmpty();
      if (status) {
        status.textContent = currentFilter === "all"
          ? "No hay movimientos registrados."
          : `No hay movimientos de tipo ${currentFilter}.`;
      }
      return;
    }

    tbody.innerHTML = visibleRows.map((m) => `
      <tr>
        <td class="px-4 py-4 text-sm text-slate-600">${formatDate(m.date)}</td>
        <td class="px-4 py-4 text-sm">${getAmountLabel(m.type)}</td>
        <td class="px-4 py-4 text-sm text-slate-700">${m.category || ""}</td>
        <td class="px-4 py-4 text-sm text-slate-700">${m.description || ""}</td>
        <td class="px-4 py-4 text-sm font-semibold text-right ${getAmountClass(m.type)}">${formatMoney(m.amount)}</td>
        <td class="px-4 py-4 text-sm">
          <div class="flex flex-col gap-1 items-start">
            <span class="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">${m.status || "Registrado"}</span>
            ${writable ? `<div class="flex gap-4"><button class="text-blue-600 hover:underline js-edit" data-id="${m.id}">Editar</button><button class="text-red-600 hover:underline js-delete" data-id="${m.id}">Eliminar</button></div>` : `<span class="text-xs text-slate-500 dark:text-slate-400">Solo lectura</span>`}
          </div>
        </td>
      </tr>`).join("");

    if (status) status.textContent = `${visibleRows?.length ?? 0} movimiento(s) cargado(s).`;

    tbody.querySelectorAll(".js-edit").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const item = await apiJson(`/api/movements/${button.dataset.id}`);
          editingId = item.id;
          form.querySelector("#date").value = item.date ? new Date(item.date).toISOString().slice(0, 10) : "";
          form.querySelector("#category").value = item.category || "";
          form.querySelector("#description").value = item.description || "";
          form.querySelector("#amount").value = Math.abs(Number(item.amount || 0)) || "";
          form.querySelector(`input[name="type"][value="${String(item.type || "ingreso").toLowerCase()}"]`).checked = true;
          openModal();
        } catch (error) {
          if (status) status.textContent = error.message || "No se pudo cargar el movimiento.";
        }
      });
    });

    tbody.querySelectorAll(".js-delete").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!confirm("¿Seguro que deseas eliminar este movimiento?")) return;
        try {
          await apiFetch(`/api/movements/${button.dataset.id}`, { method: "DELETE" });
          await reloadData();
        } catch (error) {
          if (status) status.textContent = error.message || "No se pudo eliminar el movimiento.";
        }
      });
    });
  }

  async function loadSummary() {
    try {
      const summary = await apiJson("/api/movements/summary");
      renderSummary(summary);
    } catch (error) {
      if (status) status.textContent = error.message || "No se pudo cargar el resumen.";
    }
  }

  async function loadTable() {
    renderLoading();
    try {
      cachedRows = await apiJson("/api/movements");
      renderRows(cachedRows);
    } catch (error) {
      renderError(error.message || "No se pudieron cargar los movimientos.");
    }
  }

  async function reloadData() {
    await Promise.all([loadSummary(), loadTable()]);
  }
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.movementFilter || "all";
      filterButtons.forEach((btn) => {
        const active = btn === button;
        btn.classList.toggle("bg-white", active);
        btn.classList.toggle("shadow-sm", active);
        btn.classList.toggle("dark:bg-slate-700", active);
        btn.classList.toggle("text-slate-900", active);
      });
      renderRows(cachedRows);
    });
  });

  newBtn.addEventListener("click", () => {
    if (!writable) {
      if (status) status.textContent = "Tu perfil es solo lectura.";
      return;
    }
    resetForm();
    openModal();
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-modal-close]")) closeModal();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!writable) return;
    const payload = getFormValues(form);
    if (!payload.amount || payload.amount <= 0) {
      if (formStatus) formStatus.textContent = "Ingresa un monto mayor que cero.";
      return;
    }
    setBusy(true, editingId ? "Actualizando movimiento..." : "Guardando movimiento...");
    try {
      await apiFetch(editingId ? `/api/movements/${editingId}` : "/api/movements", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeModal();
      resetForm();
      await reloadData();
    } catch (error) {
      if (formStatus) formStatus.textContent = error.message || "No se pudo guardar.";
    } finally {
      setBusy(false);
    }
  });

  await reloadData();
}

export { initMovementsPage };
