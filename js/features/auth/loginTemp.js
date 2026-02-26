// js/features/auth/loginTemp.js
"use strict";

function log() {
  try {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[loginTemp]");
    console.log.apply(console, args);
  } catch (e) {}
}

export function initLoginTemp() {
  try {
    var emailInput = document.querySelector('input[type="email"]');
    var passwordInput = document.querySelector('input[type="password"]');

    // botón por texto
    var loginButton = Array.prototype.find.call(
      document.querySelectorAll("button"),
      function (b) {
        try {
          return /iniciar sesi[oó]n/i.test(b.innerText || "");
        } catch (e) {
          return false;
        }
      }
    );

    // Si no estamos en la página de login, salimos sin hacer nada
    if (!emailInput || !passwordInput || !loginButton) return;

    log("Página de login detectada: inicializando login temporal");

    var TEMP_USER_EMAIL = "natalia@demo.com";
    var TEMP_USER_PW = "demo1234";
    var TEMP_USER_ROLE = "Productor";
    var TEMP_USER_AVATAR =
      "https://lh3.googleusercontent.com/aida-public/AB6AXuABlOezHcsZFyfX4XdY44kaIHQTYFQ8DCfPFg56TAA-ulG2PwnCRQ3r3KwhatA7TV9M2WGiv4BZs8GBWjsqnmebKQJPXG0L66gaW3-kKRknYxvMyDSrk2ExB0FIJW28zSWq5NwJObf-Ip6FzHWUsbE8aYhVpHMpgOY8foA5yDmWK7vDJbjgyTtvPfr19yyR92ZpyGmJUcukc5rcu2fxehicahCZJbSrX83C5imSRZsKWjT8ytmqGJrjuTNY9rDf1CZGvgdz1t_Vii7A";

    var formContainer =
      loginButton.closest(".layout-content-container") || loginButton.parentElement;

    var errEl = formContainer ? formContainer.querySelector(".appjs-login-error") : null;
    if (!errEl && formContainer) {
      errEl = document.createElement("div");
      errEl.className = "appjs-login-error text-sm text-red-600 mt-2";
      errEl.style.display = "none";
      formContainer.appendChild(errEl);
    }

    loginButton.addEventListener("click", function (e) {
      e.preventDefault();

      var em = (emailInput.value || "").trim();
      var pw = (passwordInput.value || "").trim();

      if (!em || !pw) {
        if (errEl) {
          errEl.textContent = "Ingrese correo y contraseña.";
          errEl.style.display = "block";
        } else {
          alert("Ingrese correo y contraseña.");
        }
        return;
      }

      if (em.toLowerCase() === TEMP_USER_EMAIL && pw === TEMP_USER_PW) {
        var inferredName = (em || "").split("@")[0] || "user";
        sessionStorage.setItem(
          "stitch_user",
          JSON.stringify({
            email: em,
            name: inferredName,
            role: TEMP_USER_ROLE,
            avatar: TEMP_USER_AVATAR,
          })
        );

        // ajusta si tu dashboard tiene otro nombre
        window.location.href = "dashboard.html";
      } else {
        var msg =
          "Credenciales incorrectas. Usuario temporal: " +
          TEMP_USER_EMAIL +
          " / " +
          TEMP_USER_PW;

        if (errEl) {
          errEl.textContent = msg;
          errEl.style.display = "block";
        } else {
          alert(msg);
        }
      }
    });
  } catch (e) {
    console.warn("[loginTemp] init error:", e);
  }
}