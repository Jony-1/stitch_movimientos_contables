import { DB_KEY } from "./storage.js";

export function seedIfEmpty() {
  var raw = localStorage.getItem(DB_KEY);
  if (raw) return;

  var sample = {
    movements: [
      { id: 1, date: "2023-11-10", type: "gasto", category: "Semillas", description: "Compra de semilla certificada", amount: -120000, status: "Registrado" },
      { id: 2, date: "2023-11-05", type: "gasto", category: "Mano de obra", description: "Pago jornaleros recolección", amount: -600000, status: "Borrador" },
      { id: 3, date: "2023-10-28", type: "gasto", category: "Abonos", description: "Compra de fertilizante triple 15", amount: -450000, status: "Registrado" },
      { id: 4, date: "2023-10-20", type: "ingreso", category: "Venta de papa", description: "Venta 20 bultos", amount: 2500000, status: "Registrado" },
    ],
    invoices: [
      { id: 1, number: "FAC-001", party: "Comprador A", date: "2023-10-25", amount: 2500000, status: "Pagada" },
      { id: 2, number: "FAC-002", party: "Proveedor AgroInsumos", date: "2023-10-15", amount: 850000, status: "Pendiente" },
    ],
    users: [],
    requests: [],
  };

  localStorage.setItem(DB_KEY, JSON.stringify(sample));
}