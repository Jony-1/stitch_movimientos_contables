"use strict";

// Script centralizado para comportamientos comunes de la UI.
// Añade una "base de datos" simulada en localStorage y renderizadores por página.
(function () {
  // Ejecutar la inicialización cuando el DOM esté listo — así los modales definidos al final de HTML serán encontrados
  document.addEventListener('DOMContentLoaded', function () {
    // --- Cargar header compartido (partial) si el placeholder existe ---
    (function loadHeaderPartial() {
      var holder = document.getElementById("app-header");
      if (!holder) return; // nada que hacer

      fetch("partials/header.html")
        .then(function (r) {
          if (!r.ok) throw new Error("No se pudo cargar header");
          return r.text();
        })
        .then(function (html) {
          holder.innerHTML = html;
          document.dispatchEvent(new CustomEvent("app:header-loaded"));
        })
        .catch(function (err) {
          console.warn("[app.js] header partial not loaded:", err);
        });
    })();
    // Constantes / helpers
    var DB_KEY = "stitch_db";
    function log() {
      try {
        var args = Array.prototype.slice.call(arguments);
        args.unshift("[app.js]");
        if (window && window.console && typeof window.console.log === "function")
          window.console.log.apply(window.console, args);
      } catch (e) {}
    }
  function seedIfEmpty() {
    var raw = localStorage.getItem(DB_KEY);
    if (raw) return;

    var sample = {
      movements: [
        {
          id: 1,
          date: "2023-11-10",
          type: "gasto",
          category: "Semillas",
          description: "Compra de semilla certificada",
          amount: -120000,
          status: "Registrado",
        },
        {
          id: 2,
          date: "2023-11-05",
          type: "gasto",
          category: "Mano de obra",
          description: "Pago jornaleros recolección",
          amount: -600000,
          status: "Borrador",
        },
        {
          id: 3,
          date: "2023-10-28",
          type: "gasto",
          category: "Abonos",
          description: "Compra de fertilizante triple 15",
          amount: -450000,
          status: "Registrado",
        },
        {
          id: 4,
          date: "2023-10-20",
          type: "ingreso",
          category: "Venta de papa",
          description: "Venta 20 bultos",
          amount: 2500000,
          status: "Registrado",
        },
      ],
      invoices: [
        {
          id: 1,
          number: "FAC-001",
          party: "Comprador A",
          date: "2023-10-25",
          amount: 2500000,
          status: "Pagada",
        },
        {
          id: 2,
          number: "FAC-002",
          party: "Proveedor AgroInsumos",
          date: "2023-10-15",
          amount: 850000,
          status: "Pendiente",
        },
      ],
      users: [],
      requests: [],
    };

    localStorage.setItem(DB_KEY, JSON.stringify(sample));
    log("DB seeded with sample data");
  }

  function dbRead() {
    try {
      return JSON.parse(localStorage.getItem(DB_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function dbWrite(obj) {
    localStorage.setItem(DB_KEY, JSON.stringify(obj));
  }

  // --- Movements helpers ---
  function getMovements() {
    return (dbRead().movements || [])
      .slice()
      .sort(function (a, b) {
        return b.id - a.id;
      });
  }

  function addMovement(item) {
    var db = dbRead();
    db.movements = db.movements || [];
    item.id =
      (db.movements.reduce(function (m, x) {
        return Math.max(m, x.id || 0);
      }, 0) || 0) + 1;
    db.movements.push(item);
    dbWrite(db);
    return item;
  }

  function updateMovement(id, changes) {
    var db = dbRead();
    db.movements = db.movements || [];
    var idx = db.movements.findIndex(function (m) {
      return m.id === id;
    });
    if (idx === -1) return null;
    db.movements[idx] = Object.assign({}, db.movements[idx], changes);
    dbWrite(db);
    return db.movements[idx];
  }

  function deleteMovement(id) {
    var db = dbRead();
    db.movements = (db.movements || []).filter(function (m) {
      return m.id !== id;
    });
    dbWrite(db);
  }

  // --- Invoices helpers ---
  function getInvoices() {
    return (dbRead().invoices || [])
      .slice()
      .sort(function (a, b) {
        return b.id - a.id;
      });
  }

  function addInvoice(item) {
    var db = dbRead();
    db.invoices = db.invoices || [];
    item.id =
      (db.invoices.reduce(function (m, x) {
        return Math.max(m, x.id || 0);
      }, 0) || 0) + 1;
    db.invoices.push(item);
    dbWrite(db);
    return item;
  }

  function deleteInvoice(id) {
    var db = dbRead();
    db.invoices = (db.invoices || []).filter(function (i) {
      return i.id !== id;
    });
    dbWrite(db);
  }

  // --- Users & Requests helpers ---
  function getUsers() {
    return (dbRead().users || [])
      .slice()
      .sort(function (a, b) {
        return a.id - b.id;
      });
  }

  function addUser(u) {
    var db = dbRead();
    db.users = db.users || [];
    u.id =
      (db.users.reduce(function (m, x) {
        return Math.max(m, x.id || 0);
      }, 0) || 0) + 1;
    u.active =
      typeof u.active === "undefined" ? true : !!u.active;
    u.createdAt = u.createdAt || new Date().toISOString();
    db.users.push(u);
    dbWrite(db);
    return u;
  }

  function updateUser(id, changes) {
    var db = dbRead();
    db.users = db.users || [];
    var idx = db.users.findIndex(function (x) {
      return x.id === id;
    });
    if (idx === -1) return null;
    db.users[idx] = Object.assign({}, db.users[idx], changes);
    dbWrite(db);
    return db.users[idx];
  }

  function deleteUser(id) {
    var db = dbRead();
    db.users = (db.users || []).filter(function (x) {
      return x.id !== id;
    });
    dbWrite(db);
  }

  function getRequests() {
    return (dbRead().requests || [])
      .slice()
      .sort(function (a, b) {
        return b.id - a.id;
      });
  }

  function addRequest(r) {
    var db = dbRead();
    db.requests = db.requests || [];
    r.id =
      (db.requests.reduce(function (m, x) {
        return Math.max(m, x.id || 0);
      }, 0) || 0) + 1;
    r.status = r.status || "pending";
    r.createdAt = r.createdAt || new Date().toISOString();
    db.requests.push(r);
    dbWrite(db);
    return r;
  }

  function updateRequest(id, changes) {
    var db = dbRead();
    db.requests = db.requests || [];
    var idx = db.requests.findIndex(function (x) {
      return x.id === id;
    });
    if (idx === -1) return null;
    db.requests[idx] = Object.assign({}, db.requests[idx], changes);
    dbWrite(db);
    return db.requests[idx];
  }

  function deleteRequest(id) {
    var db = dbRead();
    db.requests = (db.requests || []).filter(function (x) {
      return x.id !== id;
    });
    dbWrite(db);
  }

  function ensureAdminRequestIfNoSession() {
    try {
      var userRaw = sessionStorage.getItem("stitch_user");
      var db = dbRead();
      db.users = db.users || [];
      db.requests = db.requests || [];

      if (!userRaw && (!db.users || db.users.length === 0)) {
        var exists = (db.requests || []).some(function (r) {
          return (
            (r.requestedRole || "").toLowerCase() === "admin" &&
            r.status === "pending"
          );
        });

        if (!exists) {
          addRequest({
            email: "admin@demo.com",
            name: "Administrador",
            requestedRole: "Admin",
            note: "Solicitud automática: crear admin por defecto",
            system: true,
          });
          log("Solicitud automática de admin creada en requests");
        }
      }
    } catch (e) {
      console.warn(e);
    }
  }

  // --- Render users / requests en configuraciones ---
  function renderUsers() {
    var container = document.getElementById("users-table-container");
    if (!container) return;

    var rows = getUsers();
    if (!rows.length) {
      container.innerHTML =
        '<div class="text-sm text-gray-500">No hay usuarios. Puedes crear uno con "Nuevo Usuario".</div>';
      return;
    }

    var html =
      '<div class="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50">' +
      '<table class="w-full">' +
      '<thead class="bg-gray-50 dark:bg-gray-900">' +
      "<tr>" +
      '<th class="px-4 py-2 text-left text-sm">Nombre</th>' +
      '<th class="px-4 py-2 text-left text-sm">Correo</th>' +
      '<th class="px-4 py-2 text-left text-sm">Rol</th>' +
      '<th class="px-4 py-2 text-left text-sm">Activo</th>' +
      '<th class="px-4 py-2 text-right text-sm">Acciones</th>' +
      "</tr>" +
      "</thead>" +
      '<tbody class="divide-y divide-gray-200 dark:divide-gray-800">' +
      rows
        .map(function (u) {
          return (
            '<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">' +
            '<td class="px-4 py-3">' +
            (u.name || "") +
            "</td>" +
            '<td class="px-4 py-3">' +
            (u.email || "") +
            "</td>" +
            '<td class="px-4 py-3">' +
            (u.role || "") +
            "</td>" +
            '<td class="px-4 py-3">' +
            (u.active ? "Sí" : "No") +
            "</td>" +
            '<td class="px-4 py-3 text-right">' +
            '<button data-id="' +
            u.id +
            '" class="btn-user-edit text-sm text-primary mr-2">Editar</button>' +
            '<button data-id="' +
            u.id +
            '" class="btn-user-del text-sm text-red-600">Eliminar</button>' +
            "</td>" +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table></div>";

    container.innerHTML = html;

    container.querySelectorAll(".btn-user-del").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = parseInt(b.getAttribute("data-id"), 10);
        if (!confirm("Eliminar usuario #" + id + "?")) return;
        deleteUser(id);
        renderUsers();
      });
    });

    container.querySelectorAll(".btn-user-edit").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = parseInt(b.getAttribute("data-id"), 10);
        var u = getUsers().find(function (x) {
          return x.id === id;
        });
        if (!u) return alert("Usuario no encontrado");
        openUserModal(u);
      });
    });
  }

  function renderRequests() {
    var box = document.getElementById("users-requests");
    if (!box) return;

    var reqs = getRequests();
    if (!reqs.length) {
      box.innerHTML =
        '<div class="text-sm text-gray-500">No hay solicitudes pendientes.</div>';
      return;
    }

    var html =
      '<div class="space-y-3">' +
      reqs
        .map(function (r) {
          return (
            '<div class="p-3 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 flex justify-between items-start">' +
            "<div>" +
            '<div class="text-sm font-medium">' +
            (r.name || "") +
            ' <span class="text-xs text-gray-500">(' +
            (r.email || "") +
            ")</span></div>" +
            '<div class="text-xs text-gray-500">Rol: ' +
            (r.requestedRole || "") +
            " • " +
            new Date(r.createdAt || "").toLocaleString() +
            "</div>" +
            '<div class="text-sm text-gray-700 mt-2">' +
            (r.note || "") +
            "</div>" +
            "</div>" +
            '<div class="flex flex-col gap-2">' +
            '<button data-id="' +
            r.id +
            '" class="btn-req-approve inline-flex items-center px-3 py-1 rounded bg-green-100 text-green-800">Aprobar</button>' +
            '<button data-id="' +
            r.id +
            '" class="btn-req-reject inline-flex items-center px-3 py-1 rounded bg-red-100 text-red-800">Rechazar</button>' +
            "</div>" +
            "</div>"
          );
        })
        .join("") +
      "</div>";

    box.innerHTML = html;

    box.querySelectorAll(".btn-req-approve").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = parseInt(b.getAttribute("data-id"), 10);
        var req = getRequests().find(function (x) {
          return x.id === id;
        });
        if (!req) return;

        addUser({
          name: req.name || req.email,
          email: req.email,
          role: req.requestedRole || "Productor",
          active: true,
        });

        updateRequest(id, { status: "approved" });
        renderRequests();
        renderUsers();
      });
    });

    box.querySelectorAll(".btn-req-reject").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = parseInt(b.getAttribute("data-id"), 10);
        if (!confirm("Rechazar solicitud #" + id + "?")) return;
        updateRequest(id, { status: "rejected" });
        renderRequests();
      });
    });
  }

  // --- Modal de usuario ---
  function openUserModal(user) {
    var modal = document.getElementById("modal-user");
    if (!modal) return;

    try {
      document.getElementById("form-user").reset();
      document.getElementById("user-name").value =
        user && user.name ? user.name : "";
      document.getElementById("user-email").value =
        user && user.email ? user.email : "";
      document.getElementById("user-role").value =
        user && user.role ? user.role : "Productor";
      document.getElementById("user-active").checked =
        user && typeof user.active !== "undefined"
          ? !!user.active
          : true;

      modal._editingId = user && user.id ? user.id : null;
      showModal(modal);
    } catch (e) {
      console.warn(e);
    }
  }

  // Wire botones de usuario (nuevo / guardar / cancelar)
  (function wireUserModal() {
    try {
      var btnNewUser = document.getElementById("btn-new-user");
      var modalUser = document.getElementById("modal-user");
      if (!btnNewUser || !modalUser) return;

      var btnCancel = document.getElementById("user-cancel");
      var btnSave = document.getElementById("user-save");

      btnNewUser.addEventListener("click", function (e) {
        e.preventDefault();
        openUserModal(null);
      });

      if (btnCancel) {
        btnCancel.addEventListener("click", function (e) {
          e.preventDefault();
          hideModal(modalUser);
        });
      }

      if (btnSave) {
        btnSave.addEventListener("click", function (e) {
          e.preventDefault();
          var name = (document.getElementById("user-name").value || "").trim();
          var email = (document.getElementById("user-email").value || "").trim();
          var role =
            document.getElementById("user-role").value || "Productor";
          var active = !!document.getElementById("user-active").checked;

          if (!name || !email) {
            alert("Nombre y correo son requeridos");
            return;
          }

          var editing = modalUser._editingId;
          if (editing) {
            updateUser(editing, {
              name: name,
              email: email,
              role: role,
              active: active,
            });
          } else {
            addUser({
              name: name,
              email: email,
              role: role,
              active: active,
            });
          }

          hideModal(modalUser);
          renderUsers();
        });
      }
    } catch (e) {
      console.warn(e);
    }
  })();

  // --- Formatting ---
  function money(n) {
    var sign = n < 0 ? "-" : "";
    var v = Math.abs(n);
    return sign + "$ " + v.toLocaleString("es-CO");
  }

  // --- Renderers por página ---
  function renderMovementsTable() {
    var tbody = document.querySelector("main table tbody");
    if (!tbody) return;

    var rows = getMovements();
    tbody.innerHTML = rows
      .map(function (r) {
        var typeBadge =
          r.type === "ingreso"
            ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Ingreso</span>'
            : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Gasto</span>';

        var statusBadge =
          '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">' +
          (r.status || "") +
          "</span>";

        var actions =
          '<div class="flex items-center gap-2 justify-end">' +
          '<button data-id="' +
          r.id +
          '" class="btn-edit text-sm text-primary hover:underline">Editar</button>' +
          '<button data-id="' +
          r.id +
          '" class="btn-del text-sm text-red-600 hover:underline">Eliminar</button>' +
          "</div>";

        return (
          '<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">' +
          '<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">' +
          (r.date || "") +
          "</td>" +
          '<td class="px-6 py-4 whitespace-nowrap text-sm">' +
          typeBadge +
          "</td>" +
          '<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">' +
          (r.category || "") +
          "</td>" +
          '<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">' +
          (r.description || "") +
          "</td>" +
          '<td class="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">' +
          money(r.amount) +
          "</td>" +
          '<td class="px-6 py-4 whitespace-nowrap text-sm">' +
          statusBadge +
          actions +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    // Wire actions
    tbody.querySelectorAll(".btn-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = parseInt(btn.getAttribute("data-id"), 10);
        if (!confirm("¿Eliminar movimiento #" + id + "?")) return;
        deleteMovement(id);
        renderMovementsTable();
        renderReports();
      });
    });

    tbody.querySelectorAll(".btn-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = parseInt(btn.getAttribute("data-id"), 10);
        var list = getMovements();
        var row = list.find(function (x) {
          return x.id === id;
        });
        if (!row) return alert("Movimiento no encontrado");

        var modal = document.getElementById("new-movement-modal");
        if (!modal) return;
        showModal(modal);

        try {
          modal.querySelector("#date").value = row.date || "";
          modal.querySelector(
            "input[name=type][value=" + (row.type || "ingreso") + "]"
          ).checked = true;
          modal.querySelector("#category").value = row.category || "";
          modal.querySelector("#description").value = row.description || "";
          modal.querySelector("#amount").value =
            Math.abs(row.amount || 0);

          // botón de guardar del modal
          var saveBtn = Array.prototype.slice
            .call(modal.querySelectorAll("button"))
            .reverse()[0];
          if (saveBtn) {
            saveBtn.onclick = function (ev) {
              ev.preventDefault();
              var payload = collectModal();
              payload.amount =
                payload.type === "gasto"
                  ? -Math.abs(payload.amount)
                  : Math.abs(payload.amount);
              updateMovement(id, payload);
              hideModal(modal);
              renderMovementsTable();
              renderReports();
            };
          }
        } catch (e) {
          console.warn(e);
        }
      });
    });
  }

  function renderInvoicesTable() {
    var tbody = document.querySelector("main table tbody");
    if (!tbody) return;

    // detectamos que estamos en la página de facturas
    var isFacturas = Array.prototype.some.call(
      document.querySelectorAll("table thead th"),
      function (th) {
        return /Número de Factura/i.test(th.textContent || "");
      }
    );
    if (!isFacturas) return;

    var rows = getInvoices();
    tbody.innerHTML = rows
      .map(function (r) {
        return (
          '<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">' +
          '<td class="px-4 py-3 text-gray-800 text-sm font-medium">' +
          (r.number || "") +
          "</td>" +
          '<td class="px-4 py-3 text-gray-500 text-sm">' +
          (r.party || "") +
          "</td>" +
          '<td class="px-4 py-3 text-gray-500 text-sm">' +
          (r.date || "") +
          "</td>" +
          '<td class="px-4 py-3 text-gray-500 text-sm">' +
          money(r.amount) +
          "</td>" +
          '<td class="px-4 py-3 text-sm">' +
          '<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-800">' +
          (r.status || "") +
          "</span>" +
          "</td>" +
          '<td class="px-4 py-3 text-right">' +
          '<button data-id="' +
          r.id +
          '" class="text-gray-400 hover:text-gray-800 mr-2 btn-inv-view"><span class="material-symbols-outlined">visibility</span></button>' +
          '<button data-id="' +
          r.id +
          '" class="text-red-600 hover:text-red-800 btn-inv-del"><span class="material-symbols-outlined">delete</span></button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    tbody.querySelectorAll(".btn-inv-del").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = parseInt(b.getAttribute("data-id"), 10);
        if (!confirm("Eliminar factura #" + id + "?")) return;
        deleteInvoice(id);
        renderInvoicesTable();
      });
    });

    tbody.querySelectorAll(".btn-inv-view").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = parseInt(b.getAttribute("data-id"), 10);
        var inv = getInvoices().find(function (x) {
          return x.id === id;
        });
        if (!inv) return alert("Factura no encontrada");
        renderInvoiceDetail(inv);
      });
    });
  }

  function renderInvoiceDetail(inv) {
    try {
      var set = function (id, v) {
        var el = document.getElementById(id);
        if (el) el.textContent = v;
      };
      set("invoice-number", inv.number || "");
      set("invoice-status", inv.status || "");
      set("invoice-from-name", inv.fromName || "Finca");
      set("invoice-from-address", inv.fromAddress || "");
      set("invoice-to-name", inv.party || "");
      set("invoice-to-address", inv.toAddress || "");
      set("invoice-issue-date", inv.date || "");
      set("invoice-due-date", inv.dueDate || "");
      set("invoice-total", money(inv.amount || 0));
    } catch (e) {
      console.warn(e);
    }
  }

  // Crear factura - botón y flujo simple
  (function wireInvoiceModal() {
    try {
      var btnNewInv = document.getElementById("btn-new-invoice");
      var modalInv = document.getElementById("modal-invoice");
      if (!btnNewInv || !modalInv) return;

      var formInv = document.getElementById("form-invoice");
      var btnCancel = document.getElementById("inv-cancel");
      var btnSave = document.getElementById("inv-save");

      btnNewInv.addEventListener("click", function (e) {
        e.preventDefault();
        if (formInv) formInv.reset();
        showModal(modalInv);
      });

      if (btnCancel) {
        btnCancel.addEventListener("click", function (ev) {
          ev.preventDefault();
          hideModal(modalInv);
        });
      }

      if (btnSave) {
        btnSave.addEventListener("click", function (ev) {
          ev.preventDefault();
          var number = (document.getElementById("inv-number").value || "").trim();
          var party = (document.getElementById("inv-party").value || "").trim();
          var date = (document.getElementById("inv-date").value || "").trim();
          var due = (document.getElementById("inv-due").value || "").trim();
          var amount =
            parseFloat(document.getElementById("inv-amount").value || 0) || 0;
          var status =
            document.getElementById("inv-status").value || "Pendiente";

          if (!number) {
            alert("Ingrese número de factura");
            return;
          }

          var inv = addInvoice({
            number: number,
            party: party,
            date: date,
            dueDate: due,
            amount: amount,
            status: status,
          });

          renderInvoicesTable();
          renderInvoiceDetail(inv);
          hideModal(modalInv);
        });
      }
    } catch (e) {
      console.warn(e);
    }
  })();

  // --- Reports ---
  function renderReports() {
    var movements = getMovements();

    var ingresos = movements
      .filter(function (m) {
        return (m.amount || 0) > 0;
      })
      .reduce(function (s, x) {
        return s + (x.amount || 0);
      }, 0);

    var gastos = movements
      .filter(function (m) {
        return (m.amount || 0) < 0;
      })
      .reduce(function (s, x) {
        return s + Math.abs(x.amount || 0);
      }, 0);

    // Actualizar tarjetas por texto
    document
      .querySelectorAll(
        ".layout-content-container, .max-w-7xl, .grid"
      )
      .forEach(function (root) {
        try {
          var ps = root.querySelectorAll("p, h3, div");
          for (var i = 0; i < ps.length; i++) {
            var el = ps[i];
            var txt = (el.textContent || "").toLowerCase();
            if (
              txt.indexOf("ingresos totales") !== -1 ||
              txt.indexOf("ingresos") !== -1
            ) {
              var strong = root.querySelector(".text-2xl");
              if (strong) strong.textContent = money(ingresos);
              break;
            }
          }
        } catch (e) {}
      });

    // Fallback: buscar por texto en h3/p y actualizar el elemento con clase text-2xl
    document
      .querySelectorAll(
        ".layout-content-container p.text-2xl, .layout-content-container p.text-2xl.font-bold, .layout-content-container p.text-2xl.font-bold.leading-tight"
      )
      .forEach(function (el) {
        var parent = el.parentElement || el;
        var label = parent.querySelector("p") || parent.querySelector("h3");
        if (!label) return;
        var txt = (label.textContent || "").toLowerCase();
        if (txt.indexOf("ingresos") !== -1) el.textContent = money(ingresos);
        if (txt.indexOf("gastos") !== -1) el.textContent = money(gastos);
        if (txt.indexOf("resultado") !== -1)
          el.textContent = money(ingresos - gastos);
      });

  // Además actualizar anywhere with exact substrings (scoped to content area)
  document.querySelectorAll(".layout-content-container div").forEach(function (d) {
      try {
        var t = (d.textContent || "").toLowerCase();
        if (t.indexOf("ingresos totales") !== -1) {
          var strongIn = d.querySelector(".text-2xl");
          if (strongIn) strongIn.textContent = money(ingresos);
        }
        if (t.indexOf("gastos totales") !== -1) {
          var strongG = d.querySelector(".text-2xl");
          if (strongG) strongG.textContent = money(gastos);
        }
        if (t.indexOf("resultado neto") !== -1) {
          var strongR = d.querySelector(".text-2xl");
          if (strongR) strongR.textContent = money(ingresos - gastos);
        }
      } catch (e) {}
    });
  }

  // --- Collect modal form values (movimientos) ---
  function collectModal() {
    var modal = document.getElementById("new-movement-modal");
    if (!modal) return {};
    var date = modal.querySelector("#date").value;
    var typeEl = modal.querySelector('input[name="type"]:checked');
    var type = typeEl ? typeEl.value : "ingreso";
    var category = modal.querySelector("#category").value;
    var description = modal.querySelector("#description").value;
    var amount = parseFloat(
      modal.querySelector("#amount").value || "0"
    );
    var status = "Registrado";
    return {
      date: date,
      type: type,
      category: category,
      description: description,
      amount: amount,
      status: status,
    };
  }

  // --- Modal control (show/hide) ---
  var movementModal = document.getElementById("new-movement-modal");

  function showModal(m) {
    if (!m) return;
    m.classList.remove("pointer-events-none");
    m.classList.remove("opacity-0");

    var panel =
      m.querySelector(".transform") ||
      m.querySelector(".transition-transform") ||
      m.querySelector("div");
    if (panel) panel.classList.remove("scale-95");

    m.setAttribute("aria-hidden", "false");
    var firstInput =
      m.querySelector("input, textarea, select, button");
    if (firstInput) firstInput.focus();
  }

  function hideModal(m) {
    if (!m) return;
    m.classList.add("opacity-0");
    m.classList.add("pointer-events-none");
    var panel =
      m.querySelector(".transform") ||
      m.querySelector(".transition-transform") ||
      m.querySelector("div");
    if (panel) panel.classList.add("scale-95");
    m.setAttribute("aria-hidden", "true");
  }

  // --- Generic modal wiring: triggers via data-modal-target, closers via data-modal-close
  (function wireGenericModals() {
    try {
      // Openers: elements with [data-modal-target="#modal-id"] or [data-modal-target="modal-id"]
      Array.prototype.slice.call(document.querySelectorAll('[data-modal-target]')).forEach(function (btn) {
        try {
          var raw = btn.getAttribute('data-modal-target') || '';
          var targetId = raw.trim().replace(/^#/, '');
          if (!targetId) return;
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            var modal = document.getElementById(targetId);
            if (!modal) return;
            // reset form inside modal if present and attribute set
            if (btn.hasAttribute('data-reset-form') || modal.hasAttribute('data-reset-form')) {
              try { var f = modal.querySelector('form'); if (f && typeof f.reset === 'function') f.reset(); } catch (e) {}
            }
            showModal(modal);
          });
        } catch (e) {}
      });

      // Closers: elements inside modal with [data-modal-close]
      Array.prototype.slice.call(document.querySelectorAll('[data-modal-close]')).forEach(function (c) {
        try {
          c.addEventListener('click', function (e) {
            e.preventDefault();
            var modal = c.closest('[role="dialog"], .modal, .fixed');
            if (!modal) modal = c.closest('.modal-container') || document.getElementById(c.getAttribute('data-modal-close-target'));
            if (modal) hideModal(modal);
          });
        } catch (e) {}
      });

      // Click backdrop to close: any element with attribute data-modal-backdrop
      Array.prototype.slice.call(document.querySelectorAll('[data-modal-backdrop]')).forEach(function (m) {
        try {
          m.addEventListener('click', function (ev) { if (ev.target === m) hideModal(m); });
        } catch (e) {}
      });

      // Global ESC: close top-most open modal
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' && e.key !== 'Esc') return;
        try {
          var open = Array.prototype.slice.call(document.querySelectorAll('[aria-hidden="false"]'));
          if (open && open.length) {
            // close last opened
            hideModal(open[open.length - 1]);
          }
        } catch (e) {}
      });
    } catch (e) {}
  })();

  if (movementModal) {
    // abrir modal desde botones que contienen la frase "nuevo movimiento"
    Array.prototype.slice
      .call(document.querySelectorAll("button"))
      .forEach(function (b) {
        try {
          var t = (b.innerText || "").trim().toLowerCase();
          if (
            /nuevo movimiento/.test(t) ||
            /\+ nuevo movimiento/.test(t)
          ) {
            b.addEventListener("click", function (ev) {
              ev.preventDefault();
              try {
                movementModal.querySelector("form").reset();
              } catch (e) {}
              var saveBtn = Array.prototype.slice
                .call(movementModal.querySelectorAll("button"))
                .reverse()[0];
              if (saveBtn) {
                saveBtn.onclick = function (ev2) {
                  ev2.preventDefault();
                  var payload = collectModal();
                  payload.amount =
                    payload.type === "gasto"
                      ? -Math.abs(payload.amount)
                      : Math.abs(payload.amount);
                  addMovement(payload);
                  hideModal(movementModal);
                  renderMovementsTable();
                  renderReports();
                };
              }
              showModal(movementModal);
            });
          }
        } catch (e) {}
      });

    // backdrop and cancel/close
    movementModal.addEventListener("click", function (ev) {
      if (ev.target === movementModal) hideModal(movementModal);
    });

    Array.prototype.forEach.call(
      movementModal.querySelectorAll("button"),
      function (b) {
        try {
          var txt = (b.innerText || "").trim().toLowerCase();
          var icon = b.querySelector(".material-symbols-outlined");
          var iconText = icon
            ? (icon.textContent || "").trim().toLowerCase()
            : "";
          if (
            txt === "cancelar" ||
            txt === "cerrar" ||
            iconText === "close"
          ) {
            b.addEventListener("click", function (e) {
              e.preventDefault();
              hideModal(movementModal);
            });
          }
        } catch (e) {}
      }
    );

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" || e.key === "Esc") {
        hideModal(movementModal);
      }
    });
  }

  // --- Toggle password visibility ---
  try {
    var togglePwBtn = document.querySelector(
      'button[aria-label*="Mostrar"]'
    );
    if (togglePwBtn) {
      var pwInput =
        togglePwBtn.parentElement.querySelector(
          'input[type="password"]'
        );
      togglePwBtn.addEventListener("click", function () {
        if (!pwInput) return;
        var icon = togglePwBtn.querySelector(
          ".material-symbols-outlined"
        );
        if (pwInput.type === "password") {
          pwInput.type = "text";
          if (icon) icon.textContent = "visibility_off";
        } else {
          pwInput.type = "password";
          if (icon) icon.textContent = "visibility";
        }
      });
    }
  } catch (e) {}

  // --- Login temporal ---
  try {
    var emailInput = document.querySelector('input[type="email"]');
    var passwordInput = document.querySelector(
      'input[type="password"]'
    );
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

    if (emailInput && passwordInput && loginButton) {
      log("Página de login detectada: inicializando login temporal");

      var TEMP_USER_EMAIL = "natalia@demo.com";
      var TEMP_USER_PW = "demo1234";
      var TEMP_USER_ROLE = "Productor";
      var TEMP_USER_AVATAR =
        "https://lh3.googleusercontent.com/aida-public/AB6AXuABlOezHcsZFyfX4XdY44kaIHQTYFQ8DCfPFg56TAA-ulG2PwnCRQ3r3KwhatA7TV9M2WGiv4BZs8GBWjsqnmebKQJPXG0L66gaW3-kKRknYxvMyDSrk2ExB0FIJW28zSWq5NwJObf-Ip6FzHWUsbE8aYhVpHMpgOY8foA5yDmWK7vDJbjgyTtvPfr19yyR92ZpyGmJUcukc5rcu2fxehicahCZJbSrX83C5imSRZsKWjT8ytmqGJrjuTNY9rDf1CZGvgdz1t_Vii7A";

      var formContainer =
        loginButton.closest(".layout-content-container") ||
        loginButton.parentElement;

      var errEl = formContainer.querySelector(".appjs-login-error");
      if (!errEl) {
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
          errEl.textContent = "Ingrese correo y contraseña.";
          errEl.style.display = "block";
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
          // AJUSTA ESTA RUTA SI TU DASHBOARD TIENE OTRO NOMBRE
          window.location.href = "dashboard.html";
        } else {
          errEl.textContent =
            "Credenciales incorrectas. Usuario temporal: " +
            TEMP_USER_EMAIL +
            " / " +
            TEMP_USER_PW;
          errEl.style.display = "block";
        }
      });
    }
  } catch (e) {}

  // --- Header population and logout wiring ---
  (function () {
    function populateHeaderUser() {
      try {
        var userRaw = sessionStorage.getItem("stitch_user");
        if (!userRaw) return;
        var user = JSON.parse(userRaw);

        try {
          var headerNameEl = document.querySelector(
            ".app-header-name .font-semibold"
          );
          var headerRoleEl = document.querySelector(
            ".app-header-name p:nth-child(2)"
          );
          var emailEl = document.querySelector(".app-header-email");
          var avatarEl = document.querySelector(".app-avatar");
          var logoutLink = document.querySelector(".app-logout-link");

          if (headerNameEl)
            headerNameEl.textContent =
              user.name || (user.email || "Usuario").split("@")[0];
          if (headerRoleEl)
            headerRoleEl.textContent = user.role || "Productor";
          if (emailEl) emailEl.textContent = user.email || "";
          if (avatarEl && user.avatar)
            avatarEl.style.backgroundImage = 'url("' + user.avatar + '")';

          if (logoutLink) {
            logoutLink.removeEventListener(
              "click",
              logoutLink._appListener
            );
            logoutLink._appListener = function (e) {
              e.preventDefault();
              sessionStorage.removeItem("stitch_user");
              window.location.href =
                logoutLink.getAttribute("href") || "index.html";
            };
            logoutLink.addEventListener(
              "click",
              logoutLink._appListener
            );
          }
        } catch (e) {}
      } catch (e) {}
    }

    try {
      populateHeaderUser();
    } catch (e) {}

    document.addEventListener("app:header-loaded", function () {
      try {
        populateHeaderUser();
      } catch (e) {}
    });
  })();

  // --- Action buttons (download/print/more) ---
  try {
    document.querySelectorAll("button").forEach(function (b) {
      try {
        var icon = b.querySelector(".material-symbols-outlined");
        if (!icon) return;
        var name = (icon.textContent || "").trim().toLowerCase();
        if (name === "more_vert") {
          b.addEventListener("click", function (e) {
            e.preventDefault();
            alert(
              "Acciones disponibles: Ver / Editar / Eliminar (placeholder)"
            );
          });
        }
        if (name === "download") {
          b.addEventListener("click", function (e) {
            e.preventDefault();
            alert("Exportar no implementado.");
          });
        }
        if (name === "print") {
          b.addEventListener("click", function (e) {
            e.preventDefault();
            window.print();
          });
        }
      } catch (e) {}
    });
  } catch (e) {}

  // --- Resaltado de enlace activo en sidebar ---
  try {
    var path = (window.location.pathname || "").split("/").pop() || "index.html";
    path = (path.split("?")[0] || "").split("#")[0] || "index.html";

    document
      .querySelectorAll("aside nav a, nav a")
      .forEach(function (a) {
        try {
          var hrefAttr = a.getAttribute("href") || "";
          var href = (hrefAttr.split("/").pop() || "")
            .split("?")[0]
            .split("#")[0];
          if (!href) return;

          var norm = function (s) {
            return (s || "").replace(/\.html$/i, "").toLowerCase();
          };

          if (norm(href) === norm(path)) {
            a.classList.add("bg-primary/20");
            a.classList.add("text-primary");
          } else {
            a.classList.remove("bg-primary/20");
            a.classList.remove("text-primary");
          }
        } catch (e) {}
      });
  } catch (e) {}

  // --- Logout links por texto (fallback) ---
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
  } catch (e) {}

  // --- Inicializar DB y render según página ---
  seedIfEmpty();

  try {
    ensureAdminRequestIfNoSession();
  } catch (e) {}

  try {
    var file =
      (window.location.pathname || "").split("/").pop() || "index.html";
    file = file.split("?")[0].split("#")[0];

    if (/movimientos/i.test(file)) renderMovementsTable();
    if (/facturas/i.test(file)) renderInvoicesTable();
    if (/configuraci/i.test(file)) {
      try {
        renderUsers();
        renderRequests();
      } catch (e) {}
    }
    if (/reportes/i.test(file)) renderReports();
  } catch (e) {}

  // --- Sanity checks por página ---
  function runPageSanityChecks() {
    var warnings = [];
    var holder = document.getElementById("app-header");
    if (!holder)
      warnings.push(
        "Falta placeholder #app-header — el header compartido no se inyectará"
      );

    var path =
      (window.location.pathname || "").split("/").pop() || "index.html";

    if (/movimientos/i.test(path)) {
      if (!document.querySelector("main table tbody"))
        warnings.push(
          "Movimientos: falta <table> con <tbody> en la página (selector: main table tbody)"
        );
      if (!document.getElementById("new-movement-modal"))
        warnings.push(
          "Movimientos: falta el modal #new-movement-modal (nuevo movimiento)"
        );
    }

    if (/facturas/i.test(path)) {
      var found = Array.prototype.some.call(
        document.querySelectorAll("table thead th"),
        function (th) {
          return /Número de Factura/i.test(th.textContent || "");
        }
      );
      if (!found)
        warnings.push(
          'Facturas: no se detectó el header "Número de Factura" en la tabla — la renderización no correrá'
        );
    }

    if (/reportes/i.test(path)) {
      if (!document.querySelectorAll("p.text-2xl").length)
        warnings.push(
          "Reportes: no se detectaron elementos con clase text-2xl para mostrar totales — considera añadir IDs para una inyección fiable"
        );
    }

    if (warnings.length) {
      console.warn(
        "[app.js] Sanity checks — advertencias detectadas:\n - " +
          warnings.join("\n - ")
      );
    } else {
      console.log("[app.js] Sanity checks OK");
    }
  }

  runPageSanityChecks();
  log("Inicialización completada");
  });
})();
