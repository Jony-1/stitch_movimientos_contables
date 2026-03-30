import { apiFetch, apiJson, formatDate, formatMoney } from "./api.js";
import { canWriteAccounting, protectPage } from "./auth.js";

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

function isPaidStatus(value) {
  return normalizeInvoiceStatus(value) === "pagada";
}

function createHiddenPrintFrame(html) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  iframe.srcdoc = html;
  return iframe;
}

function openActionDialog(modal, options = {}) {
  const titleNode = modal?.querySelector("#invoice-action-title");
  const messageNode = modal?.querySelector("#invoice-action-message");
  const confirmBtn = modal?.querySelector("#invoice-action-confirm");
  if (!modal || !titleNode || !messageNode || !confirmBtn) {
    return Promise.resolve(false);
  }

  const { title = "Confirmar acción", message = "", confirmLabel = "Aceptar", confirmTone = "danger" } = options;
  let resolved = false;
  let cleanup = () => {};
  const previouslyFocusedElement = document.activeElement;

  return new Promise((resolve) => {
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      if (previouslyFocusedElement instanceof HTMLElement && previouslyFocusedElement.isConnected) {
        previouslyFocusedElement.focus({ preventScroll: true });
      }
      modal.classList.add("opacity-0", "pointer-events-none");
      modal.setAttribute("aria-hidden", "true");
      resolve(value);
    };

    const confirmHandler = () => finish(true);
    const cancelHandler = () => finish(false);
    const backdropHandler = (event) => {
      if (event.target === modal || event.target.closest("[data-invoice-action-close]")) finish(false);
    };
    const keyHandler = (event) => {
      if (event.key === "Escape") finish(false);
    };

    cleanup = () => {
      confirmBtn.removeEventListener("click", confirmHandler);
      modal.removeEventListener("click", backdropHandler);
      document.removeEventListener("keydown", keyHandler);
      const cancelBtn = modal.querySelector("#invoice-action-cancel");
      if (cancelBtn) cancelBtn.removeEventListener("click", cancelHandler);
    };

    titleNode.textContent = title;
    messageNode.textContent = message;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.className = confirmTone === "danger"
      ? "rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
      : "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700";

    const cancelBtn = modal.querySelector("#invoice-action-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", cancelHandler, { once: true });
    confirmBtn.addEventListener("click", confirmHandler, { once: true });
    modal.addEventListener("click", backdropHandler);
    document.addEventListener("keydown", keyHandler);

    modal.classList.remove("opacity-0", "pointer-events-none");
    modal.setAttribute("aria-hidden", "false");
  });
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
    </body>
  </html>`;
}

function openInvoicePrintPreview(inv) {
  if (!inv) return false;
  const iframe = createHiddenPrintFrame(buildInvoicePrintHtml(inv));
  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.remove();
    }, 1000);
  };

  iframe.addEventListener("load", () => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow || typeof frameWindow.print !== "function") {
      cleanup();
      return;
    }

    try {
      frameWindow.focus();
      frameWindow.print();
      frameWindow.onafterprint = cleanup;
      cleanup();
    } catch (_) {
      cleanup();
    }
  }, { once: true });

  document.body.appendChild(iframe);

  return true;
}

function toInputDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function createInvoiceItemRow(item = {}) {
  const row = document.createElement("div");
  row.dataset.invoiceItemRow = "true";
  row.className = "grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40 lg:grid-cols-[minmax(0,2fr)_110px_140px_120px_auto] lg:items-end";
  row.innerHTML = `
    <label class="flex min-w-0 flex-col gap-1">
      <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Descripción</span>
      <input data-item-field="description" class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white" placeholder="Papa pastusa, transporte..." value="${escapeHtml(item.description || "")}">
    </label>
    <label class="flex min-w-0 flex-col gap-1">
      <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Cantidad</span>
      <input data-item-field="quantity" type="number" min="0" step="0.01" class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white" value="${escapeHtml(String(item.quantity ?? 1))}">
    </label>
    <label class="flex min-w-0 flex-col gap-1">
      <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Precio unit.</span>
      <input data-item-field="unitPrice" type="number" min="0" step="0.01" class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white" value="${escapeHtml(String(item.unitPrice ?? 0))}">
    </label>
    <div class="flex min-w-0 flex-col gap-1">
      <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Total</span>
      <p data-item-total class="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">${formatMoney(Number(item.quantity ?? 1) * Number(item.unitPrice ?? 0))}</p>
    </div>
    <button type="button" data-remove-item class="inline-flex h-10 items-center justify-center justify-self-end rounded-lg border border-slate-200 bg-white px-3 text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-rose-950/40 dark:hover:text-rose-300" aria-label="Eliminar ítem">
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
  const writable = canWriteAccounting(user);

  const tbody = document.getElementById("invoices-tbody");
  const detail = document.getElementById("invoice-detail");
  const modal = document.getElementById("modal-invoice");
  const actionModal = document.getElementById("modal-invoice-action");
  const newBtn = document.getElementById("btn-new-invoice");
  const editBtn = document.getElementById("invoice-edit");
  const form = document.getElementById("invoice-form");
  const status = document.getElementById("invoices-status");
  const formStatus = document.getElementById("invoice-form-status");
  const submitBtn = document.getElementById("invoice-submit");
  const addItemBtn = document.getElementById("invoice-add-item");
  const payBtn = document.getElementById("invoice-pay");
  const printBtn = document.getElementById("invoice-print");
  const filterButtons = Array.from(document.querySelectorAll("[data-invoice-filter]"));
  const itemsList = modal?.querySelector("#invoice-items-list");
  if (!tbody || !detail || !modal || !actionModal || !newBtn || !form || !itemsList) return;
  if (!writable) {
    if (newBtn) {
      newBtn.disabled = true;
      newBtn.classList.add("cursor-not-allowed", "opacity-60");
      newBtn.title = "Solo lectura para este perfil";
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add("cursor-not-allowed", "opacity-60");
    }
    if (addItemBtn) {
      addItemBtn.disabled = true;
      addItemBtn.classList.add("cursor-not-allowed", "opacity-60");
    }
  }

  let editingId = null;
  let currentFilter = "all";
  let cachedRows = [];
  let currentRenderedRows = [];
  let selectedInvoice = null;

  function openInvoiceEditor(inv) {
    if (!inv) return;
    if (!writable) {
      if (status) status.textContent = "Tu perfil es solo lectura.";
      return;
    }

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
  }

  function syncSelectedRow() {
    const selectedId = selectedInvoice?.id != null ? String(selectedInvoice.id) : null;
    tbody.querySelectorAll("[data-invoice-row]").forEach((row) => {
      const rowId = row.dataset.invoiceRow || null;
      const active = selectedId !== null && rowId === selectedId;
      row.dataset.selected = active ? "true" : "false";
      row.classList.toggle("bg-sky-50/80", active);
      row.classList.toggle("dark:bg-sky-950/30", active);
      row.classList.toggle("shadow-[inset_4px_0_0_0_var(--color-primary)]", active);
      row.querySelectorAll("[data-select-invoice], [data-label='Acciones']").forEach((cell) => {
        cell.classList.toggle("bg-sky-50/80", active);
        cell.classList.toggle("dark:bg-sky-950/30", active);
      });
    });
  }

  function findRenderedInvoice(id) {
    return currentRenderedRows.find((row) => String(row.id) === String(id || ""));
  }

  function selectInvoice(id, message) {
    const inv = findRenderedInvoice(id);
    if (!inv) return null;
    if (status && message) status.textContent = message.replace("{number}", inv.number);
    setDetail(inv);
    syncSelectedRow();
    return inv;
  }

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
      if (payBtn) {
        payBtn.disabled = true;
        payBtn.classList.add("opacity-60", "cursor-not-allowed");
      }
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
    if (payBtn) {
      const paid = isPaidStatus(inv.status);
      payBtn.disabled = !writable || paid;
      payBtn.classList.toggle("opacity-60", !writable || paid);
      payBtn.classList.toggle("cursor-not-allowed", !writable || paid);
      payBtn.innerHTML = !writable
        ? '<span class="material-symbols-outlined text-base">visibility</span> Solo lectura'
        : paid
          ? '<span class="material-symbols-outlined text-base">check_circle</span> Pagada'
          : '<span class="material-symbols-outlined text-base">payments</span> Marcar pagada';
    }
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

    currentRenderedRows = visibleRows;

    tbody.innerHTML = visibleRows.map((r) => `
      <tr data-invoice-row="${r.id}" class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
        <td data-label="Número" data-select-invoice="${r.id}" tabindex="0" class="cursor-pointer px-4 py-3 text-slate-800 text-sm font-medium focus:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/50">${escapeHtml(r.number)}</td>
        <td data-label="Contraparte" data-select-invoice="${r.id}" tabindex="0" class="cursor-pointer px-4 py-3 text-slate-500 text-sm focus:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/50">${escapeHtml(r.party)}</td>
        <td data-label="Emisión" data-select-invoice="${r.id}" tabindex="0" class="cursor-pointer px-4 py-3 text-slate-500 text-sm focus:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/50">${escapeHtml(formatDate(r.date))}</td>
        <td data-label="Vencimiento" data-select-invoice="${r.id}" tabindex="0" class="cursor-pointer px-4 py-3 text-slate-500 text-sm focus:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/50">${escapeHtml(formatDate(r.dueDate))}</td>
        <td data-label="Monto" data-select-invoice="${r.id}" tabindex="0" class="cursor-pointer px-4 py-3 text-slate-500 text-sm focus:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/50">${escapeHtml(formatMoney(r.amount))}</td>
        <td data-label="Estado" data-select-invoice="${r.id}" tabindex="0" class="cursor-pointer px-4 py-3 text-sm focus:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/50">${renderStatusBadge(r.status)}</td>
        <td data-label="Acciones" class="px-4 py-3 text-right">
          ${writable ? `<button type="button" data-invoice-action="edit" data-id="${r.id}" class="mr-2 text-blue-600 hover:text-blue-800" title="Editar factura" aria-label="Editar factura ${escapeHtml(r.number)}"><span class="material-symbols-outlined">edit</span></button><button type="button" data-invoice-action="view" data-id="${r.id}" class="mr-2 text-gray-400 hover:text-slate-800" title="Ver detalle" aria-label="Ver detalle de factura ${escapeHtml(r.number)}"><span class="material-symbols-outlined">visibility</span></button><button type="button" data-invoice-action="delete" data-id="${r.id}" class="text-red-600 hover:text-red-800" title="Eliminar factura" aria-label="Eliminar factura ${escapeHtml(r.number)}"><span class="material-symbols-outlined">delete</span></button>` : `<button type="button" data-invoice-action="view" data-id="${r.id}" class="mr-2 text-gray-400 hover:text-slate-800" title="Ver detalle" aria-label="Ver detalle de factura ${escapeHtml(r.number)}"><span class="material-symbols-outlined">visibility</span></button><span class="text-xs text-slate-500 dark:text-slate-400">Solo lectura</span>`}
        </td>
      </tr>`).join("");

    tbody.querySelectorAll("[data-select-invoice]").forEach((cell) => {
      cell.addEventListener("click", () => {
        selectInvoice(cell.dataset.selectInvoice, "Mostrando factura {number}.");
      });

      cell.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectInvoice(cell.dataset.selectInvoice, "Mostrando factura {number}.");
      });
    });

    tbody.querySelectorAll("[data-invoice-action]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const inv = findRenderedInvoice(button.dataset.id);
        if (!inv) return;

        const action = button.dataset.invoiceAction;
        if (action === "edit") {
          if (status) status.textContent = `Editando factura ${inv.number}.`;
          openInvoiceEditor(inv);
          return;
        }

        if (action === "view") {
          selectInvoice(button.dataset.id, "Mostrando factura {number}.");
          return;
        }

        if (action === "delete") {
          if (status) status.textContent = `Preparando eliminación de ${inv.number}...`;
          const accepted = await openActionDialog(actionModal, {
            title: "Eliminar factura",
            message: `Vas a eliminar la factura ${inv?.number || "seleccionada"}. Esta acción no se puede deshacer.`,
            confirmLabel: "Eliminar",
            confirmTone: "danger",
          });
          if (!accepted) return;
          try {
            const response = await apiFetch(`/api/invoices/${inv.id}`, { method: "DELETE" });
            if (!response.ok) {
              throw new Error("No se pudo eliminar la factura.");
            }
            await loadInvoices();
          } catch (error) {
            if (status) status.textContent = error.message || "No se pudo eliminar la factura.";
          }
        }
      });
    });

    if (visibleRows[0]) setDetail(visibleRows[0]);
    syncSelectedRow();
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
    if (!writable) {
      if (status) status.textContent = "Tu perfil es solo lectura.";
      return;
    }
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
      const printed = openInvoicePrintPreview(invoice);
      if (!printed && status) status.textContent = "No se pudo abrir la vista de PDF.";
    });
  }

  if (payBtn) {
    payBtn.addEventListener("click", async () => {
      if (!writable) {
        if (status) status.textContent = "Tu perfil es solo lectura.";
        return;
      }
      const invoice = selectedInvoice || safeArray(cachedRows)[0] || null;
      if (!invoice) {
        if (status) status.textContent = "Selecciona una factura para registrar el pago.";
        return;
      }

      if (isPaidStatus(invoice.status)) {
        if (status) status.textContent = "La factura ya está pagada.";
        return;
      }

      const accepted = await openActionDialog(actionModal, {
        title: "Registrar pago",
        message: `Vas a marcar como pagada la factura ${invoice.number}. Se generará el movimiento contable asociado.`,
        confirmLabel: "Marcar pagada",
        confirmTone: "success",
      });
      if (!accepted) return;

      payBtn.disabled = true;
      if (status) status.textContent = "Registrando pago...";

      try {
        await apiJson(`/api/invoices/${invoice.id}/pay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: `Pago factura ${invoice.number}` }),
        });
        await loadInvoices();
      } catch (error) {
        if (status) status.textContent = error.message || "No se pudo registrar el pago.";
      }
    });
  }

  if (editBtn) {
    editBtn.addEventListener("click", () => {
      if (!selectedInvoice) {
        if (status) status.textContent = "Selecciona una factura para editarla.";
        return;
      }
      openInvoiceEditor(selectedInvoice);
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
    if (!writable) return;
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
