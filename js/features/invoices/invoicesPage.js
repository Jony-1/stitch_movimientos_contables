// js/features/invoices/invoicesPage.js
"use strict";

function money(n) {
  var sign = n < 0 ? "-" : "";
  var v = Math.abs(Number(n) || 0);
  return sign + "$ " + v.toLocaleString("es-CO");
}

// Detecta si estamos en facturas revisando el thead
function isInvoicesPage() {
  return Array.prototype.some.call(
    document.querySelectorAll("table thead th"),
    function (th) {
      return /Número de Factura/i.test(th.textContent || "");
    }
  );
}

function getInvoicesFromLocal() {
  try {
    var raw = localStorage.getItem("stitch_db");
    var db = raw ? JSON.parse(raw) : {};
    var inv = (db.invoices || []).slice();
    inv.sort(function (a, b) {
      return (b.id || 0) - (a.id || 0);
    });
    return inv;
  } catch (e) {
    return [];
  }
}

function writeInvoicesToLocal(invoices) {
  try {
    var raw = localStorage.getItem("stitch_db");
    var db = raw ? JSON.parse(raw) : {};
    db.invoices = invoices;
    localStorage.setItem("stitch_db", JSON.stringify(db));
  } catch (e) {}
}

function deleteInvoiceLocal(id) {
  var list = getInvoicesFromLocal().filter(function (x) {
    return x.id !== id;
  });
  writeInvoicesToLocal(list);
}

function renderInvoiceDetail(inv) {
  try {
    var set = function (id, v) {
      var el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set("invoice-number", inv.number || "");
    set("invoice-status", inv.status || "");
    set("invoice-from-name", inv.fromName || "Finca");
    set("invoice-from-address", inv.fromAddress || "");
    set("invoice-to-name", inv.party || "");
    set("invoice-to-address", inv.toAddress || "");
    set("invoice-issue-date", inv.date || "");
    set("invoice-due-date", inv.dueDate || "");
    set("invoice-total", money(inv.amount || 0));
  } catch (e) {
    console.warn("[invoices] renderInvoiceDetail error:", e);
  }
}

function renderInvoicesTable() {
  var tbody = document.querySelector("main table tbody");
  if (!tbody) return;

  var rows = getInvoicesFromLocal();

  tbody.innerHTML = rows
    .map(function (r) {
      return (
        '<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">' +
        '<td class="px-4 py-3 text-gray-800 text-sm font-medium">' +
        (r.number || "") +
        "</td>" +
        '<td class="px-4 py-3 text-gray-500 text-sm">' +
        (r.party || "") +
        "</td>" +
        '<td class="px-4 py-3 text-gray-500 text-sm">' +
        (r.date || "") +
        "</td>" +
        '<td class="px-4 py-3 text-gray-500 text-sm">' +
        money(r.amount) +
        "</td>" +
        '<td class="px-4 py-3 text-sm">' +
        '<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-800">' +
        (r.status || "") +
        "</span>" +
        "</td>" +
        '<td class="px-4 py-3 text-right">' +
        '<button data-id="' +
        r.id +
        '" class="text-gray-400 hover:text-gray-800 mr-2 btn-inv-view"><span class="material-symbols-outlined">visibility</span></button>' +
        '<button data-id="' +
        r.id +
        '" class="text-red-600 hover:text-red-800 btn-inv-del"><span class="material-symbols-outlined">delete</span></button>' +
        "</td>" +
        "</tr>"
      );
    })
    .join("");

  tbody.querySelectorAll(".btn-inv-del").forEach(function (b) {
    b.addEventListener("click", function () {
      var id = parseInt(b.getAttribute("data-id"), 10);
      if (!confirm("Eliminar factura #" + id + "?")) return;
      deleteInvoiceLocal(id);
      renderInvoicesTable();
    });
  });

  tbody.querySelectorAll(".btn-inv-view").forEach(function (b) {
    b.addEventListener("click", function () {
      var id = parseInt(b.getAttribute("data-id"), 10);
      var inv = getInvoicesFromLocal().find(function (x) {
        return x.id === id;
      });
      if (!inv) return alert("Factura no encontrada");
      renderInvoiceDetail(inv);
    });
  });
}

// ✅ ESTE ES EL EXPORT QUE TE FALTA
export function initInvoicesPage() {
  try {
    if (!isInvoicesPage()) return;
    renderInvoicesTable();
  } catch (e) {
    console.warn("[invoices] init error:", e);
  }
}