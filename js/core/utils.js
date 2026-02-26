export function log() {
  try {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[app]");
    if (window?.console?.log) window.console.log.apply(window.console, args);
  } catch (e) {}
}

export function money(n) {
  var sign = n < 0 ? "-" : "";
  var v = Math.abs(n);
  return sign + "$ " + v.toLocaleString("es-CO");
}

export function runPageSanityChecks() {
  var warnings = [];
  var holder = document.getElementById("app-header");
  if (!holder) warnings.push("Falta placeholder #app-header");

  var path = (window.location.pathname || "").split("/").pop() || "index.html";

  if (/movimientos/i.test(path)) {
    if (!document.querySelector("main table tbody")) warnings.push("Movimientos: falta main table tbody");
    if (!document.getElementById("new-movement-modal")) warnings.push("Movimientos: falta #new-movement-modal");
  }

  if (warnings.length) console.warn("[sanity]", warnings);
}