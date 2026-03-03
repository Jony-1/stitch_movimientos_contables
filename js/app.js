"use strict";

import { loadHeaderPartial } from "./core/header.js";
import { seedIfEmpty } from "./core/seedLocalDb.js";
import { initMovementsPage } from "./features/movements/movementsPage.js";
import { initInvoicesPage } from "./features/invoices/invoicesPage.js";
import { initReportsPage } from "./features/reports/reportsPage.js";
import { initUsersPage } from "./features/users/usersPage.js";
import { initLoginTemp } from "./features/auth/loginTemp.js";
import { initActiveLink } from "./features/nav/activeLink.js";
import { initLogoutLinks } from "./features/nav/logout.js";
import { runPageSanityChecks } from "./core/utils.js";

document.addEventListener("DOMContentLoaded", async function () {
  await loadHeaderPartial();
  seedIfEmpty();


  initLoginTemp();
  initLogoutLinks();
  initActiveLink();

  // Detectar página actual
  var file = (window.location.pathname || "").split("/").pop() || "index.html";
  file = file.split("?")[0].split("#")[0];

  if (/movimientos/i.test(file)) initMovementsPage();
  if (/facturas/i.test(file)) initInvoicesPage();
  if (/usuarios|configuraci/i.test(file)) initUsersPage();
  if (/reportes/i.test(file)) initReportsPage();

  runPageSanityChecks();
});