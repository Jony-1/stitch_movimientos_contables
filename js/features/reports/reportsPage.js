// js/features/reports/reportsPage.js
"use strict";



function money(n) {
  var sign = n < 0 ? "-" : "";
  var v = Math.abs(Number(n) || 0);
  return sign + "$ " + v.toLocaleString("es-CO");
}

function setCardValueByLabel(labelContains, valueText) {
  // Busca tarjetas por texto (fallback para no depender de IDs)
  var roots = document.querySelectorAll(".layout-content-container, .max-w-7xl, .grid");
  Array.prototype.forEach.call(roots, function (root) {
    try {
      var ps = root.querySelectorAll("p, h3, div");
      for (var i = 0; i < ps.length; i++) {
        var el = ps[i];
        var txt = (el.textContent || "").toLowerCase();
        if (txt.indexOf(labelContains) !== -1) {
          var strong = root.querySelector(".text-2xl");
          if (strong) strong.textContent = valueText;
          return;
        }
      }
    } catch (e) {}
  });

  // Segundo fallback
  document
    .querySelectorAll(".layout-content-container p.text-2xl, .layout-content-container .text-2xl")
    .forEach(function (el) {
      try {
        var parent = el.parentElement || el;
        var label = parent.querySelector("p") || parent.querySelector("h3");
        if (!label) return;
        var t = (label.textContent || "").toLowerCase();
        if (t.indexOf(labelContains) !== -1) el.textContent = valueText;
      } catch (e) {}
    });
}

async function renderReports() {
  // Si no es la página de reportes, no hacemos nada
  var file = (window.location.pathname || "").split("/").pop() || "";
  file = (file.split("?")[0] || "").split("#")[0];
  if (!/reportes/i.test(file)) return;

  var movements = [];
  try {
    movements = await movementsApi.list();
  } catch (e) {
    console.warn("[reportsPage] No se pudo cargar /api/movements:", e);
    return;
  }

  var ingresos = movements
    .filter(function (m) {
      return (Number(m.amount) || 0) > 0;
    })
    .reduce(function (s, x) {
      return s + (Number(x.amount) || 0);
    }, 0);

  var gastos = movements
    .filter(function (m) {
      return (Number(m.amount) || 0) < 0;
    })
    .reduce(function (s, x) {
      return s + Math.abs(Number(x.amount) || 0);
    }, 0);

  var resultado = ingresos - gastos;

  // Actualiza por etiquetas (sin IDs)
  setCardValueByLabel("ingresos", money(ingresos));
  setCardValueByLabel("gastos", money(gastos));
  setCardValueByLabel("resultado", money(resultado));

  // Extra: si el HTML trae textos exactos
  document.querySelectorAll(".layout-content-container div").forEach(function (d) {
    try {
      var t = (d.textContent || "").toLowerCase();
      if (t.indexOf("ingresos totales") !== -1) {
        var strongIn = d.querySelector(".text-2xl");
        if (strongIn) strongIn.textContent = money(ingresos);
      }
      if (t.indexOf("gastos totales") !== -1) {
        var strongG = d.querySelector(".text-2xl");
        if (strongG) strongG.textContent = money(gastos);
      }
      if (t.indexOf("resultado neto") !== -1) {
        var strongR = d.querySelector(".text-2xl");
        if (strongR) strongR.textContent = money(resultado);
      }
    } catch (e) {}
  });
}

export function initReportsPage() {
  // corre una vez al cargar
  renderReports();
}