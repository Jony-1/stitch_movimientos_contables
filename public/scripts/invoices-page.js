import { apiFetch, apiJson, formatDate, formatMoney } from "./api.js";
import { protectPage } from "./auth.js";

const INVOICE_STATUS_META = {
  pending: {
    label: "Pendiente",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    dotClass: "bg-amber-500",
  },
  pagada: {
    label: "Pagada",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    dotClass: "bg-emerald-500",
  },
  vencida: {
    label: "Vencida",
    className: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
    dotClass: "bg-rose-500",
  },
};

function invoicePayload(modal) {
  const items = readInvoiceItems(modal);
  const amount = syncInvoiceItems(modal);
  return {
    number: modal.querySelector("#inv-number").value || "",
    party: modal.querySelector("#inv-party").value || "",
    date: modal.querySelector("#inv-date").value || null,
    dueDate: modal.querySelector("#inv-due").value || null,
    amount,
    status: modal.querySelector("#inv-status").value || "pending",
    items,
  };
}

function normalizeInvoiceStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "pagada" || normalized === "paid") return "pagada";
  if (normalized === "vencida" || normalized === "vencido" || normalized === "overdue") return "vencida";
  return "pending";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getStatusMeta(value) {
  return INVOICE_STATUS_META[normalizeInvoiceStatus(value)] || INVOICE_STATUS_META.pending;
}

function renderStatusBadge(value) {
  const meta = getStatusMeta(value);
  return `<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.className}"><span class="size-2 rounded-full ${meta.dotClass}"></span>${meta.label}</span>`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function setText(root, selector, value) {
  const node = root?.querySelector(selector);
  if (node) node.textContent = value;
}

function setHtml(root, selector, value) {
  const node = root?.querySelector(selector);
  if (node) node.innerHTML = value;
}

function setModalTitle(modal, value) {
  setText(modal, "#invoice-modal-title", value);
}

function getPrintableStatusLabel(value) {
  return getStatusMeta(value).label;
}

function buildInvoicePrintHtml(inv) {
  const items = safeArray(inv?.items);
  const rows = (items?.length ?? 0)
    ? items.map((item) => `
      <tr>
        <td>${escapeHtml(item.description)}</td>
        <td class="text-right">${escapeHtml(String(item.quantity ?? 0))}</td>
        <td class="text-right">${escapeHtml(formatMoney(item.unitPrice))}</td>
        <td class="text-right">${escapeHtml(formatMoney(item.lineTotal ?? Number(item.quantity || 0) * Number(item.unitPrice || 0)))}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="4" class="empty">Sin ítems registrados.</td></tr>`;

  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Factura ${escapeHtml(inv?.number || "")}</title>
      <style>
        :root { color-scheme: light; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 32px; color: #0f172a; }
        .sheet { max-width: 860px; margin: 0 auto; }
        .top { display: flex; justify-content: space-between; gap: 24px; align-items: start; margin-bottom: 28px; }
        h1 { margin: 0 0 8px; font-size: 30px; }
        .muted { color: #64748b; font-size: 13px; }
        .badge { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #f1f5f9; font-size: 12px; font-weight: 700; }
        .card { border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; margin-bottom: 18px; }
        .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; }
        .label { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .14em; margin-bottom: 4px; }
        .value { font-size: 14px; font-weight: 600; }
        table { width: 100%; border-collapse: collapse; }
        thead th { text-align: left; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0; padding: 12px 10px; }
        tbody td { border-bottom: 1px solid #e2e8f0; padding: 12px 10px; font-size: 14px; }
        tbody tr:last-child td { border-bottom: none; }
        .text-right { text-align: right; }
        .summary { margin-top: 16px; display: flex; justify-content: end; }
        .summary-box { min-width: 280px; border: 1px solid #cbd5e1; border-radius: 14px; padding: 14px 16px; display: grid; gap: 6px; }
        .summary-line { display: flex; justify-content: space-between; gap: 16px; font-size: 14px; }
        .summary-line strong { font-size: 16px; }
        .empty { text-align: center; color: #64748b; padding: 18px 10px; }
        @media print { body { padding: 0; } .sheet { max-width: none; } }
      </style>
    </head>
    <body>
      <div class="sheet">
        <div class="top">
          <div>
            <h1>Factura ${escapeHtml(inv?.number || "")}</h1>
            <div class="muted">${escapeHtml(inv?.party || "")}</div>
          </div>
          <div class="badge">${escapeHtml(getPrintableStatusLabel(inv?.status))}</div>
        </div>

        <div class="card">
          <div class="grid">
            <div><div class="label">Fecha de emisión</div><div class="value">${escapeHtml(formatDate(inv?.date) || "—")}</div></div>
            <div><div class="label">Vencimiento</div><div class="value">${escapeHtml(formatDate(inv?.dueDate) || "—")}</div></div>
            <div><div class="label">Número interno</div><div class="value">#${escapeHtml(String(inv?.id || ""))}</div></div>
            <div><div class="label">Total</div><div class="value">${escapeHtml(formatMoney(inv?.amount))}</div></div>
          </div>
        </div>

        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Descripción</th>
                <th class="text-right">Cantidad</th>
                <th class="text-right">Precio</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        <div class="summary">
          <div class="summary-box">
            <div class="summary-line"><span>Subtotal</span><strong>${escapeHtml(formatMoney(inv?.amount))}</strong></div>
            <div class="summary-line"><span>Estado</span><strong>${escapeHtml(getPrintableStatusLabel(inv?.status))}</strong></div>
          </div>
        </div>
      </div>
      <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };</script>
    </body>
  </html>`;
}

function openInvoicePrintPreview(inv) {
  if (!inv) return;
  const preview = window.open("", "_blank", "noopener,noreferrer,width=1100,height=900");
  if (!preview) {
    alert("No se pudo abrir la vista de impresión.");
    return;
  }
  preview.document.open();
  preview.document.write(buildInvoicePrintHtml(inv));
  preview.document.close();
}

function toInputDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function createInvoiceItemRow(item = {}) {
  const row = document.createElement("div");
  row.dataset.invoiceItemRow = "true";
  row.className = "grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40 md:grid-cols-[minmax(0,2fr)_120px_140px_120px_auto] md:items-end";
  row.innerHTML = `
    <label class="flex flex-col gap-1">
      <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Descripción</span>
      <input data-item-field="description" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white" placeholder="Papa pastusa, transporte..." value="${escapeHtml(item.description || "")}">
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Cantidad</span>
      <input data-item-field="quantity" type="number" min="0" step="0.01" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white" value="${escapeHtml(String(item.quantity ?? 1))}">
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Precio unit.</span>
      <input data-item-field="unitPrice" type="number" min="0" step="0.01" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white" value="${escapeHtml(String(item.unitPrice ?? 0))}">
    </label>
    <div class="flex flex-col gap-1">
      <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Total</span>
      <p data-item-total class="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">${formatMoney(Number(item.quantity ?? 1) * Number(item.unitPrice ?? 0))}</p>
    </div>
    <button type="button" data-remove-item class="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-rose-950/40 dark:hover:text-rose-300" aria-label="Eliminar ítem">
      <span class="material-symbols-outlined text-base">delete</span>
    </button>
  `;
  return row;
}

function readInvoiceItems(modal) {
  return Array.from(modal.querySelectorAll("[data-invoice-item-row]")).map((row) => {
    const description = row.querySelector('[data-item-field="description"]').value || "";
    const quantity = Number(row.querySelector('[data-item-field="quantity"]').value || 0);
    const unitPrice = Number(row.querySelector('[data-item-field="unitPrice"]').value || 0);
    return {
      description: description.trim(),
      quantity,
      unitPrice,
    };
  });
}

function syncInvoiceItems(modal) {
  const rows = Array.from(modal.querySelectorAll("[data-invoice-item-row]"));
  let total = 0;

  rows.forEach((row) => {
    const quantity = Number(row.querySelector('[data-item-field="quantity"]').value || 0);
    const unitPrice = Number(row.querySelector('[data-item-field="unitPrice"]').value || 0);
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    const safeUnitPrice = Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 0;
    const lineTotal = Number((safeQuantity * safeUnitPrice).toFixed(2));
    const lineTotalNode = row.querySelector("[data-item-total]");
    if (lineTotalNode) lineTotalNode.textContent = formatMoney(lineTotal);
    total += lineTotal;
  });

  const totalNode = modal.querySelector("#invoice-total-preview");
  if (totalNode) totalNode.textContent = formatMoney(total);

  const amountInput = modal.querySelector("#inv-amount");
  if (amountInput) amountInput.value = total.toFixed(2);

  return total;
}

function ensureInvoiceItemRow(modal, item = {}) {
  const container = modal.querySelector("#invoice-items-list");
  if (!container) return;
  container.appendChild(createInvoiceItemRow(item));
  syncInvoiceItems(modal);
}

function renderInvoiceItemsDetail(inv) {
  const tbody = document.getElementById("invoice-items-tbody");
  const empty = document.getElementById("invoice-items-empty");
  const count = document.getElementById("invoice-items-count");
  if (!tbody || !empty || !count) return;

  const items = safeArray(inv?.items);

  count.textContent = `${items?.length ?? 0} ítem(s)`;

  if (!(items?.length ?? 0)) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");
    empty.textContent = "Esta factura todavía no tiene ítems guardados.";
    return;
  }

  empty.classList.add("hidden");
  tbody.innerHTML = items.map((item) => `
    <tr class="border-t border-slate-200 dark:border-slate-800">
      <td class="py-2 pr-3 text-slate-700 dark:text-slate-200">${escapeHtml(item.description)}</td>
      <td class="py-2 pr-3 text-right text-slate-600 dark:text-slate-400">${escapeHtml(String(item.quantity ?? 0))}</td>
      <td class="py-2 pr-3 text-right text-slate-600 dark:text-slate-400">${escapeHtml(formatMoney(item.unitPrice))}</td>
      <td class="py-2 text-right font-semibold text-slate-900 dark:text-white">${escapeHtml(formatMoney(item.lineTotal ?? Number(item.quantity || 0) * Number(item.unitPrice || 0)))}</td>
    </tr>
  `).join("");
}

async function initInvoicesPage() {
  const user = await protectPage();
  if (!user) return;

  const tbody = document.getElementById("invoices-tbody");
  const detail = document.getElementById("invoice-detail");
  const modal = document.getElementById("modal-invoice");
  const newBtn = document.getElementById("btn-new-invoice");
  const form = document.getElementById("invoice-form");
  const status = document.getElementById("invoices-status");
  const formStatus = document.getElementById("invoice-form-status");
  const submitBtn = document.getElementById("invoice-submit");
  const addItemBtn = document.getElementById("invoice-add-item");
  const printBtn = document.getElementById("invoice-print");
  const filterButtons = Array.from(document.querySelectorAll("[data-invoice-filter]"));
  const itemsList = modal?.querySelector("#invoice-items-list");
  if (!tbody || !detail || !modal || !newBtn || !form || !itemsList) return;

  let editingId = null;
  let currentFilter = "all";
  let cachedRows = [];
  let selectedInvoice = null;

  const renderSelection = (inv) => {
    if (!inv) {
      selectedInvoice = null;
      setText(detail, "#invoice-number", "Selecciona una factura");
      setText(detail, "#invoice-party", "El detalle aparecerá aquí.");
      setHtml(detail, "#invoice-status", "");
      setText(detail, "#invoice-issue-date", "—");
      setText(detail, "#invoice-due-date", "—");
      setText(detail, "#invoice-total", "—");
      setText(detail, "#invoice-id", "—");
      const count = document.getElementById("invoice-items-count");
      const empty = document.getElementById("invoice-items-empty");
      const itemsTbody = document.getElementById("invoice-items-tbody");
      if (count) count.textContent = "";
      if (itemsTbody) itemsTbody.innerHTML = "";
      if (empty) {
        empty.classList.remove("hidden");
        empty.textContent = "Selecciona una factura para ver sus ítems.";
      }
      renderInvoiceItemsDetail(null);
      return;
    }

    setText(detail, "#invoice-number", inv.number || "");
    setText(detail, "#invoice-party", inv.party || "");
    setHtml(detail, "#invoice-status", renderStatusBadge(inv.status));
    setText(detail, "#invoice-issue-date", formatDate(inv.date) || "—");
    setText(detail, "#invoice-due-date", formatDate(inv.dueDate) || "—");
    setText(detail, "#invoice-total", formatMoney(inv.amount));
    setText(detail, "#invoice-id", `#${inv.id}`);
    selectedInvoice = inv;
    renderInvoiceItemsDetail(inv);
  };

  const setDetail = (inv) => {
    renderSelection(inv);
  };

  function setBusy(busy, message) {
    if (submitBtn) {
      submitBtn.disabled = busy;
      submitBtn.classList.toggle("opacity-70", busy);
    }
    if (formStatus) formStatus.textContent = message || "";
  }

  function renderLoading() {
    tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">Cargando facturas...</td></tr>`;
    if (status) status.textContent = "Cargando facturas recientes...";
  }

  function renderEmpty() {
    const emptyMessage = currentFilter === "all" ? "No hay facturas registradas aún." : `No hay facturas en estado ${getStatusMeta(currentFilter).label.toLowerCase()}.`;
    tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">${escapeHtml(emptyMessage)}</td></tr>`;
    if (status) status.textContent = emptyMessage;
    renderSelection(null);
  }

  function renderError(message) {
    tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-10 text-center text-sm text-red-600">${escapeHtml(message)}</td></tr>`;
    if (status) status.textContent = message;
  }

  function getVisibleRows(rows) {
    const safeRows = safeArray(rows);
    if (currentFilter === "all") return safeRows;
    return safeRows.filter((row) => normalizeInvoiceStatus(row.status) === currentFilter);
  }

  function renderRows(rows) {
    const rowList = safeArray(rows);
    const visibleRows = getVisibleRows(rowList) || [];
    if (!(visibleRows?.length ?? 0)) {
      renderEmpty();
      if (status) status.textContent = currentFilter === "all" ? "No hay facturas todavía." : `No hay facturas con estado ${getStatusMeta(currentFilter).label.toLowerCase()}.`;
      return;
    }

    tbody.innerHTML = visibleRows.map((r) => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
        <td data-label="Número" class="px-4 py-3 text-slate-800 text-sm font-medium">${escapeHtml(r.number)}</td>
        <td data-label="Contraparte" class="px-4 py-3 text-slate-500 text-sm">${escapeHtml(r.party)}</td>
        <td data-label="Emisión" class="px-4 py-3 text-slate-500 text-sm">${escapeHtml(formatDate(r.date))}</td>
        <td data-label="Vencimiento" class="px-4 py-3 text-slate-500 text-sm">${escapeHtml(formatDate(r.dueDate))}</td>
        <td data-label="Monto" class="px-4 py-3 text-slate-500 text-sm">${escapeHtml(formatMoney(r.amount))}</td>
        <td data-label="Estado" class="px-4 py-3 text-sm">${renderStatusBadge(r.status)}</td>
        <td data-label="Acciones" class="px-4 py-3 text-right">
          <button data-id="${r.id}" class="mr-2 text-blue-600 hover:text-blue-800 btn-inv-edit" title="Editar factura"><span class="material-symbols-outlined">edit</span></button>
          <button data-id="${r.id}" class="mr-2 text-gray-400 hover:text-slate-800 btn-inv-view" title="Ver detalle"><span class="material-symbols-outlined">visibility</span></button>
          <button data-id="${r.id}" class="text-red-600 hover:text-red-800 btn-inv-del" title="Eliminar factura"><span class="material-symbols-outlined">delete</span></button>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll(".btn-inv-edit").forEach((button) => {
      button.addEventListener("click", async () => {
        const inv = rowList.find((x) => x.id === Number(button.dataset.id));
        if (!inv) return;
        editingId = inv.id;
        modal.dataset.editingId = String(inv.id);
        setModalTitle(modal, "Editar factura");
        form.querySelector("#inv-number").value = inv.number || "";
        form.querySelector("#inv-party").value = inv.party || "";
        form.querySelector("#inv-date").value = toInputDate(inv.date);
        form.querySelector("#inv-due").value = toInputDate(inv.dueDate);
        itemsList.innerHTML = "";
      const invoiceItems = (safeArray(inv.items)?.length ?? 0)
          ? safeArray(inv.items)
          : [{ description: inv.party || "Concepto general", quantity: 1, unitPrice: Number(inv.amount || 0) }];
        invoiceItems.forEach((item) => ensureInvoiceItemRow(modal, item));
        form.querySelector("#inv-status").value = normalizeInvoiceStatus(inv.status);
        syncInvoiceItems(modal);
        openModal();
      });
    });

    tbody.querySelectorAll(".btn-inv-view").forEach((button) => {
      button.addEventListener("click", async () => {
        const inv = rowList.find((x) => x.id === Number(button.dataset.id));
        if (inv) setDetail(inv);
      });
    });

  tbody.querySelectorAll(".btn-inv-del").forEach((button) => {
    button.addEventListener("click", async () => {
      const inv = rowList.find((x) => x.id === Number(button.dataset.id));
      if (!confirm(`Eliminar la factura ${inv?.number || "seleccionada"}?`)) return;
      try {
        const response = await apiFetch(`/api/invoices/${button.dataset.id}`, { method: "DELETE" });
        if (!response.ok) {
          throw new Error("No se pudo eliminar la factura.");
        }
        await loadInvoices();
      } catch (error) {
        if (status) status.textContent = error.message || "No se pudo eliminar la factura.";
      }
    });
  });

    if (visibleRows[0]) setDetail(visibleRows[0]);
    if (status) status.textContent = `${visibleRows?.length ?? 0} factura(s) cargada(s).`;
  }

  async function loadInvoices() {
    renderLoading();
    try {
      const rawRows = await apiJson("/api/invoices");
      cachedRows = safeArray(rawRows);
      if (!(cachedRows?.length ?? 0)) {
        renderEmpty();
        return;
      }

      renderRows(cachedRows);
    } catch (error) {
      renderError(error.message || "No se pudieron cargar las facturas.");
    }
  }

  function openModal() {
    modal.classList.remove("opacity-0", "pointer-events-none");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    modal.classList.add("opacity-0", "pointer-events-none");
    modal.setAttribute("aria-hidden", "true");
  }

  newBtn.addEventListener("click", () => {
    form.reset();
    delete modal.dataset.editingId;
    editingId = null;
    setModalTitle(modal, "Nueva factura");
    if (formStatus) formStatus.textContent = "";
    form.querySelector("#inv-status").value = "pending";
    itemsList.innerHTML = "";
    ensureInvoiceItemRow(modal, { description: "", quantity: 1, unitPrice: 0 });
    openModal();
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-modal-close]")) closeModal();
  });

  if (itemsList) {
    itemsList.addEventListener("input", () => syncInvoiceItems(modal));
    itemsList.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove-item]");
      if (!removeButton) return;

      const rows = Array.from(itemsList.querySelectorAll("[data-invoice-item-row]"));
      const currentRow = removeButton.closest("[data-invoice-item-row]");
      if (!currentRow) return;

      if ((safeArray(rows)?.length ?? 0) === 1) {
        currentRow.querySelector('[data-item-field="description"]').value = "";
        currentRow.querySelector('[data-item-field="quantity"]').value = "1";
        currentRow.querySelector('[data-item-field="unitPrice"]').value = "0";
        syncInvoiceItems(modal);
        return;
      }

      currentRow.remove();
      syncInvoiceItems(modal);
    });
  }

  if (addItemBtn) {
    addItemBtn.addEventListener("click", () => {
      ensureInvoiceItemRow(modal, { description: "", quantity: 1, unitPrice: 0 });
    });
  }

  if (printBtn) {
    printBtn.addEventListener("click", () => {
      const invoice = selectedInvoice || safeArray(cachedRows)[0] || null;
      if (!invoice) {
        if (status) status.textContent = "Selecciona una factura para exportar PDF.";
        return;
      }
      openInvoicePrintPreview(invoice);
    });
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.invoiceFilter || "all";
      filterButtons.forEach((btn) => {
        const active = btn === button;
        btn.className = active
          ? "flex h-8 items-center justify-center rounded-md bg-white px-3 shadow-sm text-gray-900 dark:bg-gray-700 dark:text-white"
          : "flex h-8 items-center justify-center rounded-md px-3 transition-colors hover:bg-white dark:hover:bg-gray-700";
      });
      renderRows(cachedRows);
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = invoicePayload(modal);
    const currentId = editingId || (modal.dataset.editingId ? Number(modal.dataset.editingId) : null);
    setBusy(true, currentId ? "Actualizando factura..." : "Guardando factura...");
    let submitted = false;
    try {
      await apiJson(currentId ? `/api/invoices/${currentId}` : "/api/invoices", {
        method: currentId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeModal();
      editingId = null;
      setModalTitle(modal, "Nueva factura");
      submitted = true;
      await loadInvoices();
    } catch (error) {
      if (formStatus) formStatus.textContent = error.message || "No se pudo guardar.";
    } finally {
      setBusy(false, submitted ? "" : (formStatus?.textContent || ""));
    }
  });

  await loadInvoices();
}

export { initInvoicesPage };
