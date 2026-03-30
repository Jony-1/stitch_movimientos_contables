// server.js
"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const {
  attachCsrfContext,
  attachSecurityHeaders,
  ensureAccountingWriteApi,
  ensureAdmin,
  ensureAdminApi,
  ensureApiAuth,
  ensureAuth,
  ensureGuest,
  getCsrfToken,
  requireCsrf,
} = require("./middleware/security");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  app.set("trust proxy", 1);
}

// =======================
// Middlewares
// =======================
attachSecurityHeaders(app, isProduction);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // para POST del login form

// sesión en memoria (ok para dev)
app.use(
    session({
      secret: process.env.SESSION_SECRET || "keyboard cat",
      resave: false,
      saveUninitialized: false,
      proxy: isProduction,
      cookie: { maxAge: 1000 * 60 * 60, sameSite: "lax", httpOnly: true, secure: isProduction ? "auto" : false }, // 1h
    })
  );

app.use(attachCsrfContext);

app.use(requireCsrf);

// ===== Static files =====
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/scripts", express.static(path.join(__dirname, "public/scripts")));
app.use(express.static(path.join(__dirname, "dist")));

const distDir = path.join(__dirname, "dist");

function sendAstroPage(res, page) {
  const pagePath = page === "index"
    ? path.join(distDir, "index.html")
    : path.join(distDir, page, "index.html");

  if (fs.existsSync(pagePath)) {
    return res.sendFile(pagePath);
  }
  return null;
}

function buildSessionUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name || "Usuario",
    role: String(user.role || "user").toLowerCase(),
  };
}

function parseIdParam(value) {
  const id = parseInt(value, 10);
  return Number.isNaN(id) ? null : id;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidAmount(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeInvoiceStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "pagada" || value === "paid") return "pagada";
  if (value === "vencida" || value === "vencido" || value === "overdue") return "vencida";
  return "pendiente";
}

function getInvoiceStatusKey(status) {
  return String(status || "").trim().toLowerCase();
}

function toInvoiceDbStatus(statusKey) {
  const key = getInvoiceStatusKey(statusKey);
  if (key === "pagada") return "Pagada";
  if (key === "vencida") return "Vencida";
  return "Pendiente";
}

async function ensureInvoiceItemColumns(client) {
  await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS quantity NUMERIC(15, 2) NOT NULL DEFAULT 1`);
  await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(15, 2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()`);
}

async function invoiceItemLineTotalIsGenerated(client) {
  const result = await client.query(
    `SELECT is_generated
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoice_items'
        AND column_name = 'line_total'`
  );

  return result.rows[0]?.is_generated === 'ALWAYS';
}

const INVOICE_SELECT_FIELDS = `
  id,
  number,
  party,
  date,
  duedate AS "dueDate",
  amount,
  status,
  paid_at,
  payment_movement_id AS "paymentMovementId",
  created_at,
  updated_at
`;

const INVOICE_ITEM_SELECT_FIELDS = `
  id,
  invoice_id AS "invoiceId",
  description,
  quantity,
  unit_price AS "unitPrice",
  line_total AS "lineTotal",
  sort_order AS "sortOrder",
  created_at,
  updated_at
`;

const MOVEMENT_TYPES = new Set(["ingreso", "gasto"]);

function normalizeMovementType(type) {
  return String(type || "").trim().toLowerCase();
}

function normalizeMovementAmount(type, amount) {
  return Math.abs(Number(amount || 0));
}

function isMovementType(type) {
  return MOVEMENT_TYPES.has(normalizeMovementType(type));
}

const MOVEMENT_SELECT_FIELDS = `
  id,
  date,
  type,
  category,
  description,
  invoice_id AS "invoiceId",
  source,
  CASE
    WHEN lower(type::text) = 'gasto' THEN -ABS(amount)
    WHEN lower(type::text) = 'ingreso' THEN ABS(amount)
    ELSE amount
  END AS amount,
  status,
  created_at,
  updated_at
`;

function normalizeRole(role) {
  const value = String(role || "").trim().toLowerCase();
  if (value === "admin") return "Admin";
  if (value === "contador") return "Contador";
  return "Productor";
}

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function toValidMoney(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeInvoiceItem(item, index) {
  const description = isNonEmptyString(item?.description)
    ? item.description.trim()
    : `Concepto ${index + 1}`;
  const quantity = Number(item?.quantity);
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const unitPrice = Number(item?.unitPrice ?? item?.price ?? item?.amount);
  const safeUnitPrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0;
  const lineTotal = Number((safeQuantity * safeUnitPrice).toFixed(2));

  return {
    description,
    quantity: safeQuantity,
    unitPrice: safeUnitPrice,
    lineTotal,
    sortOrder: index,
  };
}

function normalizeInvoiceItems(items, fallbackAmount) {
  if (Array.isArray(items)) {
    const normalized = items
      .map((item, index) => normalizeInvoiceItem(item, index))
      .filter((item) => item.description || item.quantity > 0 || item.unitPrice > 0 || item.lineTotal > 0);

    return {
      items: normalized,
      amount: normalized.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0),
    };
  }

  const amount = toValidMoney(fallbackAmount, 0);
  if (amount <= 0) {
    return { items: [], amount: 0 };
  }

  return {
    items: [
      {
        description: "Concepto general",
        quantity: 1,
        unitPrice: amount,
        lineTotal: amount,
        sortOrder: 0,
      },
    ],
    amount,
  };
}

function normalizeInvoicePaymentDate(value) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function upsertInvoicePaymentMovement(client, invoiceRow, { paidAt = null, note = "" } = {}) {
  if (!invoiceRow || getInvoiceStatusKey(invoiceRow.status) !== "pagada") {
    return invoiceRow;
  }

  const paymentDate = normalizeInvoicePaymentDate(paidAt);
  const movementDescription = note || `Pago factura ${invoiceRow.number}`;
  const movementCategory = "Cuentas por cobrar";

  let movementId = invoiceRow.paymentMovementId || null;

  if (movementId) {
    const updateResult = await client.query(
      `UPDATE movements
         SET date = $1, type = 'ingreso', category = $2, description = $3, amount = $4, status = 'Registrado', source = 'invoice-payment', invoice_id = $5, updated_at = NOW()
       WHERE id = $6`,
      [paymentDate.toISOString(), movementCategory, movementDescription, Math.abs(Number(invoiceRow.amount || 0)), invoiceRow.id, movementId]
    );
    if (updateResult.rowCount === 0) {
      movementId = null;
    }
  }

  if (!movementId) {
    const movementResult = await client.query(
      `INSERT INTO movements (date, type, category, description, amount, status, source, invoice_id)
       VALUES ($1, 'ingreso', $2, $3, $4, 'Registrado', 'invoice-payment', $5)
       RETURNING id`,
      [paymentDate.toISOString(), movementCategory, movementDescription, Math.abs(Number(invoiceRow.amount || 0)), invoiceRow.id]
    );
    movementId = movementResult.rows[0]?.id || null;
  }

  const invoiceUpdate = await client.query(
    `UPDATE invoices
       SET status = $1, paid_at = $2, payment_movement_id = $3, updated_at = NOW()
     WHERE id = $4
     RETURNING ${INVOICE_SELECT_FIELDS}`,
    [toInvoiceDbStatus("pagada"), paymentDate.toISOString(), movementId, invoiceRow.id]
  );

  const updatedInvoice = invoiceUpdate.rows[0] || invoiceRow;
  return {
    ...updatedInvoice,
    items: invoiceRow.items || [],
  };
}

async function attachInvoiceItems(rows, client = pool) {
  if (!rows.length) return rows;

  try {
    await ensureInvoiceItemColumns(client);
    const ids = rows.map((row) => row.id);
    const itemsResult = await client.query(
      `SELECT ${INVOICE_ITEM_SELECT_FIELDS} FROM invoice_items WHERE invoice_id = ANY($1::int[]) ORDER BY invoice_id ASC, sort_order ASC, id ASC`,
      [ids]
    );

    const byInvoiceId = new Map();
    itemsResult.rows.forEach((item) => {
      if (!byInvoiceId.has(item.invoiceId)) byInvoiceId.set(item.invoiceId, []);
      byInvoiceId.get(item.invoiceId).push(item);
    });

    return rows.map((row) => ({
      ...row,
      items: byInvoiceId.get(row.id) || [],
    }));
  } catch (err) {
    console.warn("No se pudieron cargar los ítems de factura:", err.message);
    return rows.map((row) => ({ ...row, items: [] }));
  }
}

async function saveInvoiceWithItems(client, payload) {
  const {
    id = null,
    number,
    party,
    date,
    dueDate,
    status,
    amount,
    items,
  } = payload;

  const normalizedStatus = normalizeInvoiceStatus(status);
  const normalizedItems = normalizeInvoiceItems(items, amount);

  await ensureInvoiceItemColumns(client);

  if (Array.isArray(items) && normalizedItems.items.length === 0) {
    throw new Error("Agrega al menos un ítem a la factura");
  }

  const invoiceAmount = normalizedItems.items.length > 0 ? normalizedItems.amount : toValidMoney(amount, 0);

  let invoiceRow = null;

  if (id === null) {
    const result = await client.query(
      `INSERT INTO invoices (number, party, date, duedate, amount, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${INVOICE_SELECT_FIELDS}`,
      [number.trim(), party.trim(), date || null, dueDate || null, invoiceAmount, toInvoiceDbStatus(normalizedStatus)]
    );
    invoiceRow = result.rows[0];
  } else {
    const result = await client.query(
      `UPDATE invoices
         SET number = $1, party = $2, date = $3, duedate = $4, amount = $5, status = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING ${INVOICE_SELECT_FIELDS}`,
      [number.trim(), party.trim(), date || null, dueDate || null, invoiceAmount, toInvoiceDbStatus(normalizedStatus), id]
    );
    invoiceRow = result.rows[0] || null;
  }

  if (!invoiceRow) {
    return null;
  }

  if (id !== null) {
    await client.query("DELETE FROM invoice_items WHERE invoice_id = $1", [id]);
  }

  if (normalizedItems.items.length > 0) {
    const lineTotalIsGenerated = await invoiceItemLineTotalIsGenerated(client);
    for (const item of normalizedItems.items) {
      const insertColumns = lineTotalIsGenerated
        ? "(invoice_id, description, quantity, unit_price, sort_order)"
        : "(invoice_id, description, quantity, unit_price, line_total, sort_order)";
      const insertValues = lineTotalIsGenerated
        ? [invoiceRow.id, item.description, item.quantity, item.unitPrice, item.sortOrder]
        : [invoiceRow.id, item.description, item.quantity, item.unitPrice, item.lineTotal, item.sortOrder];

      await client.query(
        `INSERT INTO invoice_items ${insertColumns}
         VALUES ($1, $2, $3, $4, $5${lineTotalIsGenerated ? '' : ', $6'})`,
        insertValues
      );
    }
  }

  if (getInvoiceStatusKey(normalizedStatus) === "pagada") {
    invoiceRow = await upsertInvoicePaymentMovement(client, {
      ...invoiceRow,
      status: normalizedStatus,
      items: normalizedItems.items,
      paymentMovementId: invoiceRow.paymentMovementId || null,
    }, { paidAt: payload.paidAt, note: payload.paymentNote });
  }

  return {
    ...invoiceRow,
    items: normalizedItems.items,
  };
}

// =======================
// ROUTES (Vistas)
// =======================
app.get("/", (req, res) => {
  if (req.session && req.session.user) return res.redirect("/dashboard");
  if (sendAstroPage(res, "index")) return;
  return res.redirect("/login");
});

app.get("/login", ensureGuest, (req, res) => {
  if (sendAstroPage(res, "login")) return;
  return res.status(503).send("Astro build missing");
});

app.get("/register", ensureGuest, (req, res) => {
  if (sendAstroPage(res, "register")) return;
  return res.status(503).send("Astro build missing");
});

app.get("/api/csrf", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({ csrfToken: getCsrfToken(req) });
});

// Login real contra tabla users
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.redirect("/login?error=" + encodeURIComponent("Email y contraseña obligatorios"));
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const result = await pool.query(
      "SELECT id, email, name, password, role, active FROM users WHERE LOWER(email) = $1",
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.redirect("/login?error=" + encodeURIComponent("Credenciales inválidas"));
    }

    const user = result.rows[0];

    if (!user.active) {
      return res.redirect("/login?error=" + encodeURIComponent("Usuario inactivo"));
    }

    if (!user.password) {
      return res.redirect("/login?error=" + encodeURIComponent("Credenciales inválidas"));
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.redirect("/login?error=" + encodeURIComponent("Credenciales inválidas"));
    }

    // Guardar sesión
    req.session.user = buildSessionUser(user);

    return res.redirect("/dashboard");
  } catch (err) {
    console.error("Error POST /login", err);
    return res.status(500).send("Error interno");
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email y contraseña obligatorios" });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const result = await pool.query(
      "SELECT id, email, name, password, role, active FROM users WHERE LOWER(email) = $1",
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const user = result.rows[0];

    if (!user.active) {
      return res.status(403).json({ error: "Usuario inactivo" });
    }

    if (!user.password) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    req.session.user = buildSessionUser(user);
    return res.json(req.session.user);
  } catch (err) {
    console.error("Error POST /api/login", err);
    return res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!isNonEmptyString(name) || !isValidEmail(email) || !isNonEmptyString(password) || String(password).length < 6) {
    return res.status(400).json({ error: "Nombre, email y contraseña son obligatorios" });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const existing = await pool.query("SELECT id FROM users WHERE LOWER(email) = $1", [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "El correo ya está registrado" });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, name, password, role, active)
       VALUES ($1, $2, $3, 'Productor', true)
       RETURNING id, email, name, role, active, created_at`,
      [normalizedEmail, name.trim(), hash]
    );

    req.session.user = buildSessionUser(result.rows[0]);

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/register", err);
    return res.status(500).json({ error: "No se pudo registrar el usuario" });
  }
});

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error POST /logout", err);
    }
    res.clearCookie("connect.sid", { path: "/" });
    return res.redirect("/login");
  });
});

app.get("/logout", (req, res) => {
  if (!req.session) {
    return res.redirect("/login");
  }

  req.session.destroy((err) => {
    if (err) {
      console.error("Error GET /logout", err);
    }
    res.clearCookie("connect.sid", { path: "/" });
    return res.redirect("/login");
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error POST /api/logout", err);
      return res.status(500).json({ error: "No se pudo cerrar sesión" });
    }
    res.clearCookie("connect.sid", { path: "/" });
    return res.status(204).send();
  });
});

// Vistas protegidas
app.get("/dashboard", ensureAuth, (req, res) => {
  if (sendAstroPage(res, "dashboard")) return;
  res.render("dashboard", { title: "Dashboard", active: "dashboard" });
});
app.get("/movimientos", ensureAuth, (req, res) => {
  if (sendAstroPage(res, "movimientos")) return;
  res.render("movimientos", { title: "Movimientos", active: "movimientos" });
});
app.get("/facturas", ensureAuth, (req, res) => {
  if (sendAstroPage(res, "facturas")) return;
  res.render("facturas", { title: "Facturas", active: "facturas" });
});
app.get("/reportes", ensureAuth, (req, res) => {
  if (sendAstroPage(res, "reportes")) return;
  res.render("reportes", { title: "Reportes", active: "reportes" });
});
app.get("/configuraciones", ensureAdmin, (req, res) => {
  if (sendAstroPage(res, "configuraciones")) return;
  res.render("configuraciones", { title: "Configuración", active: "configuraciones" });
});
app.get("/usuarios", ensureAdmin, (req, res) => {
  if (sendAstroPage(res, "usuarios")) return;
  res.render("usuarios", { title: "Usuarios", active: "usuarios" });
});

// =======================
// API - Auth / Users
// =======================
app.get("/api/me", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!req.session || !req.session.user) {
    return res.json({ authenticated: false, user: null });
  }
  return res.json({ authenticated: true, user: req.session.user });
});

app.get("/api/users", ensureAdminApi, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, email, name, role, active, created_at FROM users ORDER BY id"
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/users", err);
    return res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

app.post("/api/users", ensureAdminApi, async (req, res) => {
  const { email, password, role, active, name } = req.body;
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    return res.status(400).json({ error: "Email y contraseña obligatorios" });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const r = normalizeRole(role);

    const result = await pool.query(
      `INSERT INTO users (email, password, role, active, name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role, active, created_at`,
      [normalizeEmail(email), hash, r, active !== false, isNonEmptyString(name) ? name.trim() : ""]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/users", err);
    return res.status(500).json({ error: "Error al crear usuario" });
  }
});

app.put("/api/users/:id", ensureAdminApi, async (req, res) => {
  const uid = parseIdParam(req.params.id);
  if (uid === null) {
    return res.status(400).json({ error: "ID de usuario inválido" });
  }
  const myRole = String(req.session.user.role || "").toLowerCase();

  const { email, password, role, active, name } = req.body;

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    if (email) {
      fields.push(`email = $${idx++}`);
      values.push(normalizeEmail(email));
    }
    if (typeof name !== "undefined") {
      fields.push(`name = $${idx++}`);
      values.push(isNonEmptyString(name) ? name.trim() : "");
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      fields.push(`password = $${idx++}`);
      values.push(hash);
    }
    if (role && myRole === "admin") {
      fields.push(`role = $${idx++}`);
      values.push(normalizeRole(role));
    }
    if (typeof active !== "undefined" && myRole === "admin") {
      fields.push(`active = $${idx++}`);
      values.push(active);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No hay cambios" });
    }

    values.push(uid);
    const query = `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx} RETURNING id, email, name, role, active, created_at`;
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const updatedUser = result.rows[0];
    const currentUserId = req.session?.user?.id;
    if (currentUserId === updatedUser.id) {
      if (!updatedUser.active) {
        return req.session.destroy((err) => {
          if (err) {
            console.error("Error destroying session after user deactivation", err);
          }
          res.clearCookie("connect.sid", { path: "/" });
          return res.json(updatedUser);
        });
      }

      req.session.user = buildSessionUser(updatedUser);
    }

    return res.json(updatedUser);
  } catch (err) {
    console.error("Error PUT /api/users/:id", err);
    return res.status(500).json({ error: "Error al actualizar usuario" });
  }
});

app.delete("/api/users/:id", ensureAdminApi, async (req, res) => {
  const uid = parseIdParam(req.params.id);
  if (uid === null) {
    return res.status(400).json({ error: "ID de usuario inválido" });
  }
  const myRole = String(req.session.user.role || "").toLowerCase();

  if (myRole !== "admin" && req.session.user.id !== uid) {
    return res.status(403).json({ error: "Permiso denegado" });
  }

  try {
    const result = await pool.query("DELETE FROM users WHERE id = $1", [uid]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    if (req.session?.user?.id === uid) {
      return req.session.destroy((err) => {
        if (err) {
          console.error("Error destroying session after self-delete", err);
        }
        res.clearCookie("connect.sid", { path: "/" });
        return res.status(204).send();
      });
    }

    return res.status(204).send();
  } catch (err) {
    console.error("Error DELETE /api/users/:id", err);
    return res.status(500).json({ error: "Error al eliminar usuario" });
  }
});

// =======================
// API MOVEMENTS (CRUD)
// =======================
// Nota: ahora las protegemos con ensureAuth para que no exponga datos sin login
app.get("/api/movements", ensureAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${MOVEMENT_SELECT_FIELDS} FROM movements ORDER BY date DESC NULLS LAST, id DESC`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/movements", err);
    return res.status(500).json({ error: "Error al obtener movimientos" });
  }
});

app.get("/api/movements/summary", ensureAuth, async (req, res) => {
  try {
    const totalsResult = await pool.query(`
      SELECT
        COUNT(*)::int AS total_count,
        COALESCE(SUM(CASE WHEN lower(type::text) = 'ingreso' THEN ABS(amount) ELSE 0 END), 0) AS income_total,
        COALESCE(SUM(CASE WHEN lower(type::text) = 'gasto' THEN ABS(amount) ELSE 0 END), 0) AS expense_total
      FROM movements
    `);

    const recentResult = await pool.query(`
      SELECT ${MOVEMENT_SELECT_FIELDS}
      FROM movements
      ORDER BY date DESC NULLS LAST, id DESC
      LIMIT 5
    `);

    const totals = totalsResult.rows[0] || { total_count: 0, income_total: 0, expense_total: 0 };
    const incomeTotal = Number(totals.income_total || 0);
    const expenseTotal = Number(totals.expense_total || 0);

    return res.json({
      totalCount: Number(totals.total_count || 0),
      incomeTotal,
      expenseTotal,
      balance: incomeTotal - expenseTotal,
      recentMovements: recentResult.rows,
    });
  } catch (err) {
    console.error("Error GET /api/movements/summary", err);
    return res.status(500).json({ error: "Error al obtener resumen de movimientos" });
  }
});

function buildMovementReportFilters(query = {}) {
  const where = [];
  const params = [];
  const from = String(query.from || "").trim();
  const to = String(query.to || "").trim();
  const type = String(query.type || "all").trim().toLowerCase();
  const normalizedType = ["ingreso", "gasto"].includes(type) ? type : "all";
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (from && !datePattern.test(from)) return { error: "El filtro 'from' no es válido" };
  if (to && !datePattern.test(to)) return { error: "El filtro 'to' no es válido" };

  if (from) {
    params.push(from);
    where.push(`date::date >= $${params.length}::date`);
  }

  if (to) {
    params.push(to);
    where.push(`date::date <= $${params.length}::date`);
  }

  if (normalizedType !== "all") {
    params.push(normalizedType);
    where.push(`lower(type::text) = $${params.length}`);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
    filters: {
      from: from || null,
      to: to || null,
      type: normalizedType,
    },
  };
}

function buildDateOnlyFilters(query = {}) {
  const where = [];
  const params = [];
  const from = String(query.from || "").trim();
  const to = String(query.to || "").trim();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (from && !datePattern.test(from)) return { error: "El filtro 'from' no es válido" };
  if (to && !datePattern.test(to)) return { error: "El filtro 'to' no es válido" };

  if (from) {
    params.push(from);
    where.push(`date::date >= $${params.length}::date`);
  }

  if (to) {
    params.push(to);
    where.push(`date::date <= $${params.length}::date`);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
    filters: {
      from: from || null,
      to: to || null,
    },
  };
}

function getReportDateExpr(tableAlias = "date") {
  return `COALESCE(${tableAlias}, created_at)::date`;
}

function formatReportDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatReportMoney(value) {
  return Number(value || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
}

async function buildInvoiceReport(whereSql, params) {
  const dateExpr = getReportDateExpr("date");

  const totalsResult = await pool.query(
    `SELECT
      COUNT(*)::int AS total_count,
      COALESCE(SUM(amount), 0) AS total_amount,
      COUNT(*) FILTER (WHERE lower(status::text) = 'pagada')::int AS paid_count,
      COUNT(*) FILTER (WHERE lower(status::text) = 'pendiente')::int AS pending_count,
      COUNT(*) FILTER (WHERE lower(status::text) = 'vencida')::int AS overdue_count,
      COALESCE(SUM(CASE WHEN lower(status::text) = 'pendiente' THEN amount ELSE 0 END), 0) AS pending_amount
    FROM invoices
    ${whereSql}`,
    params
  );

  const statusResult = await pool.query(
    `SELECT
      COALESCE(NULLIF(TRIM(status), ''), 'Pendiente') AS status,
      COUNT(*)::int AS count,
      COALESCE(SUM(amount), 0) AS total
    FROM invoices
    ${whereSql}
    GROUP BY 1
    ORDER BY total DESC, status ASC`,
    params
  );

  const monthResult = await pool.query(
    `SELECT
      TO_CHAR(${dateExpr}, 'YYYY-MM') AS month,
      DATE_TRUNC('month', ${dateExpr})::date AS month_start,
      COUNT(*)::int AS count,
      COALESCE(SUM(amount), 0) AS total_amount,
      COALESCE(SUM(CASE WHEN lower(status::text) = 'pagada' THEN amount ELSE 0 END), 0) AS paid_amount,
      COALESCE(SUM(CASE WHEN lower(status::text) = 'pendiente' THEN amount ELSE 0 END), 0) AS pending_amount
    FROM invoices
    ${whereSql}
    GROUP BY 1, 2
    ORDER BY month_start ASC`,
    params
  );

  const partyResult = await pool.query(
    `SELECT
      COALESCE(NULLIF(TRIM(party), ''), 'Sin contraparte') AS party,
      COUNT(*)::int AS count,
      COALESCE(SUM(amount), 0) AS total
    FROM invoices
    ${whereSql}
    GROUP BY 1
    ORDER BY total DESC, party ASC
    LIMIT 6`,
    params
  );

  const invoicesResult = await pool.query(
    `SELECT ${INVOICE_SELECT_FIELDS}
    FROM invoices
    ${whereSql}
    ORDER BY date DESC NULLS LAST, id DESC`,
    params
  );

  const totals = totalsResult.rows[0] || { total_count: 0, total_amount: 0, paid_count: 0, pending_count: 0, overdue_count: 0, pending_amount: 0 };
  const totalAmount = Number(totals.total_amount || 0);

  return {
    totalCount: Number(totals.total_count || 0),
    totalAmount,
    paidCount: Number(totals.paid_count || 0),
    pendingCount: Number(totals.pending_count || 0),
    overdueCount: Number(totals.overdue_count || 0),
    pendingAmount: Number(totals.pending_amount || 0),
    byStatus: statusResult.rows.map((row) => ({
      status: row.status,
      count: Number(row.count || 0),
      total: Number(row.total || 0),
    })),
    byMonth: monthResult.rows.map((row) => ({
      month: row.month,
      count: Number(row.count || 0),
      totalAmount: Number(row.total_amount || 0),
      paidAmount: Number(row.paid_amount || 0),
      pendingAmount: Number(row.pending_amount || 0),
    })),
    byParty: partyResult.rows.map((row) => ({
      party: row.party,
      count: Number(row.count || 0),
      total: Number(row.total || 0),
    })),
    invoices: invoicesResult.rows,
  };
}

function buildEmptyMovementReport() {
  return {
    totalCount: 0,
    incomeTotal: 0,
    expenseTotal: 0,
    balance: 0,
    movements: [],
    byCategory: [],
    byMonth: [],
  };
}

function buildEmptyInvoiceReport() {
  return {
    totalCount: 0,
    totalAmount: 0,
    paidCount: 0,
    pendingCount: 0,
    overdueCount: 0,
    pendingAmount: 0,
    byStatus: [],
    byMonth: [],
    byParty: [],
    invoices: [],
  };
}

async function buildOverviewReport(query) {
  const movementFilterResult = buildMovementReportFilters(query);
  if (movementFilterResult.error) {
    return { error: movementFilterResult.error };
  }

  const invoiceFilterResult = buildDateOnlyFilters(query);
  if (invoiceFilterResult.error) {
    return { error: invoiceFilterResult.error };
  }

  const { whereSql, params, filters } = movementFilterResult;
  const invoiceWhereSql = invoiceFilterResult.whereSql;
  const invoiceParams = invoiceFilterResult.params;

  let movementReport = buildEmptyMovementReport();
  let invoiceReport = buildEmptyInvoiceReport();
  const warnings = [];

  try {
    const totalsResult = await pool.query(
      `SELECT
        COUNT(*)::int AS total_count,
        COALESCE(SUM(CASE WHEN lower(type::text) = 'ingreso' THEN ABS(amount) ELSE 0 END), 0) AS income_total,
        COALESCE(SUM(CASE WHEN lower(type::text) = 'gasto' THEN ABS(amount) ELSE 0 END), 0) AS expense_total
      FROM movements
      ${whereSql}`,
      params
    );

    const movementsResult = await pool.query(
      `SELECT id, type, date, category, description, amount, status
      FROM movements
      ${whereSql}
      ORDER BY date DESC NULLS LAST, id DESC`,
      params
    );

    const categoryResult = await pool.query(
      `SELECT
        COALESCE(NULLIF(TRIM(category), ''), 'Sin categoría') AS category,
        lower(type::text) AS type,
        COUNT(*)::int AS count,
        COALESCE(SUM(ABS(amount)), 0) AS total
      FROM movements
      ${whereSql}
      GROUP BY 1, 2
      ORDER BY total DESC, category ASC`,
      params
    );

    const monthResult = await pool.query(
      `SELECT
        TO_CHAR(date::date, 'YYYY-MM') AS month,
        DATE_TRUNC('month', date)::date AS month_start,
        COUNT(*)::int AS count,
        COALESCE(SUM(CASE WHEN lower(type::text) = 'ingreso' THEN ABS(amount) ELSE 0 END), 0) AS income_total,
        COALESCE(SUM(CASE WHEN lower(type::text) = 'gasto' THEN ABS(amount) ELSE 0 END), 0) AS expense_total
      FROM movements
      ${whereSql}
      GROUP BY 1, 2
      ORDER BY month_start ASC`,
      params
    );

    const totals = totalsResult.rows[0] || { total_count: 0, income_total: 0, expense_total: 0 };
    const incomeTotal = Number(totals.income_total || 0);
    const expenseTotal = Number(totals.expense_total || 0);

    movementReport = {
      totalCount: Number(totals.total_count || 0),
      incomeTotal,
      expenseTotal,
      balance: incomeTotal - expenseTotal,
      movements: movementsResult.rows,
      byCategory: categoryResult.rows.map((row) => ({
        category: row.category,
        type: row.type,
        count: Number(row.count || 0),
        total: Number(row.total || 0),
      })),
      byMonth: monthResult.rows.map((row) => {
        const income = Number(row.income_total || 0);
        const expense = Number(row.expense_total || 0);
        return {
          month: row.month,
          count: Number(row.count || 0),
          incomeTotal: income,
          expenseTotal: expense,
          balance: income - expense,
        };
      }),
    };
  } catch (err) {
    warnings.push(`Movimientos: ${err.message}`);
    console.error("Error building movement report", err);
  }

  try {
    invoiceReport = await buildInvoiceReport(invoiceWhereSql, invoiceParams);
  } catch (err) {
    warnings.push(`Facturas: ${err.message}`);
    console.error("Error building invoice report", err);
  }

  return {
    filters,
    summary: {
      movementCount: movementReport.totalCount,
      invoiceCount: invoiceReport.totalCount,
      incomeTotal: movementReport.incomeTotal,
      expenseTotal: movementReport.expenseTotal,
      movementBalance: movementReport.balance,
      invoiceTotal: invoiceReport.totalAmount,
      invoicePendingAmount: invoiceReport.pendingAmount,
      invoicePendingCount: invoiceReport.pendingCount,
      invoiceOverdueCount: invoiceReport.overdueCount,
      netBalance: movementReport.balance,
    },
    movements: movementReport,
    invoices: invoiceReport,
    warnings,
  };
}

function buildOverviewCsv(report) {
  const movements = Array.isArray(report?.movements?.movements) ? report.movements.movements : [];
  const invoices = Array.isArray(report?.invoices?.invoices) ? report.invoices.invoices : [];

  const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["Resumen"],
    ["Métrica", "Valor"],
    ["Ingresos", formatReportMoney(report.summary?.incomeTotal || 0)],
    ["Gastos", formatReportMoney(report.summary?.expenseTotal || 0)],
    ["Balance", formatReportMoney(report.summary?.netBalance || 0)],
    ["Movimientos", String(report.summary?.movementCount || 0)],
    ["Facturas", String(report.summary?.invoiceCount || 0)],
    ["Pendientes", formatReportMoney(report.summary?.invoicePendingAmount || 0)],
    [],
    ["Movimientos"],
    ["Fecha", "Tipo", "Categoría", "Descripción", "Monto", "Estado"],
    ...movements.map((movement) => [
      formatReportDate(movement.date),
      movement.type || "",
      movement.category || "Sin categoría",
      movement.description || "",
      formatReportMoney(movement.amount),
      movement.status || "",
    ]),
    [],
    ["Facturas"],
    ["Número", "Contraparte", "Fecha", "Vencimiento", "Monto", "Estado"],
    ...invoices.map((invoice) => [
      invoice.number || "",
      invoice.party || "",
      formatReportDate(invoice.date),
      formatReportDate(invoice.dueDate),
      formatReportMoney(invoice.amount),
      invoice.status || "",
    ]),
  ];

  return rows
    .map((row) => row.map(csvCell).join(";"))
    .join("\n");
}

function addPdfHeader(doc, report) {
  doc.fillColor("#0f172a").fontSize(20).font("Helvetica-Bold").text("Reporte financiero", { align: "left" });
  doc.moveDown(0.3);
  doc.fillColor("#64748b").fontSize(10).font("Helvetica").text(`Filtro: ${report.filters?.from || report.filters?.to ? `${report.filters.from || ""} ${report.filters.to ? `- ${report.filters.to}` : ""}`.trim() : "Todo el historial"}`);
  doc.moveDown(0.5);
}

function drawMetricBox(doc, x, y, w, h, label, value, accent = "#0f172a") {
  doc.roundedRect(x, y, w, h, 10).fillAndStroke("#ffffff", "#e2e8f0");
  doc.fillColor("#64748b").fontSize(9).font("Helvetica").text(label, x + 10, y + 10, { width: w - 20 });
  doc.fillColor(accent).fontSize(14).font("Helvetica-Bold").text(value, x + 10, y + 24, { width: w - 20 });
}

function drawSectionTitle(doc, title) {
  doc.moveDown(0.8);
  doc.fillColor("#0f172a").fontSize(14).font("Helvetica-Bold").text(title);
  doc.moveDown(0.3);
}

function drawTable(doc, columns, rows, rowBuilder) {
  const startX = doc.x;
  const totalWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const rowHeight = 18;
  const headerHeight = 20;
  const widths = columns.map((column) => column.width);

  const drawHeader = () => {
    let x = startX;
    doc.fillColor("#f8fafc").rect(startX, doc.y, totalWidth, headerHeight).fill();
    doc.fillColor("#64748b").fontSize(9).font("Helvetica-Bold");
    columns.forEach((column, index) => {
      doc.text(column.label, x + 4, doc.y + 6, { width: widths[index] - 8, align: column.align || "left" });
      x += widths[index];
    });
    doc.moveDown(1.2);
  };

  drawHeader();

  rows.forEach((row, rowIndex) => {
    const values = rowBuilder(row);
    const estimatedHeight = rowHeight;
    if (doc.y + estimatedHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
    }

    let x = startX;
    const y = doc.y;
    doc.fillColor("#0f172a").fontSize(9).font("Helvetica");
    values.forEach((value, index) => {
      doc.text(String(value), x + 4, y + 5, {
        width: widths[index] - 8,
        align: columns[index].align || "left",
      });
      x += widths[index];
    });
    doc.moveTo(startX, y + rowHeight).lineTo(startX + totalWidth, y + rowHeight).strokeColor("#e2e8f0").stroke();
    doc.y = y + rowHeight;
  });
}

function sendOverviewPdf(res, report) {
  const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true });
  const fileName = `reporte-${new Date().toISOString().slice(0, 10)}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  doc.pipe(res);

  addPdfHeader(doc, report);

  const summary = report.summary || {};
  const metrics = [
    ["Ingresos", formatReportMoney(summary.incomeTotal || 0), "#059669"],
    ["Gastos", formatReportMoney(summary.expenseTotal || 0), "#e11d48"],
    ["Balance", formatReportMoney(summary.netBalance || 0), "#0f172a"],
    ["Movimientos", String(summary.movementCount || 0), "#0f172a"],
    ["Facturas", String(summary.invoiceCount || 0), "#0f172a"],
    ["Pendientes", formatReportMoney(summary.invoicePendingAmount || 0), "#d97706"],
  ];

  const boxW = 170;
  const boxH = 42;
  const gap = 10;
  const startX = doc.page.margins.left;
  const startY = doc.y + 4;
  metrics.forEach((metric, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    drawMetricBox(doc, startX + col * (boxW + gap), startY + row * (boxH + gap), boxW, boxH, metric[0], metric[1], metric[2]);
  });

  doc.y = startY + 2 * (boxH + gap) + 8;

  drawSectionTitle(doc, "Movimientos incluidos");
  drawTable(
    doc,
    [
      { label: "Fecha", width: 72 },
      { label: "Tipo", width: 54 },
      { label: "Categoría", width: 96 },
      { label: "Descripción", width: 174 },
      { label: "Monto", width: 70, align: "right" },
      { label: "Estado", width: 54, align: "right" },
    ],
    report.movements?.movements || [],
    (row) => [
      formatReportDate(row.date),
      row.type || "",
      row.category || "Sin categoría",
      row.description || "",
      formatReportMoney(row.amount),
      row.status || "",
    ]
  );

  doc.addPage();
  addPdfHeader(doc, report);
  drawSectionTitle(doc, "Facturas incluidas");
  drawTable(
    doc,
    [
      { label: "Número", width: 72 },
      { label: "Contraparte", width: 126 },
      { label: "Fecha", width: 72 },
      { label: "Vencimiento", width: 72 },
      { label: "Monto", width: 70, align: "right" },
      { label: "Estado", width: 74, align: "right" },
    ],
    report.invoices?.invoices || [],
    (row) => [
      row.number || "",
      row.party || "",
      formatReportDate(row.date),
      formatReportDate(row.dueDate),
      formatReportMoney(row.amount),
      row.status || "",
    ]
  );

  doc.end();
}

app.get("/api/reports/movements", ensureAuth, async (req, res) => {
  try {
    const filterResult = buildMovementReportFilters(req.query);
    if (filterResult.error) {
      return res.status(400).json({ error: filterResult.error });
    }

    const { whereSql, params, filters } = filterResult;

    const totalsResult = await pool.query(
      `SELECT
        COUNT(*)::int AS total_count,
        COALESCE(SUM(CASE WHEN lower(type::text) = 'ingreso' THEN ABS(amount) ELSE 0 END), 0) AS income_total,
        COALESCE(SUM(CASE WHEN lower(type::text) = 'gasto' THEN ABS(amount) ELSE 0 END), 0) AS expense_total
      FROM movements
      ${whereSql}`,
      params
    );

    const movementsResult = await pool.query(
      `SELECT id, type, date, category, description, amount, status
      FROM movements
      ${whereSql}
      ORDER BY date DESC NULLS LAST, id DESC`,
      params
    );

    const categoryResult = await pool.query(
      `SELECT
        COALESCE(NULLIF(TRIM(category), ''), 'Sin categoría') AS category,
        lower(type::text) AS type,
        COUNT(*)::int AS count,
        COALESCE(SUM(ABS(amount)), 0) AS total
      FROM movements
      ${whereSql}
      GROUP BY 1, 2
      ORDER BY total DESC, category ASC`,
      params
    );

    const monthResult = await pool.query(
      `SELECT
        TO_CHAR(date::date, 'YYYY-MM') AS month,
        DATE_TRUNC('month', date)::date AS month_start,
        COUNT(*)::int AS count,
        COALESCE(SUM(CASE WHEN lower(type::text) = 'ingreso' THEN ABS(amount) ELSE 0 END), 0) AS income_total,
        COALESCE(SUM(CASE WHEN lower(type::text) = 'gasto' THEN ABS(amount) ELSE 0 END), 0) AS expense_total
      FROM movements
      ${whereSql}
      GROUP BY 1, 2
      ORDER BY month_start ASC`,
      params
    );

    const totals = totalsResult.rows[0] || { total_count: 0, income_total: 0, expense_total: 0 };
    const incomeTotal = Number(totals.income_total || 0);
    const expenseTotal = Number(totals.expense_total || 0);

    return res.json({
      filters,
      totalCount: Number(totals.total_count || 0),
      incomeTotal,
      expenseTotal,
      balance: incomeTotal - expenseTotal,
      movements: movementsResult.rows,
      byCategory: categoryResult.rows.map((row) => ({
        category: row.category,
        type: row.type,
        count: Number(row.count || 0),
        total: Number(row.total || 0),
      })),
      byMonth: monthResult.rows.map((row) => {
        const income = Number(row.income_total || 0);
        const expense = Number(row.expense_total || 0);
        return {
          month: row.month,
          count: Number(row.count || 0),
          incomeTotal: income,
          expenseTotal: expense,
          balance: income - expense,
        };
      }),
    });
  } catch (err) {
    console.error("Error GET /api/reports/movements", err);
    return res.status(500).json({ error: "Error al obtener reportes de movimientos" });
  }
});

app.get("/api/reports/overview", ensureAuth, async (req, res) => {
  try {
    const report = await buildOverviewReport(req.query);
    if (report.error) {
      return res.status(400).json({ error: report.error });
    }

    return res.json(report);
  } catch (err) {
    console.error("Error GET /api/reports/overview", err);
    return res.status(500).json({ error: "Error al obtener resumen general de reportes" });
  }
});

app.get("/api/reports/overview/csv", ensureAuth, async (req, res) => {
  try {
    const report = await buildOverviewReport(req.query);
    if (report.error) {
      return res.status(400).json({ error: report.error });
    }

    const csv = buildOverviewCsv(report);
    const fileName = `reporte-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(csv);
  } catch (err) {
    console.error("Error GET /api/reports/overview/csv", err);
    return res.status(500).json({ error: "Error al generar CSV de reportes" });
  }
});

app.get("/api/reports/overview/pdf", ensureAuth, async (req, res) => {
  try {
    const report = await buildOverviewReport(req.query);
    if (report.error) {
      return res.status(400).json({ error: report.error });
    }

    return sendOverviewPdf(res, report);
  } catch (err) {
    console.error("Error GET /api/reports/overview/pdf", err);
    return res.status(500).json({ error: "Error al generar PDF de reportes" });
  }
});

// ✅ NECESARIO PARA EDITAR: GET por ID
app.get("/api/movements/:id", ensureAuth, async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "ID de movimiento inválido" });
    }
    const result = await pool.query(
      `SELECT ${MOVEMENT_SELECT_FIELDS} FROM movements WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Movimiento no encontrado" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Error GET /api/movements/:id", err);
    return res.status(500).json({ error: "Error al obtener movimiento" });
  }
});

app.post("/api/movements", ensureAuth, ensureAccountingWriteApi, async (req, res) => {
  try {
    const { date, type, category, description, amount, status } = req.body;
    const normalizedType = normalizeMovementType(type);
    if (!isValidAmount(Number(amount)) || !isMovementType(normalizedType)) {
      return res.status(400).json({ error: "Tipo y monto son obligatorios" });
    }

    const result = await pool.query(
      `INSERT INTO movements (date, type, category, description, amount, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, date, type, category, description, amount, status`,
      [date || null, normalizedType, category || null, description || null, normalizeMovementAmount(normalizedType, amount), status || "Registrado"]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/movements", err);
    return res.status(500).json({ error: "Error al crear movimiento" });
  }
});

app.put("/api/movements/:id", ensureAuth, ensureAccountingWriteApi, async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "ID de movimiento inválido" });
    }
    const { date, type, category, description, amount, status } = req.body;
    const normalizedType = normalizeMovementType(type);
    if (!isValidAmount(Number(amount)) || !isMovementType(normalizedType)) {
      return res.status(400).json({ error: "Tipo y monto son obligatorios" });
    }

    const result = await pool.query(
      `UPDATE movements
       SET date = $1, type = $2, category = $3, description = $4, amount = $5, status = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING id, date, type, category, description, amount, status, created_at, updated_at`,
      [date || null, normalizedType, category || null, description || null, normalizeMovementAmount(normalizedType, amount), status || "Registrado", id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Movimiento no encontrado" });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/movements/:id", err);
    return res.status(500).json({ error: "Error al actualizar movimiento" });
  }
});

app.delete("/api/movements/:id", ensureAuth, ensureAccountingWriteApi, async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "ID de movimiento inválido" });
    }
    const result = await pool.query("DELETE FROM movements WHERE id = $1", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Movimiento no encontrado" });
    }

    return res.status(204).send();
  } catch (err) {
    console.error("Error DELETE /api/movements/:id", err);
    return res.status(500).json({ error: "Error al eliminar movimiento" });
  }
});

// =======================
// API INVOICES (CRUD)
// =======================
app.get("/api/invoices", ensureAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${INVOICE_SELECT_FIELDS} FROM invoices ORDER BY id DESC`
    );
    const rows = await attachInvoiceItems(result.rows);
    return res.json(rows);
  } catch (err) {
    console.error("Error GET /api/invoices", err);
    return res.status(500).json({ error: "Error al obtener facturas" });
  }
});

// ✅ NECESARIO PARA EDITAR: GET por ID
app.get("/api/invoices/:id", ensureAuth, async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "ID de factura inválido" });
    }
    const result = await pool.query(
      `SELECT ${INVOICE_SELECT_FIELDS} FROM invoices WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Factura no encontrada" });
    }
    const [invoice] = await attachInvoiceItems(result.rows);
    return res.json(invoice);
  } catch (err) {
    console.error("Error GET /api/invoices/:id", err);
    return res.status(500).json({ error: "Error al obtener factura" });
  }
});

app.post("/api/invoices", ensureAuth, ensureAccountingWriteApi, async (req, res) => {
  try {
    const { number, party, date, dueDate, amount, status, items } = req.body;
    if (!isNonEmptyString(number) || !isNonEmptyString(party) || !isValidAmount(Number(amount))) {
      return res.status(400).json({ error: "Número, contraparte y monto son obligatorios" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await saveInvoiceWithItems(client, {
        number,
        party,
        date,
        dueDate,
        amount,
        status,
        items,
      });
      await client.query("COMMIT");
      return res.status(201).json(result);
    } catch (saveErr) {
      await client.query("ROLLBACK");
      throw saveErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error POST /api/invoices", err);
    return res.status(500).json({ error: err.message || "Error al crear factura" });
  }
});

app.put("/api/invoices/:id", ensureAuth, ensureAccountingWriteApi, async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "ID de factura inválido" });
    }
    const { number, party, date, dueDate, amount, status, items } = req.body;
    if (!isNonEmptyString(number) || !isNonEmptyString(party) || !isValidAmount(Number(amount))) {
      return res.status(400).json({ error: "Número, contraparte y monto son obligatorios" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await saveInvoiceWithItems(client, {
        id,
        number,
        party,
        date,
        dueDate,
        amount,
        status,
        items,
      });

      if (!result) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Factura no encontrada" });
      }

      await client.query("COMMIT");
      return res.json(result);
    } catch (saveErr) {
      await client.query("ROLLBACK");
      throw saveErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error PUT /api/invoices/:id", err);
    return res.status(500).json({ error: err.message || "Error al actualizar factura" });
  }
});

app.post("/api/invoices/:id/pay", ensureAuth, ensureAccountingWriteApi, async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "ID de factura inválido" });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT ${INVOICE_SELECT_FIELDS} FROM invoices WHERE id = $1 FOR UPDATE`,
        [id]
      );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Factura no encontrada" });
      }

      const invoice = result.rows[0];
      if (getInvoiceStatusKey(invoice.status) === "pagada" && invoice.paymentMovementId) {
        const [fullInvoice] = await attachInvoiceItems([invoice], client);
        await client.query("COMMIT");
        return res.json(fullInvoice);
      }

      const paidInvoice = await upsertInvoicePaymentMovement(client, {
        ...invoice,
        items: [],
      }, {
        paidAt: req.body?.paidAt || null,
        note: req.body?.note || `Pago factura ${invoice.number}`,
      });

      await client.query("COMMIT");
      const [fullInvoice] = await attachInvoiceItems([paidInvoice], client);
      return res.json(fullInvoice);
    } catch (payErr) {
      await client.query("ROLLBACK");
      throw payErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error POST /api/invoices/:id/pay", err);
    return res.status(500).json({ error: err.message || "No se pudo registrar el pago" });
  }
});

app.delete("/api/invoices/:id", ensureAuth, ensureAccountingWriteApi, async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "ID de factura inválido" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const lookup = await client.query("SELECT payment_movement_id FROM invoices WHERE id = $1", [id]);
      if (lookup.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Factura no encontrada" });
      }

      if (lookup.rows[0].payment_movement_id) {
        await client.query("DELETE FROM movements WHERE id = $1", [lookup.rows[0].payment_movement_id]);
      }

      const result = await client.query("DELETE FROM invoices WHERE id = $1", [id]);
      await client.query("COMMIT");

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Factura no encontrada" });
      }

      return res.status(204).send();
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error DELETE /api/invoices/:id", err);
    return res.status(500).json({ error: "Error al eliminar factura" });
  }
});

// =======================
// Fallback
// =======================
app.get("*", (req, res) => {
  const looksLikeFile = path.extname(req.path) !== "";
  if (looksLikeFile) return res.status(404).send("Not found");
  return res.redirect("/");
});

// =======================
// DB init / migrations
// =======================
async function initDb() {
  try {
    // users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        password TEXT,
        role TEXT NOT NULL DEFAULT 'Productor',
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);

    // invoices
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        number TEXT NOT NULL,
        party TEXT NOT NULL,
        date TIMESTAMP WITH TIME ZONE,
        dueDate TIMESTAMP WITH TIME ZONE,
        amount NUMERIC(15, 2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'Pendiente',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity NUMERIC(15, 2) NOT NULL DEFAULT 1,
        unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
        line_total NUMERIC(15, 2) NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);

    // movements (✅ incluye status)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS movements (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        date TIMESTAMP WITH TIME ZONE,
        amount NUMERIC(15, 2) NOT NULL,
        description TEXT,
        category TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        invoice_id INTEGER,
        status TEXT NOT NULL DEFAULT 'Registrado',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);

    // Asegurar columnas por si ya existían tablas viejas
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'Productor'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`);

    await pool.query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Registrado'`);
    await pool.query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'`);
    await pool.query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS invoice_id INTEGER`);
    await pool.query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()`);
    await pool.query(`UPDATE movements SET amount = ABS(amount)`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS duedate TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_movement_id INTEGER`);
    await pool.query(`UPDATE invoices SET status = CASE WHEN lower(trim(COALESCE(status, ''))) IN ('pagada', 'paid') THEN 'Pagada' WHEN lower(trim(COALESCE(status, ''))) IN ('vencida', 'vencido', 'overdue') THEN 'Vencida' ELSE 'Pendiente' END`);
    await ensureInvoiceItemColumns(pool);

    // Seed admin (✅ role = 'admin' consistente)
    const adminEmail = "admin@example.com";
    const adminPw = "admin123";
    const hashed = await bcrypt.hash(adminPw, 10);

    try {
      await pool.query(
        `INSERT INTO users (email, password, role, name)
         SELECT $1, $2, 'Admin', 'Administrador'
         WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = $1)`,
        [normalizeEmail(adminEmail), hashed]
      );
      console.log(`admin user seeded: ${adminEmail} / ${adminPw}`);
    } catch (innerErr) {
      console.warn("No se pudo insertar usuario admin automáticamente:", innerErr.message);
    }
  } catch (err) {
    console.error("Error inicializando base de datos:", err);
  }
}

initDb();

// =======================
// Start server
// =======================
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
