import { apiJson, resetCsrfTokenCache } from "./api.js";

async function initRegisterPage() {
  const form = document.getElementById("register-form");
  const errorBox = document.getElementById("register-error");
  const submitButton = document.getElementById("register-submit");
  if (!form) return;

  const nameInput = form.querySelector('[name="name"]');
  const emailInput = form.querySelector('[name="email"]');
  const passwordInput = form.querySelector('[name="password"]');
  const confirmPasswordInput = form.querySelector('[name="confirmPassword"]');

  function setError(message) {
    if (errorBox) {
      errorBox.className = "min-h-5 text-sm text-red-600";
      errorBox.textContent = message || "";
    }
  }

  function clearError() {
    setError("");
  }

  function validateForm() {
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!name) return "Ingresa tu nombre";
    if (!email || !emailInput.checkValidity()) return "Ingresa un correo válido";
    if (password.length < 6) return "La contraseña debe tener al menos 6 caracteres";
    if (password !== confirmPassword) return "Las contraseñas no coinciden";
    return "";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    clearError();
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.classList.add("opacity-70");
      submitButton.textContent = "Creando cuenta...";
    }

    try {
      if (errorBox) {
        errorBox.className = "min-h-5 text-sm text-red-600";
        errorBox.textContent = "";
      }
      await apiJson("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameInput.value.trim(),
          email: emailInput.value.trim(),
          password: passwordInput.value,
        }),
      });
      resetCsrfTokenCache();
      window.location.href = "/dashboard";
    } catch (error) {
      setError(error.message || "No se pudo registrar");
    } finally {
      if (submitButton) submitButton.disabled = false;
      if (submitButton) submitButton.classList.remove("opacity-70");
      if (submitButton) submitButton.textContent = "Crear cuenta";
    }
  });
}

export { initRegisterPage };
