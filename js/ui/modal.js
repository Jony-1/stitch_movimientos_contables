export function showModal(m) {
  if (!m) return;
  m.classList.remove("pointer-events-none", "opacity-0", "hidden");
  var panel = (m.querySelector(".transform") || m.querySelector(".transition-transform") || m.querySelector("div"));
  if (panel) panel.classList.remove("scale-95");
  m.setAttribute("aria-hidden", "false");
}

export function hideModal(m) {
  if (!m) return;
  // hide completely so mobile browsers don't accidentally route touches through
  m.classList.add("opacity-0", "pointer-events-none", "hidden");
  var panel = (m.querySelector(".transform") || m.querySelector(".transition-transform") || m.querySelector("div"));
  if (panel) panel.classList.add("scale-95");
  m.setAttribute("aria-hidden", "true");
}

export function wireGenericModals() {
  // openers
  Array.prototype.slice.call(document.querySelectorAll("[data-modal-target]")).forEach(function (btn) {
    var raw = (btn.getAttribute("data-modal-target") || "").trim();
    var targetId = raw.replace(/^#/, "") || ""; // Handles cases without '#'
    if (!targetId) return;

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var modal = document.getElementById(targetId);
      if (!modal) return;
      if (btn.hasAttribute("data-reset-form") || modal.hasAttribute("data-reset-form")) {
        try { var f = modal.querySelector("form"); if (f?.reset) f.reset(); } catch (e) {}
      }
      showModal(modal);
    });
  });

  // closers
  Array.prototype.slice.call(document.querySelectorAll("[data-modal-close]")).forEach(function (c) {
    c.addEventListener("click", function (e) {
      e.preventDefault();
      var modal = c.closest('[role="dialog"], .modal, .fixed') || c.closest(".modal-container");
      if (modal) hideModal(modal);
    });
  });

  // esc
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" && e.key !== "Esc") return;
    var open = Array.prototype.slice.call(document.querySelectorAll('[aria-hidden="false"]'));
    if (open.length) hideModal(open[open.length - 1]);
  });
}
