export async function loadHeaderPartial() {
  var holder = document.getElementById("app-header");
  if (!holder) return;

  try {
    var r = await fetch("/views/partials/header.html");
    if (!r.ok) throw new Error("No se pudo cargar header");
    holder.innerHTML = await r.text();
    document.dispatchEvent(new CustomEvent("app:header-loaded"));
  } catch (err) {
    console.warn("[header] partial not loaded:", err);
  }
}