import { apiJson, formatDate, formatMoney } from "./api.js";
import { protectPage } from "./auth.js";

function renderRecentRows(rows) {
  if (!rows.length) {
    return `<tr><td colspan="4" class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">No hay movimientos registrados todavía.</td></tr>`;
  }

  return rows.map((row) => {
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

async function initDashboardPage() {
  const user = await protectPage();
  if (!user) return;

  const name = document.getElementById("dashboard-user-name");
  const status = document.getElementById("dashboard-status");
  const income = document.getElementById("dashboard-income");
  const expense = document.getElementById("dashboard-expense");
  const balance = document.getElementById("dashboard-balance");
  const count = document.getElementById("dashboard-count");
  const recentTbody = document.getElementById("dashboard-recent-tbody");

  if (name) name.textContent = user.name || "Usuario";
  if (status) status.textContent = "Cargando resumen...";
  if (recentTbody) {
    recentTbody.innerHTML = `<tr><td colspan="4" class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">Cargando movimientos recientes...</td></tr>`;
  }

  try {
    const summary = await apiJson("/api/movements/summary");
    if (income) income.textContent = formatMoney(summary.incomeTotal);
    if (expense) expense.textContent = formatMoney(summary.expenseTotal);
    if (balance) balance.textContent = formatMoney(summary.balance);
    if (count) count.textContent = String(summary.totalCount || 0);
    if (recentTbody) recentTbody.innerHTML = renderRecentRows(summary.recentMovements || []);
    if (status) status.textContent = summary.totalCount ? `${summary.totalCount} movimiento(s) cargado(s).` : "Todavía no hay movimientos.";
  } catch (error) {
    if (status) status.textContent = error.message || "No se pudo cargar el resumen.";
    if (recentTbody) {
      recentTbody.innerHTML = `<tr><td colspan="4" class="px-4 py-10 text-center text-sm text-red-600">No se pudo cargar el resumen.</td></tr>`;
    }
  }
}

export { initDashboardPage };
