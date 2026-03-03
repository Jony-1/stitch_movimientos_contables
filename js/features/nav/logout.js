// js/features/nav/logout.js
"use strict";

export function initLogoutLinks() {
  try {
    document.querySelectorAll("a").forEach(function (a) {
      try {
        var t = (a.innerText || "").trim().toLowerCase();
        if (t === "cerrar sesión" || t === "cerrar sesion" || t === "logout") {
          a.addEventListener("click", async function (e) {
            e.preventDefault();
            try {
              await fetch("/logout", { method: "POST" });
            } catch {}
            window.location.href = a.getAttribute("href") || "/";
          });
        }
      } catch (e) {}
    });
  } catch (e) {
    console.warn("[logout] error:", e);
  }
}