// js/features/nav/logout.js
"use strict";

export function initLogoutLinks() {
  try {
    document.querySelectorAll("a").forEach(function (a) {
      try {
        var t = (a.innerText || "").trim().toLowerCase();
        if (t === "cerrar sesión" || t === "cerrar sesion" || t === "logout") {
          a.addEventListener("click", function (e) {
            e.preventDefault();
            sessionStorage.removeItem("stitch_user");
            window.location.href = a.getAttribute("href") || "index.html";
          });
        }
      } catch (e) {}
    });
  } catch (e) {
    console.warn("[logout] error:", e);
  }
}