import { money } from "../../core/utils.js";
import { showModal, hideModal, wireGenericModals } from "../../ui/modal.js";
import { getMovements , createMovement, updateMovementApi, deleteMovementApi } from "../../api/movementsApi.js";

let cache = []; // aquí queda la lista con IDs reales

function collectModal() {
  var modal = document.getElementById("new-movement-modal");
  var date = modal.querySelector("#date").value;
  var typeEl = modal.querySelector('input[name="type"]:checked');
  var type = typeEl ? typeEl.value : "ingreso";
  var category = modal.querySelector("#category").value;
  var description = modal.querySelector("#description").value;
  var amount = parseFloat(modal.querySelector("#amount").value || "0");
  return { date, type, category, description, amount, status: "Registrado" };
}

async function renderMovementsTable() {
  var tbody = document.querySelector("main table tbody");
  if (!tbody) return;

  cache = await getMovements ();

  tbody.innerHTML = cache.map(function (r) {
    var typeBadge = r.type === "ingreso"
      ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Ingreso</span>'
      : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Gasto</span>';

    var statusBadge =
      '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">' +
      (r.status || "") + "</span>";

    var actions =
      '<div class="flex items-center gap-2 justify-end">' +
      '<button data-id="' + r.id + '" class="btn-edit text-sm text-primary hover:underline">Editar</button>' +
      '<button data-id="' + r.id + '" class="btn-del text-sm text-red-600 hover:underline">Eliminar</button>' +
      "</div>";

    return (
      '<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">' +
        '<td data-label="Fecha" class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">' + (r.date || "") + "</td>" +
        '<td data-label="Tipo" class="px-6 py-4 whitespace-nowrap text-sm">' + typeBadge + "</td>" +
        '<td data-label="Categoría" class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">' + (r.category || "") + "</td>" +
        '<td data-label="Descripción" class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">' + (r.description || "") + "</td>" +
        '<td data-label="Monto" class="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">' + money(r.amount) + "</td>" +
        '<td data-label="Estado" class="px-6 py-4 whitespace-nowrap text-sm">' + statusBadge + actions + "</td>" +
      "</tr>"
    );
  }).join("");

  tbody.querySelectorAll(".btn-del").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var id = parseInt(btn.getAttribute("data-id"), 10);
      if (!confirm("¿Eliminar movimiento #" + id + "?")) return;
      await deleteMovementApi(id);
      await renderMovementsTable();
    });
  });

  tbody.querySelectorAll(".btn-edit").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = parseInt(btn.getAttribute("data-id"), 10);
      var row = cache.find(function (x) { return x.id === id; });
      if (!row) return alert("Movimiento no encontrado");

      var modal = document.getElementById("new-movement-modal");
      showModal(modal);

      modal.dataset.editingId = String(id);

      modal.querySelector("#date").value = (row.date || "").slice(0, 10);
      modal.querySelector('input[name="type"][value="' + (row.type || "ingreso") + '"]').checked = true;
      modal.querySelector("#category").value = row.category || "";
      modal.querySelector("#description").value = row.description || "";
      modal.querySelector("#amount").value = Math.abs(Number(row.amount || 0));
    });
  });
}

function wireNewMovementButton() {
  var modal = document.getElementById("new-movement-modal");
  if (!modal) return;

  // botón "+ Nuevo movimiento"
  Array.prototype.slice.call(document.querySelectorAll("button")).forEach(function (b) {
    var t = (b.innerText || "").trim().toLowerCase();
    if (!/nuevo movimiento/.test(t)) return;

    b.addEventListener("click", function (e) {
      e.preventDefault();
      try { modal.querySelector("form").reset(); } catch (e) {}
      delete modal.dataset.editingId;
      showModal(modal);
    });
  });

  // ✅ Guardar por submit (más confiable)
  var form = modal.querySelector("form");
  if (!form) return;

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    var payload = collectModal();
    payload.amount = payload.type === "gasto"
      ? -Math.abs(payload.amount)
      : Math.abs(payload.amount);

    var editingId = modal.dataset.editingId ? parseInt(modal.dataset.editingId, 10) : null;

    if (editingId) {
      await updateMovementApi(editingId, payload);
    } else {
      await createMovement(payload);
    }

    hideModal(modal);
    await renderMovementsTable();
  });
}

export function initMovementsPage() {
  wireGenericModals();
  wireNewMovementButton();
  renderMovementsTable();
}