import { apiJson, formatMoney } from "./api.js";
import { protectPage } from "./auth.js";

async function initReportsPage() {
  const user = await protectPage();
  if (!user) return;

  const status = document.getElementById("reports-status");
  if (status) status.textContent = "Cargando reportes...";

  try {
    const movements = await apiJson("/api/movements");
    const ingresos = movements.filter((m) => Number(m.amount) > 0).reduce((sum, m) => sum + Number(m.amount || 0), 0);
    const gastos = movements.filter((m) => Number(m.amount) < 0).reduce((sum, m) => sum + Math.abs(Number(m.amount || 0)), 0);
    const resultado = ingresos - gastos;

    const income = document.getElementById("report-ingresos");
    const expense = document.getElementById("report-gastos");
    const balance = document.getElementById("report-resultado");

    if (income) income.textContent = formatMoney(ingresos);
    if (expense) expense.textContent = formatMoney(gastos);
    if (balance) balance.textContent = formatMoney(resultado);
    if (status) status.textContent = movements.length ? `${movements.length} movimiento(s) incluidos.` : "No hay movimientos para calcular reportes.";
  } catch (error) {
    if (status) status.textContent = error.message || "No se pudieron cargar los reportes.";
  }
}

export { initReportsPage };
