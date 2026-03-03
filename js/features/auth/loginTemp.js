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
    // simplemente rellenamos los campos con el usuario administrador predeterminado
    const emailInput = document.querySelector('input[name="email"]');
    const passwordInput = document.querySelector('input[name="password"]');
    if (!emailInput || !passwordInput) return;
    emailInput.value = "admin@example.com";
    passwordInput.value = "admin123";
  } catch (e) {
    console.warn("[loginTemp] init error:", e);
  }
}