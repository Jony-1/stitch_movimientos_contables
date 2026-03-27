import { apiJson, formatDate, formatMoney } from "./api.js";
import { protectPage } from "./auth.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getAmountClass(type) {
  return String(type || "").toLowerCase() === "ingreso" ? "text-emerald-600" : "text-rose-600";
}

function getAmountBadge(type) {
  return String(type || "").toLowerCase() === "ingreso"
    ? "bg-emerald-100 text-emerald-700"
    : "bg-rose-100 text-rose-700";
}

function toInputDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRangePreset(preset) {
  const today = new Date();
  const to = toInputDate(today);
  const fromDate = new Date(today);

  switch (preset) {
    case "30d":
      fromDate.setDate(fromDate.getDate() - 29);
      return { from: toInputDate(fromDate), to };
    case "month":
      return { from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`, to };
    case "year":
      return { from: `${today.getFullYear()}-01-01`, to };
    default:
      return { from: "", to: "" };
  }
}

function describeFilters(filters = {}) {
  const parts = [];
  if (filters.type && filters.type !== "all") {
    parts.push(filters.type === "ingreso" ? "solo ingresos" : "solo gastos");
  }
  if (filters.from && filters.to) {
    parts.push(`del ${formatDate(`${filters.from}T12:00:00`)} al ${formatDate(`${filters.to}T12:00:00`)}`);
  } else if (filters.from) {
    parts.push(`desde ${formatDate(`${filters.from}T12:00:00`)}`);
  } else if (filters.to) {
    parts.push(`hasta ${formatDate(`${filters.to}T12:00:00`)}`);
  }
  return parts.length ? parts.join(" · ") : "Todo el historial";
}

function formatMonthLabel(monthKey) {
  if (!monthKey) return "";
  const [year, month] = String(monthKey).split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("es-CO", { month: "short", year: "numeric" });
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function buildCsv(report) {
  const movements = Array.isArray(report?.movements?.movements) ? report.movements.movements : [];
  const invoices = Array.isArray(report?.invoices?.invoices) ? report.invoices.invoices : [];

  const movementRows = [
    ["Movimientos"],
    ["Fecha", "Tipo", "Categoría", "Descripción", "Monto", "Estado"],
    ...movements.map((movement) => [
      formatDate(movement.date),
      movement.type || "",
      movement.category || "Sin categoría",
      movement.description || "",
      String(Number(movement.amount || 0)),
      movement.status || "",
    ]),
  ];

  const invoiceRows = [
    ["Facturas"],
    ["Número", "Contraparte", "Fecha", "Vencimiento", "Monto", "Estado"],
    ...invoices.map((invoice) => [
      invoice.number || "",
      invoice.party || "",
      formatDate(invoice.date),
      formatDate(invoice.dueDate),
      String(Number(invoice.amount || 0)),
      invoice.status || "",
    ]),
  ];

  return [...movementRows, [], ...invoiceRows]
    .map((row) => row.map(csvCell).join(";"))
    .join("\n");
}

function downloadCsv(report) {
  const blob = new Blob([buildCsv(report)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reporte-${toInputDate(new Date())}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderStatCards(report) {
  const summary = report?.summary || {};
  return `
    <article class="surface-card p-6">
      <p class="text-sm font-medium text-slate-500 dark:text-slate-400">Ingresos</p>
      <p class="mt-2 text-3xl font-black text-emerald-600">${formatMoney(summary.incomeTotal || 0)}</p>
    </article>
    <article class="surface-card p-6">
      <p class="text-sm font-medium text-slate-500 dark:text-slate-400">Gastos</p>
      <p class="mt-2 text-3xl font-black text-rose-600">${formatMoney(summary.expenseTotal || 0)}</p>
    </article>
    <article class="surface-card p-6">
      <p class="text-sm font-medium text-slate-500 dark:text-slate-400">Balance</p>
      <p class="mt-2 text-3xl font-black text-slate-900 dark:text-white">${formatMoney(summary.netBalance || 0)}</p>
    </article>
    <article class="surface-card p-6">
      <p class="text-sm font-medium text-slate-500 dark:text-slate-400">Movimientos</p>
      <p class="mt-2 text-3xl font-black text-slate-900 dark:text-white">${summary.movementCount || 0}</p>
    </article>
    <article class="surface-card p-6">
      <p class="text-sm font-medium text-slate-500 dark:text-slate-400">Facturas</p>
      <p class="mt-2 text-3xl font-black text-slate-900 dark:text-white">${summary.invoiceCount || 0}</p>
    </article>
    <article class="surface-card p-6">
      <p class="text-sm font-medium text-slate-500 dark:text-slate-400">Pendientes</p>
      <p class="mt-2 text-3xl font-black text-amber-600">${formatMoney(summary.invoicePendingAmount || 0)}</p>
    </article>`;
}

function renderSimpleBar(label, value, maxValue, colorClass, meta) {
  const width = maxValue > 0 ? Math.max((Number(value || 0) / maxValue) * 100, 4) : 4;
  return `
    <div class="surface-card p-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-slate-900 dark:text-white">${escapeHtml(label)}</p>
          ${meta ? `<p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(meta)}</p>` : ""}
        </div>
        <p class="text-sm font-semibold text-slate-700 dark:text-slate-200">${formatMoney(value)}</p>
      </div>
      <div class="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div class="h-full rounded-full ${colorClass}" style="width:${width}%"></div>
      </div>
    </div>`;
}

function renderMovementCategory(categories) {
  const safeCategories = Array.isArray(categories) ? categories : [];
  if (!safeCategories.length) {
    return `<div class="surface-muted p-4 text-sm text-slate-500 dark:text-slate-400">No hay categorías para este filtro.</div>`;
  }

  const maxTotal = Math.max(...safeCategories.map((item) => Number(item.total || 0)), 1);
  return safeCategories
    .map((item) => renderSimpleBar(
      item.category || "Sin categoría",
      item.total || 0,
      maxTotal,
      String(item.type || "").toLowerCase() === "ingreso" ? "bg-emerald-500" : "bg-rose-500",
      `${item.count || 0} movimiento(s)`
    ))
    .join("");
}

function renderMonthlyTrend(months) {
  const safeMonths = Array.isArray(months) ? months : [];
  if (!safeMonths.length) {
    return `<div class="surface-muted p-4 text-sm text-slate-500 dark:text-slate-400">No hay tendencia mensual para mostrar.</div>`;
  }

  const maxValue = Math.max(...safeMonths.flatMap((item) => [Number(item.incomeTotal || 0), Number(item.expenseTotal || 0)]), 1);
  return safeMonths
    .map((item) => `
      <div class="surface-card p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-slate-900 dark:text-white">${formatMonthLabel(item.month)}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">${item.count || 0} movimiento(s)</p>
          </div>
          <p class="text-sm font-semibold ${Number(item.balance || 0) >= 0 ? "text-emerald-600" : "text-rose-600"}">${formatMoney(item.balance || 0)}</p>
        </div>
        <div class="grid grid-cols-2 gap-3 text-xs text-slate-500 dark:text-slate-400">
          ${renderSimpleBar("Ingresos", item.incomeTotal || 0, maxValue, "bg-emerald-500")}
          ${renderSimpleBar("Gastos", item.expenseTotal || 0, maxValue, "bg-rose-500")}
        </div>
      </div>`)
    .join("");
}

function renderInvoiceStatus(statuses) {
  const safeStatuses = Array.isArray(statuses) ? statuses : [];
  if (!safeStatuses.length) {
    return `<div class="surface-muted p-4 text-sm text-slate-500 dark:text-slate-400">No hay estados de facturas para mostrar.</div>`;
  }

  const maxTotal = Math.max(...safeStatuses.map((item) => Number(item.total || 0)), 1);
  return safeStatuses
    .map((item) => {
      const status = String(item.status || "").toLowerCase();
      const color = status === "pagada" ? "bg-emerald-500" : status === "vencida" ? "bg-rose-500" : "bg-amber-500";
      return renderSimpleBar(item.status || "pending", item.total || 0, maxTotal, color, `${item.count || 0} factura(s)`);
    })
    .join("");
}

function renderPartyBars(parties) {
  const safeParties = Array.isArray(parties) ? parties : [];
  if (!safeParties.length) {
    return `<div class="surface-muted p-4 text-sm text-slate-500 dark:text-slate-400">No hay contrapartes para mostrar.</div>`;
  }

  const maxTotal = Math.max(...safeParties.map((item) => Number(item.total || 0)), 1);
  return safeParties
    .map((item) => renderSimpleBar(item.party || "Sin contraparte", item.total || 0, maxTotal, "bg-sky-500", `${item.count || 0} factura(s)`))
    .join("");
}

function renderMovementsTable(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    return `<tr><td colspan="6" class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">No hay movimientos para este filtro.</td></tr>`;
  }

  return safeRows.map((row) => {
    const isIncome = String(row.type || "").toLowerCase() === "ingreso";
    return `
      <tr class="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800/70 dark:hover:bg-slate-900/40">
        <td class="px-4 py-4 text-sm text-slate-500 dark:text-slate-400">${formatDate(row.date)}</td>
        <td class="px-4 py-4 text-sm font-medium text-slate-800 dark:text-slate-100">${escapeHtml(row.description || "Sin descripción")}</td>
        <td class="px-4 py-4 text-sm"><span class="rounded-full px-2.5 py-1 text-xs font-semibold ${getAmountBadge(row.type)}">${isIncome ? "Ingreso" : "Gasto"}</span></td>
        <td class="px-4 py-4 text-sm text-slate-600 dark:text-slate-300">${escapeHtml(row.category || "Sin categoría")}</td>
        <td class="px-4 py-4 text-right text-sm font-semibold ${getAmountClass(row.type)}">${formatMoney(row.amount)}</td>
        <td class="px-4 py-4 text-right text-sm text-slate-500 dark:text-slate-400">${escapeHtml(row.status || "Registrado")}</td>
      </tr>`;
  }).join("");
}

function renderInvoicesTable(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    return `<tr><td colspan="6" class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">No hay facturas para este filtro.</td></tr>`;
  }

  return safeRows.map((row) => {
    const status = String(row.status || "pending").toLowerCase();
    const badgeClass = status === "pagada"
      ? "bg-emerald-100 text-emerald-700"
      : status === "vencida"
        ? "bg-rose-100 text-rose-700"
        : "bg-amber-100 text-amber-700";

    return `
      <tr class="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800/70 dark:hover:bg-slate-900/40">
        <td class="px-4 py-4 text-sm font-medium text-slate-800 dark:text-slate-100">${escapeHtml(row.number || "")}</td>
        <td class="px-4 py-4 text-sm text-slate-600 dark:text-slate-300">${escapeHtml(row.party || "")}</td>
        <td class="px-4 py-4 text-sm text-slate-500 dark:text-slate-400">${formatDate(row.date)}</td>
        <td class="px-4 py-4 text-sm text-slate-500 dark:text-slate-400">${formatDate(row.dueDate)}</td>
        <td class="px-4 py-4 text-right text-sm font-semibold text-slate-800 dark:text-slate-100">${formatMoney(row.amount)}</td>
        <td class="px-4 py-4 text-right text-sm"><span class="rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass}">${escapeHtml(row.status || "pending")}</span></td>
      </tr>`;
  }).join("");
}

function buildPrintableHtml(report) {
  const summary = report?.summary || {};
  const movements = Array.isArray(report?.movements?.movements) ? report.movements.movements : [];
  const invoices = Array.isArray(report?.invoices?.invoices) ? report.invoices.invoices : [];

  const movementRows = movements.map((row) => `
    <tr>
      <td>${escapeHtml(formatDate(row.date))}</td>
      <td>${escapeHtml(row.type || "")}</td>
      <td>${escapeHtml(row.category || "Sin categoría")}</td>
      <td>${escapeHtml(row.description || "")}</td>
      <td class="num">${escapeHtml(formatMoney(row.amount))}</td>
      <td>${escapeHtml(row.status || "")}</td>
    </tr>`).join("");

  const invoiceRows = invoices.map((row) => `
    <tr>
      <td>${escapeHtml(row.number || "")}</td>
      <td>${escapeHtml(row.party || "")}</td>
      <td>${escapeHtml(formatDate(row.date))}</td>
      <td>${escapeHtml(formatDate(row.dueDate))}</td>
      <td class="num">${escapeHtml(formatMoney(row.amount))}</td>
      <td>${escapeHtml(row.status || "")}</td>
    </tr>`).join("");

  return `<!doctype html>
  <html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Reporte</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
      h1, h2 { margin: 0 0 12px; }
      .muted { color: #64748b; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0 24px; }
      .card { border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; }
      .table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      .table th, .table td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; font-size: 12px; }
      .table th { background: #f8fafc; }
      .num { text-align: right; }
      .section { margin-top: 24px; page-break-inside: avoid; }
      .small { font-size: 12px; }
      @page { size: A4; margin: 16mm; }
    </style>
  </head>
  <body>
    <h1>Reporte financiero</h1>
    <p class="muted small">${escapeHtml(describeFilters(report?.filters || {}))}</p>
    <div class="grid">
      <div class="card"><div class="muted small">Ingresos</div><strong>${escapeHtml(formatMoney(summary.incomeTotal || 0))}</strong></div>
      <div class="card"><div class="muted small">Gastos</div><strong>${escapeHtml(formatMoney(summary.expenseTotal || 0))}</strong></div>
      <div class="card"><div class="muted small">Balance</div><strong>${escapeHtml(formatMoney(summary.netBalance || 0))}</strong></div>
      <div class="card"><div class="muted small">Movimientos</div><strong>${escapeHtml(String(summary.movementCount || 0))}</strong></div>
      <div class="card"><div class="muted small">Facturas</div><strong>${escapeHtml(String(summary.invoiceCount || 0))}</strong></div>
      <div class="card"><div class="muted small">Pendientes</div><strong>${escapeHtml(formatMoney(summary.invoicePendingAmount || 0))}</strong></div>
    </div>

    <div class="section">
      <h2>Movimientos</h2>
      <table class="table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th>Monto</th><th>Estado</th></tr></thead>
        <tbody>${movementRows || `<tr><td colspan="6">Sin movimientos</td></tr>`}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Facturas</h2>
      <table class="table">
        <thead><tr><th>Número</th><th>Contraparte</th><th>Fecha</th><th>Vencimiento</th><th>Monto</th><th>Estado</th></tr></thead>
        <tbody>${invoiceRows || `<tr><td colspan="6">Sin facturas</td></tr>`}</tbody>
      </table>
    </div>
  </body>
  </html>`;
}

function exportPdf(report) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=1200,height=900");
  if (!win) return;
  win.document.open();
  win.document.write(buildPrintableHtml(report));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

async function initReportsPage() {
  const user = await protectPage();
  if (!user) return;

  const status = document.getElementById("reports-status");
  const periodLabel = document.getElementById("reports-period-label");
  const count = document.getElementById("report-count");
  const income = document.getElementById("report-ingresos");
  const expense = document.getElementById("report-gastos");
  const balance = document.getElementById("report-resultado");
  const movementCount = document.getElementById("report-movement-count");
  const invoiceCount = document.getElementById("report-invoice-count");
  const invoicePending = document.getElementById("report-invoice-pending");
  const invoiceTotal = document.getElementById("report-invoice-total");
  const categoryList = document.getElementById("report-category-list");
  const monthlyList = document.getElementById("report-month-list");
  const invoiceStatusList = document.getElementById("report-invoice-status-list");
  const invoicePartyList = document.getElementById("report-invoice-party-list");
  const movementsTbody = document.getElementById("report-movements-tbody");
  const invoicesTbody = document.getElementById("report-invoices-tbody");
  const fromInput = document.getElementById("report-from");
  const toInput = document.getElementById("report-to");
  const typeSelect = document.getElementById("report-type");
  const applyBtn = document.getElementById("report-apply");
  const exportCsvBtn = document.getElementById("report-export-csv");
  const exportPdfBtn = document.getElementById("report-export-pdf");
  const presetButtons = Array.from(document.querySelectorAll("[data-report-range]"));

  const state = { preset: "all", from: "", to: "", type: "all" };
  let latestReport = null;
  let latestReportKey = "";

  function setStatus(message) {
    if (status) status.textContent = message || "";
  }

  function syncPresetButtons() {
    presetButtons.forEach((button) => {
      const active = button.dataset.reportRange === state.preset;
      button.classList.toggle("bg-white", active);
      button.classList.toggle("shadow-sm", active);
      button.classList.toggle("text-slate-900", active);
      button.classList.toggle("dark:bg-slate-700", active);
      button.classList.toggle("dark:text-white", active);
    });
  }

  function applyPreset(preset) {
    state.preset = preset;
    const range = getRangePreset(preset);
    state.from = range.from;
    state.to = range.to;
    if (fromInput) fromInput.value = state.from;
    if (toInput) toInput.value = state.to;
    syncPresetButtons();
  }

  function getFilters() {
    return {
      from: fromInput && fromInput.value ? fromInput.value : state.from,
      to: toInput && toInput.value ? toInput.value : state.to,
      type: typeSelect && typeSelect.value ? typeSelect.value : state.type,
    };
  }

  function buildReportUrl() {
    const filters = getFilters();
    const params = new URLSearchParams();
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.type && filters.type !== "all") params.set("type", filters.type);
    return `/api/reports/overview${params.toString() ? `?${params.toString()}` : ""}`;
  }

  async function fetchReport() {
    const filters = getFilters();
    state.from = filters.from || "";
    state.to = filters.to || "";
    state.type = filters.type || "all";
    const url = buildReportUrl();
    const report = await apiJson(url);
    latestReport = report;
    latestReportKey = url;
    return report;
  }

  async function ensureLatestReport() {
    const url = buildReportUrl();
    if (latestReport && latestReportKey === url) return latestReport;
    return fetchReport();
  }

  function render(report) {
    const safeReport = report && typeof report === "object" ? report : {};
    const summary = safeReport.summary || {};

    if (income) income.textContent = formatMoney(summary.incomeTotal || 0);
    if (expense) expense.textContent = formatMoney(summary.expenseTotal || 0);
    if (balance) balance.textContent = formatMoney(summary.netBalance || 0);
    if (count) count.textContent = String(summary.movementCount || 0);
    if (movementCount) movementCount.textContent = String(summary.movementCount || 0);
    if (invoiceCount) invoiceCount.textContent = String(summary.invoiceCount || 0);
    if (invoicePending) invoicePending.textContent = formatMoney(summary.invoicePendingAmount || 0);
    if (invoiceTotal) invoiceTotal.textContent = formatMoney(summary.invoiceTotal || 0);
    if (periodLabel) periodLabel.textContent = describeFilters(safeReport.filters);

    if (categoryList) categoryList.innerHTML = renderMovementCategory(safeReport.movements?.byCategory || []);
    if (monthlyList) monthlyList.innerHTML = renderMonthlyTrend(safeReport.movements?.byMonth || []);
    if (invoiceStatusList) invoiceStatusList.innerHTML = renderInvoiceStatus(safeReport.invoices?.byStatus || []);
    if (invoicePartyList) invoicePartyList.innerHTML = renderPartyBars(safeReport.invoices?.byParty || []);
    if (movementsTbody) movementsTbody.innerHTML = renderMovementsTable(safeReport.movements?.movements || []);
    if (invoicesTbody) invoicesTbody.innerHTML = renderInvoicesTable(safeReport.invoices?.invoices || []);

    setStatus(`${summary.movementCount || 0} movimiento(s) y ${summary.invoiceCount || 0} factura(s) analizados.`);
  }

  async function loadReport() {
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.classList.add("opacity-70");
    }
    if (exportCsvBtn) {
      exportCsvBtn.disabled = true;
      exportCsvBtn.classList.add("opacity-70");
    }
    if (exportPdfBtn) {
      exportPdfBtn.disabled = true;
      exportPdfBtn.classList.add("opacity-70");
    }

    setStatus("Cargando reportes...");
    if (movementsTbody) movementsTbody.innerHTML = `<tr><td colspan="6" class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">Cargando movimientos...</td></tr>`;
    if (invoicesTbody) invoicesTbody.innerHTML = `<tr><td colspan="6" class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">Cargando facturas...</td></tr>`;

    try {
      const report = await fetchReport();
      render(report);
    } catch (error) {
      setStatus(error.message || "No se pudieron cargar los reportes.");
      if (categoryList) categoryList.innerHTML = `<div class="rounded-2xl border border-dashed border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700">No fue posible obtener el desglose.</div>`;
      if (monthlyList) monthlyList.innerHTML = `<div class="rounded-2xl border border-dashed border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700">No fue posible obtener la tendencia.</div>`;
      if (invoiceStatusList) invoiceStatusList.innerHTML = `<div class="rounded-2xl border border-dashed border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700">No fue posible obtener el estado de facturas.</div>`;
      if (invoicePartyList) invoicePartyList.innerHTML = `<div class="rounded-2xl border border-dashed border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700">No fue posible obtener las contrapartes.</div>`;
    } finally {
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.classList.remove("opacity-70");
      }
      if (exportCsvBtn) {
        exportCsvBtn.disabled = !latestReport;
        exportCsvBtn.classList.toggle("opacity-70", !latestReport);
      }
      if (exportPdfBtn) {
        exportPdfBtn.disabled = !latestReport;
        exportPdfBtn.classList.toggle("opacity-70", !latestReport);
      }
    }
  }

  presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyPreset(button.dataset.reportRange || "all");
      loadReport();
    });
  });

  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      state.preset = "custom";
      syncPresetButtons();
      loadReport();
    });
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      if (!latestReport) {
        setStatus("Carga el reporte antes de exportar.");
        return;
      }
      downloadCsv(latestReport);
      setStatus("CSV descargado.");
    });
  }

  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", () => {
      if (!latestReport) {
        setStatus("Carga el reporte antes de exportar.");
        return;
      }
      exportPdf(latestReport);
      setStatus("Abriendo vista para PDF.");
    });
  }

  if (typeSelect) {
    typeSelect.addEventListener("change", () => {
      state.type = typeSelect.value || "all";
    });
  }

  if (fromInput) {
    fromInput.addEventListener("change", () => {
      state.preset = "custom";
      syncPresetButtons();
    });
  }

  if (toInput) {
    toInput.addEventListener("change", () => {
      state.preset = "custom";
      syncPresetButtons();
    });
  }

  applyPreset("all");
  await loadReport();
}

export { initReportsPage };
