import { apiJson, resetCsrfTokenCache } from "./api.js";
import { initAuthPage } from "./auth.js";

async function initLoginPage() {
  await initAuthPage();

  const form = document.getElementById("login-form");
  const errorBox = document.getElementById("login-error");
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  const registered = params.get("registered");
  if (errorBox && error) {
    errorBox.className = "min-h-5 text-sm text-red-600";
    errorBox.textContent = error;
  } else if (errorBox && registered) {
    errorBox.className = "min-h-5 text-sm text-green-600";
    errorBox.textContent = "Cuenta creada. Ahora puedes iniciar sesión.";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    if (errorBox) {
      errorBox.className = "min-h-5 text-sm text-red-600";
      errorBox.textContent = "";
    }

    const payload = {
      email: form.querySelector('[name="email"]').value,
      password: form.querySelector('[name="password"]').value,
    };

    try {
      if (errorBox) {
        errorBox.className = "min-h-5 text-sm text-red-600";
        errorBox.textContent = "";
      }
      await apiJson("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      resetCsrfTokenCache();
      window.location.href = "/dashboard";
    } catch (error) {
      if (errorBox) errorBox.textContent = error.message || "Error al iniciar sesión";
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

export { initLoginPage };
