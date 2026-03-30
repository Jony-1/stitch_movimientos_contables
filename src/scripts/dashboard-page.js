import { apiJson, formatDate, formatMoney } from "./api.js";
import { canWriteAccounting, protectPage } from "./auth.js";

function renderRecentRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    return `<tr><td colspan="4" class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">No hay movimientos registrados todavía.</td></tr>`;
  }

  return safeRows.map((row) => {
    const isIncome = String(row.type || "").toLowerCase() === "ingreso";
    const amountClass = isIncome ? "text-emerald-600" : "text-rose-600";
    const badgeClass = isIncome ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700";
    return `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
        <td class="px-4 py-4 text-sm text-slate-500 dark:text-slate-400">${formatDate(row.date)}</td>
        <td class="px-4 py-4 text-sm font-medium text-slate-800 dark:text-slate-100">${row.description || row.category || "Sin descripción"}</td>
        <td class="px-4 py-4 text-sm"><span class="rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass}">${isIncome ? "Ingreso" : "Gasto"}</span></td>
        <td class="px-4 py-4 text-right text-sm font-semibold ${amountClass}">${formatMoney(row.amount)}</td>
      </tr>`;
  }).join("");
}

function renderAlerts(alerts) {
  const safeAlerts = Array.isArray(alerts) ? alerts.slice(0, 3) : [];
  if (!safeAlerts.length) {
    return '<div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">No hay alertas críticas. La operación se mantiene estable.</div>';
  }

  return safeAlerts.map((alert) => {
    const severity = String(alert.severity || "low").toLowerCase();
    const tone = severity === "high"
      ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300"
      : severity === "medium"
        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"
        : "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300";

    return `<article class="rounded-2xl border px-4 py-4 ${tone}">
      <p class="text-sm font-bold">${alert.title || "Alerta"}</p>
      <p class="mt-1 text-sm opacity-90">${alert.detail || ""}</p>
    </article>`;
  }).join("");
}

function renderPortfolioRanking(rows) {
  const safeRows = Array.isArray(rows) ? rows.slice(0, 4) : [];
  if (!safeRows.length) {
    return '<div class="rounded-2xl border border-slate-200 px-4 py-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">No hay suficientes empresas para comparar.</div>';
  }

  return safeRows.map((row) => {
    const tone = row.trafficLight === "green"
      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20"
      : row.trafficLight === "red"
        ? "border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/20"
        : "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20";

    return `<article class="rounded-2xl border px-4 py-4 ${tone}">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-bold text-slate-900 dark:text-white">${row.position}. ${row.organizationName}</p>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">Balance ${formatMoney(row.balance)} · Pendiente ${formatMoney(row.invoicePendingAmount)}</p>
        </div>
        <div class="text-right">
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Score</p>
          <p class="mt-1 text-2xl font-black text-slate-900 dark:text-white">${row.score}</p>
        </div>
      </div>
    </article>`;
  }).join("");
}

async function initDashboardPage() {
  const user = await protectPage();
  if (!user) return;
  const writable = canWriteAccounting(user);

  const name = document.getElementById("dashboard-user-name");
  const status = document.getElementById("dashboard-status");
  const primaryAction = document.getElementById("dashboard-primary-action");
  const activeOrganization = document.getElementById("dashboard-active-organization");
  const income = document.getElementById("dashboard-income");
  const expense = document.getElementById("dashboard-expense");
  const balance = document.getElementById("dashboard-balance");
  const count = document.getElementById("dashboard-count");
  const recentTbody = document.getElementById("dashboard-recent-tbody");
  const copilotScore = document.getElementById("dashboard-copilot-score");
  const copilotLabel = document.getElementById("dashboard-copilot-label");
  const copilotSummary = document.getElementById("dashboard-copilot-summary");
  const forecastBalance = document.getElementById("dashboard-forecast-balance");
  const pendingInvoices = document.getElementById("dashboard-pending-invoices");
  const alertsContainer = document.getElementById("dashboard-copilot-alerts");
  const portfolioSection = document.getElementById("dashboard-portfolio-section");
  const portfolioSummary = document.getElementById("dashboard-portfolio-summary");
  const portfolioGreen = document.getElementById("dashboard-portfolio-green");
  const portfolioWarning = document.getElementById("dashboard-portfolio-warning");
  const portfolioRisk = document.getElementById("dashboard-portfolio-risk");
  const portfolioRanking = document.getElementById("dashboard-portfolio-ranking");

  if (name) name.textContent = user.name || "Usuario";
  if (activeOrganization) activeOrganization.textContent = user.activeOrganization?.name ? `Empresa activa: ${user.activeOrganization.name}` : "";
  if (primaryAction && !writable) {
    primaryAction.href = "/reportes";
    primaryAction.innerHTML = '<span class="material-symbols-outlined text-base">bar_chart</span><span>Ver reportes</span>';
  }
  if (status) status.textContent = "Cargando resumen...";
  if (recentTbody) {
    recentTbody.innerHTML = `<tr><td colspan="4" class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">Cargando movimientos recientes...</td></tr>`;
  }
  if (alertsContainer) alertsContainer.innerHTML = '<div class="rounded-2xl border border-slate-200 px-4 py-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">Analizando alertas...</div>';

  try {
    const requests = [
      apiJson("/api/movements/summary"),
      apiJson("/api/copilot/summary"),
    ];
    if (Array.isArray(user.organizations) && user.organizations.length > 1) {
      requests.push(apiJson("/api/portfolio/overview"));
    }

    const [summary, copilot, portfolio] = await Promise.all(requests);
    if (income) income.textContent = formatMoney(summary.incomeTotal);
    if (expense) expense.textContent = formatMoney(summary.expenseTotal);
    if (balance) balance.textContent = formatMoney(summary.balance);
    if (count) count.textContent = String(summary.totalCount || 0);
    if (recentTbody) recentTbody.innerHTML = renderRecentRows(summary.recentMovements || []);
    if (copilotScore) copilotScore.textContent = String(copilot.score?.value || 0);
    if (copilotLabel) copilotLabel.textContent = String(copilot.score?.label || "sin datos");
    if (copilotSummary) copilotSummary.textContent = Array.isArray(copilot.highlights) && copilot.highlights.length ? copilot.highlights.join(" ") : "Sin observaciones relevantes por ahora.";
    if (forecastBalance) forecastBalance.textContent = formatMoney(copilot.forecast?.next30Days?.estimatedBalance || 0);
    if (pendingInvoices) pendingInvoices.textContent = formatMoney(copilot.kpis?.invoicePendingAmount || 0);
    if (alertsContainer) alertsContainer.innerHTML = renderAlerts(copilot.alerts || []);
    if (portfolio && portfolioSection) {
      portfolioSection.classList.remove("hidden");
      if (portfolioSummary) portfolioSummary.textContent = Array.isArray(portfolio.highlights) ? portfolio.highlights.join(" ") : "";
      if (portfolioGreen) portfolioGreen.textContent = String(portfolio.summary?.healthyCompanies || 0);
      if (portfolioWarning) portfolioWarning.textContent = String(portfolio.summary?.warningCompanies || 0);
      if (portfolioRisk) portfolioRisk.textContent = String(portfolio.summary?.riskCompanies || 0);
      if (portfolioRanking) portfolioRanking.innerHTML = renderPortfolioRanking(portfolio.ranking || []);
    }
    if (status) status.textContent = `${summary.totalCount ? `${summary.totalCount} movimiento(s) cargado(s).` : "Todavía no hay movimientos."}${writable ? "" : " · Modo consulta"}`;
  } catch (error) {
    if (status) status.textContent = error.message || "No se pudo cargar el resumen.";
    if (recentTbody) {
      recentTbody.innerHTML = `<tr><td colspan="4" class="px-4 py-10 text-center text-sm text-red-600">No se pudo cargar el resumen.</td></tr>`;
    }
    if (alertsContainer) {
      alertsContainer.innerHTML = `<div class="rounded-2xl border border-red-200 px-4 py-4 text-sm text-red-600 dark:border-red-900/40">No se pudo cargar el índice financiero.</div>`;
    }
    if (portfolioSection && portfolioRanking) {
      portfolioSection.classList.remove("hidden");
      portfolioRanking.innerHTML = `<div class="rounded-2xl border border-red-200 px-4 py-4 text-sm text-red-600 dark:border-red-900/40">No se pudo cargar el comparativo multiempresa.</div>`;
    }
  }
}

export { initDashboardPage };
