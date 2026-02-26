// js/features/nav/activeLink.js
"use strict";

function norm(s) {
  return String(s || "").replace(/\.html$/i, "").toLowerCase();
}

export function initActiveLink() {
  try {
    var path = (window.location.pathname || "").split("/").pop() || "index.html";
    path = (path.split("?")[0] || "").split("#")[0] || "index.html";

    document.querySelectorAll("aside nav a, nav a").forEach(function (a) {
      try {
        var hrefAttr = a.getAttribute("href") || "";
        var href = (hrefAttr.split("/").pop() || "").split("?")[0].split("#")[0];
        if (!href) return;

        if (norm(href) === norm(path)) {
          a.classList.add("bg-primary/20", "text-primary");
        } else {
          a.classList.remove("bg-primary/20", "text-primary");
        }
      } catch (e) {}
    });
  } catch (e) {
    console.warn("[activeLink] error:", e);
  }
}