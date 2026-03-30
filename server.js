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
    cookie: { ...getSessionCookieOptions(), maxAge: 1000 * 60 * 60 }, // 1h
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
    displayRole: user.displayRole || normalizeRole(user.role || "Productor"),
    legacyRole: String(user.legacyRole || user.role || "user").toLowerCase(),
    organizationRole: String(user.organizationRole || "member").toLowerCase(),
    activeOrganizationId: user.activeOrganizationId || null,
    activeOrganization: user.activeOrganization || null,
    organizations: Array.isArray(user.organizations) ? user.organizations : [],
  };
}

function getSessionCookieOptions() {
  return {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: isProduction ? "auto" : false,
  };
}

function clearSessionCookie(res) {
  res.clearCookie("connect.sid", getSessionCookieOptions());
}

function persistSessionUser(req, user) {
  return new Promise((resolve, reject) => {
    if (!req.session) {
      reject(new Error("Sesión no disponible"));
      return;
    }

    resolveSessionUser(user, req.session.activeOrganizationId || req.session.user?.activeOrganizationId)
      .then((sessionUser) => {
        req.session.user = buildSessionUser(sessionUser);
        req.session.activeOrganizationId = req.session.user.activeOrganizationId || null;
        req.session.save((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(req.session.user);
        });
      })
      .catch(reject);
  });
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

function looksLikeBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(value || ""));
}

async function safeComparePassword(rawPassword, hashedPassword) {
  if (!looksLikeBcryptHash(hashedPassword)) {
    return false;
  }

  try {
    return await bcrypt.compare(rawPassword, hashedPassword);
  } catch (_) {
    return false;
  }
}

async function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const result = await pool.query(
    "SELECT id, email, name, password, role, active FROM users WHERE LOWER(email) = $1",
    [normalizedEmail]
  );

  return {
    normalizedEmail,
    user: result.rows[0] || null,
  };
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
  organization_id AS "organizationId",
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

function normalizeOrganizationRole(role) {
  const value = String(role || "").trim().toLowerCase();
  if (["owner", "admin"].includes(value)) return "owner";
  if (["accountant", "contador"].includes(value)) return "accountant";
  return "manager";
}

function legacyRoleToOrganizationRole(role) {
  const value = String(role || "").trim().toLowerCase();
  if (value === "admin") return "owner";
  if (value === "contador") return "accountant";
  return "manager";
}

function organizationRoleToLegacyRole(role) {
  const value = normalizeOrganizationRole(role);
  if (value === "owner") return "admin";
  if (value === "accountant") return "contador";
  return "productor";
}

function organizationRoleToDisplayRole(role) {
  const legacyRole = organizationRoleToLegacyRole(role);
  return normalizeRole(legacyRole);
}

function buildDefaultOrganizationName(name) {
  const baseName = String(name || "").trim();
  return baseName ? `${baseName} Agro` : "Mi empresa agrícola";
}

async function getUserById(id) {
  const userId = parseIdParam(id);
  if (userId === null) return null;
  const result = await pool.query(
    "SELECT id, email, name, role, active, created_at FROM users WHERE id = $1",
    [userId]
  );
  return result.rows[0] || null;
}

async function listOrganizationsForUser(userId) {
  const result = await pool.query(
    `SELECT
       om.organization_id AS id,
       o.name,
       om.role,
       om.status,
       om.is_default AS "isDefault"
     FROM organization_memberships om
     INNER JOIN organizations o ON o.id = om.organization_id
     WHERE om.user_id = $1
       AND om.status = 'active'
       AND o.status = 'active'
     ORDER BY om.is_default DESC, o.name ASC`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: normalizeOrganizationRole(row.role),
    displayRole: organizationRoleToDisplayRole(row.role),
    isDefault: !!row.isDefault,
  }));
}

async function resolveSessionUser(user, preferredOrganizationId = null) {
  const organizations = await listOrganizationsForUser(user.id);
  const preferredId = parseIdParam(preferredOrganizationId);
  const activeOrganization = organizations.find((org) => org.id === preferredId)
    || organizations.find((org) => org.isDefault)
    || organizations[0]
    || null;

  const organizationRole = activeOrganization ? activeOrganization.role : legacyRoleToOrganizationRole(user.role);
  const legacyRole = organizationRoleToLegacyRole(organizationRole);

  return {
    ...user,
    role: legacyRole,
    displayRole: organizationRoleToDisplayRole(organizationRole),
    legacyRole,
    organizationRole,
    activeOrganizationId: activeOrganization?.id || null,
    activeOrganization: activeOrganization
      ? { id: activeOrganization.id, name: activeOrganization.name }
      : null,
    organizations,
  };
}

function getRequestOrganizationId(req) {
  return parseIdParam(req.session?.user?.activeOrganizationId || req.session?.user?.activeOrganization?.id);
}

function requireOrganizationId(req, res) {
  const organizationId = getRequestOrganizationId(req);
  if (organizationId === null) {
    res.status(400).json({ error: "Organización activa no disponible" });
    return null;
  }
  return organizationId;
}

function withOrganizationScope(baseWhere, params, organizationId, columnRef = "organization_id") {
  const where = Array.isArray(baseWhere) ? [...baseWhere] : [];
  const nextParams = Array.isArray(params) ? [...params] : [];
  nextParams.push(organizationId);
  where.push(`${columnRef} = $${nextParams.length}`);
  return {
    params: nextParams,
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
  };
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
       WHERE id = $6 AND organization_id = $7`,
      [paymentDate.toISOString(), movementCategory, movementDescription, Math.abs(Number(invoiceRow.amount || 0)), invoiceRow.id, movementId, invoiceRow.organizationId]
    );
    if (updateResult.rowCount === 0) {
      movementId = null;
    }
  }

  if (!movementId) {
    const movementResult = await client.query(
      `INSERT INTO movements (organization_id, date, type, category, description, amount, status, source, invoice_id)
       VALUES ($1, $2, 'ingreso', $3, $4, $5, 'Registrado', 'invoice-payment', $6)
       RETURNING id`,
      [invoiceRow.organizationId, paymentDate.toISOString(), movementCategory, movementDescription, Math.abs(Number(invoiceRow.amount || 0)), invoiceRow.id]
    );
    movementId = movementResult.rows[0]?.id || null;
  }

  const invoiceUpdate = await client.query(
    `UPDATE invoices
       SET status = $1, paid_at = $2, payment_movement_id = $3, updated_at = NOW()
     WHERE id = $4 AND organization_id = $5
     RETURNING ${INVOICE_SELECT_FIELDS}`,
    [toInvoiceDbStatus("pagada"), paymentDate.toISOString(), movementId, invoiceRow.id, invoiceRow.organizationId]
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
    organizationId,
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
      `INSERT INTO invoices (organization_id, number, party, date, duedate, amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${INVOICE_SELECT_FIELDS}`,
      [organizationId, number.trim(), party.trim(), date || null, dueDate || null, invoiceAmount, toInvoiceDbStatus(normalizedStatus)]
    );
    invoiceRow = result.rows[0];
  } else {
    const result = await client.query(
        `UPDATE invoices
          SET number = $1, party = $2, date = $3, duedate = $4, amount = $5, status = $6, updated_at = NOW()
       WHERE id = $7 AND organization_id = $8
        RETURNING ${INVOICE_SELECT_FIELDS}`,
      [number.trim(), party.trim(), date || null, dueDate || null, invoiceAmount, toInvoiceDbStatus(normalizedStatus), id, organizationId]
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
  return res.status(503).send("Astro build missing");
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

  try {
    const { user } = await findUserByEmail(email);

    if (!user) {
      return res.redirect("/login?error=" + encodeURIComponent("Credenciales inválidas"));
    }

    if (!user.active) {
      return res.redirect("/login?error=" + encodeURIComponent("Usuario inactivo"));
    }

    if (!user.password) {
      return res.redirect("/login?error=" + encodeURIComponent("Credenciales inválidas"));
    }

    const match = await safeComparePassword(password, user.password);
    if (!match) {
      return res.redirect("/login?error=" + encodeURIComponent("Credenciales inválidas"));
    }

    await persistSessionUser(req, user);
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

  try {
    const { user } = await findUserByEmail(email);

    if (!user) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    if (!user.active) {
      return res.status(403).json({ error: "Usuario inactivo" });
    }

    if (!user.password) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const match = await safeComparePassword(password, user.password);
    if (!match) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const sessionUser = await persistSessionUser(req, user);
    return res.json(sessionUser);
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

  try {
    const { normalizedEmail, user: existingUser } = await findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: "El correo ya está registrado" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
    const hash = await bcrypt.hash(password, 10);
    const result = await client.query(
      `INSERT INTO users (email, name, password, role, active)
       VALUES ($1, $2, $3, 'Productor', true)
       RETURNING id, email, name, role, active, created_at`,
      [normalizedEmail, name.trim(), hash]
    );

      const organizationResult = await client.query(
        `INSERT INTO organizations (name, status, created_by_user_id)
         VALUES ($1, 'active', $2)
         RETURNING id, name`,
        [buildDefaultOrganizationName(name), result.rows[0].id]
      );

      const organizationId = organizationResult.rows[0].id;

      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role, status, is_default)
         VALUES ($1, $2, 'owner', 'active', true)`,
        [organizationId, result.rows[0].id]
      );

      await client.query(
        `UPDATE users SET default_organization_id = $1 WHERE id = $2`,
        [organizationId, result.rows[0].id]
      );

      await client.query("COMMIT");
      req.session.activeOrganizationId = organizationId;
      const sessionUser = await persistSessionUser(req, result.rows[0]);
      return res.status(201).json(sessionUser);
    } catch (innerErr) {
      await client.query("ROLLBACK");
      throw innerErr;
    } finally {
      client.release();
    }
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
    clearSessionCookie(res);
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
    clearSessionCookie(res);
    return res.redirect("/login");
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error POST /api/logout", err);
      return res.status(500).json({ error: "No se pudo cerrar sesión" });
    }
    clearSessionCookie(res);
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

app.post("/api/session/active-organization", ensureApiAuth, async (req, res) => {
  const organizationId = parseIdParam(req.body?.organizationId);
  if (organizationId === null) {
    return res.status(400).json({ error: "Organización inválida" });
  }

  try {
    const user = await getUserById(req.session.user.id);
    if (!user) {
      return res.status(401).json({ error: "no autenticado" });
    }

    req.session.activeOrganizationId = organizationId;
    const sessionUser = await persistSessionUser(req, user);
    if (sessionUser.activeOrganizationId !== organizationId) {
      return res.status(403).json({ error: "Permiso denegado" });
    }

    return res.json(sessionUser);
  } catch (err) {
    console.error("Error POST /api/session/active-organization", err);
    return res.status(500).json({ error: "No se pudo cambiar la organización activa" });
  }
});

app.get("/api/users", ensureAdminApi, async (req, res) => {
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;

  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, om.role, om.status = 'active' AS active, u.created_at
         FROM organization_memberships om
         INNER JOIN users u ON u.id = om.user_id
        WHERE om.organization_id = $1
        ORDER BY u.created_at DESC, u.id DESC`,
      [organizationId]
    );
    return res.json(result.rows.map((row) => ({
      ...row,
      role: organizationRoleToDisplayRole(row.role),
      organizationRole: normalizeOrganizationRole(row.role),
      active: !!row.active,
    })));
  } catch (err) {
    console.error("Error GET /api/users", err);
    return res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

app.post("/api/users", ensureAdminApi, async (req, res) => {
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;

  const { email, password, role, active, name } = req.body;
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    return res.status(400).json({ error: "Email y contraseña obligatorios" });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const normalizedEmail = normalizeEmail(email);
      const orgRole = normalizeOrganizationRole(role);
      const activeStatus = active !== false ? "active" : "inactive";
      let user = null;

      const existingResult = await client.query(
        "SELECT id, email, name, role, active, created_at, default_organization_id FROM users WHERE LOWER(email) = $1",
        [normalizedEmail]
      );

      if (existingResult.rows.length > 0) {
        user = existingResult.rows[0];
      } else {
        const hash = await bcrypt.hash(password, 10);
        const userResult = await client.query(
          `INSERT INTO users (email, password, role, active, name)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, email, name, role, active, created_at, default_organization_id`,
          [normalizedEmail, hash, normalizeRole(role), true, isNonEmptyString(name) ? name.trim() : ""]
        );
        user = userResult.rows[0];
      }

      const membershipExists = await client.query(
        `SELECT id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, user.id]
      );
      if (membershipExists.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "El usuario ya pertenece a esta empresa" });
      }

      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role, status, is_default)
         VALUES ($1, $2, $3, $4, false)`,
        [organizationId, user.id, orgRole, activeStatus]
      );

      if (!user.default_organization_id) {
        await client.query(`UPDATE users SET default_organization_id = $1 WHERE id = $2`, [organizationId, user.id]);
      }

      await client.query("COMMIT");
      return res.status(201).json({
        id: user.id,
        email: user.email,
        name: user.name || (isNonEmptyString(name) ? name.trim() : ""),
        role: organizationRoleToDisplayRole(orgRole),
        organizationRole: orgRole,
        active: activeStatus === "active",
        created_at: user.created_at,
      });
    } catch (innerErr) {
      await client.query("ROLLBACK");
      throw innerErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error POST /api/users", err);
    return res.status(500).json({ error: "Error al crear usuario" });
  }
});

app.put("/api/users/:id", ensureAdminApi, async (req, res) => {
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  const uid = parseIdParam(req.params.id);
  if (uid === null) {
    return res.status(400).json({ error: "ID de usuario inválido" });
  }
  const myRole = String(req.session.user.role || "").toLowerCase();

  const { email, password, role, active, name } = req.body;

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const membershipResult = await client.query(
        `SELECT om.id, om.role, om.status FROM organization_memberships om WHERE om.organization_id = $1 AND om.user_id = $2`,
        [organizationId, uid]
      );
      if (membershipResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

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

      if (fields.length > 0) {
        values.push(uid);
        await client.query(`UPDATE users SET ${fields.join(", ")} WHERE id = $${idx}`, values);
      }

      if (role && myRole === "admin") {
        await client.query(
          `UPDATE organization_memberships SET role = $1, updated_at = NOW() WHERE organization_id = $2 AND user_id = $3`,
          [normalizeOrganizationRole(role), organizationId, uid]
        );
      }
      if (typeof active !== "undefined" && myRole === "admin") {
        await client.query(
          `UPDATE organization_memberships SET status = $1, updated_at = NOW() WHERE organization_id = $2 AND user_id = $3`,
          [active ? "active" : "inactive", organizationId, uid]
        );
      }

      const updatedResult = await client.query(
        `SELECT u.id, u.email, u.name, om.role, om.status = 'active' AS active, u.created_at
           FROM organization_memberships om
           INNER JOIN users u ON u.id = om.user_id
          WHERE om.organization_id = $1 AND u.id = $2`,
        [organizationId, uid]
      );

      const updatedUser = updatedResult.rows[0];
      await client.query("COMMIT");

      const currentUserId = req.session?.user?.id;
      if (currentUserId === updatedUser.id) {
        if (!updatedUser.active) {
          return req.session.destroy((err) => {
            if (err) {
              console.error("Error destroying session after user deactivation", err);
            }
            clearSessionCookie(res);
            return res.json({
              ...updatedUser,
              role: organizationRoleToDisplayRole(updatedUser.role),
              organizationRole: normalizeOrganizationRole(updatedUser.role),
            });
          });
        }

        const currentUser = await getUserById(updatedUser.id);
        if (currentUser) {
          await persistSessionUser(req, currentUser);
        }
      }

      return res.json({
        ...updatedUser,
        role: organizationRoleToDisplayRole(updatedUser.role),
        organizationRole: normalizeOrganizationRole(updatedUser.role),
      });
    } catch (innerErr) {
      await client.query("ROLLBACK");
      throw innerErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error PUT /api/users/:id", err);
    return res.status(500).json({ error: "Error al actualizar usuario" });
  }
});

app.delete("/api/users/:id", ensureAdminApi, async (req, res) => {
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  const uid = parseIdParam(req.params.id);
  if (uid === null) {
    return res.status(400).json({ error: "ID de usuario inválido" });
  }
  const myRole = String(req.session.user.role || "").toLowerCase();

  if (myRole !== "admin" && req.session.user.id !== uid) {
    return res.status(403).json({ error: "Permiso denegado" });
  }

  try {
    const result = await pool.query(
      "DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = $2",
      [organizationId, uid]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    if (req.session?.user?.id === uid) {
      return req.session.destroy((err) => {
        if (err) {
          console.error("Error destroying session after self-delete", err);
        }
        clearSessionCookie(res);
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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const result = await pool.query(
      `SELECT ${MOVEMENT_SELECT_FIELDS} FROM movements WHERE organization_id = $1 ORDER BY date DESC NULLS LAST, id DESC`,
      [organizationId]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/movements", err);
    return res.status(500).json({ error: "Error al obtener movimientos" });
  }
});

app.get("/api/movements/summary", ensureAuth, async (req, res) => {
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const totalsResult = await pool.query(`
      SELECT
        COUNT(*)::int AS total_count,
        COALESCE(SUM(CASE WHEN lower(type::text) = 'ingreso' THEN ABS(amount) ELSE 0 END), 0) AS income_total,
        COALESCE(SUM(CASE WHEN lower(type::text) = 'gasto' THEN ABS(amount) ELSE 0 END), 0) AS expense_total
      FROM movements
      WHERE organization_id = $1
    `, [organizationId]);

    const recentResult = await pool.query(`
      SELECT ${MOVEMENT_SELECT_FIELDS}
      FROM movements
      WHERE organization_id = $1
      ORDER BY date DESC NULLS LAST, id DESC
      LIMIT 5
    `, [organizationId]);

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
  const organizationId = parseIdParam(query.organizationId);
  const from = String(query.from || "").trim();
  const to = String(query.to || "").trim();
  const type = String(query.type || "all").trim().toLowerCase();
  const normalizedType = ["ingreso", "gasto"].includes(type) ? type : "all";
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (from && !datePattern.test(from)) return { error: "El filtro 'from' no es válido" };
  if (to && !datePattern.test(to)) return { error: "El filtro 'to' no es válido" };
  if (organizationId === null) return { error: "La organización activa es inválida" };

  params.push(organizationId);
  where.push(`organization_id = $${params.length}`);

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
  const organizationId = parseIdParam(query.organizationId);
  const from = String(query.from || "").trim();
  const to = String(query.to || "").trim();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (from && !datePattern.test(from)) return { error: "El filtro 'from' no es válido" };
  if (to && !datePattern.test(to)) return { error: "El filtro 'to' no es válido" };
  if (organizationId === null) return { error: "La organización activa es inválida" };

  params.push(organizationId);
  where.push(`organization_id = $${params.length}`);

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getRecentMonthlyAverages(byMonth = []) {
  const recentMonths = Array.isArray(byMonth) ? byMonth.slice(-3) : [];
  const monthsUsed = recentMonths.length;
  if (!monthsUsed) {
    return {
      monthsUsed: 0,
      avgMonthlyIncomeLast3: 0,
      avgMonthlyExpenseLast3: 0,
      avgMonthlyBalanceLast3: 0,
    };
  }

  const totals = recentMonths.reduce((acc, row) => {
    acc.income += Number(row.incomeTotal || 0);
    acc.expense += Number(row.expenseTotal || 0);
    acc.balance += Number(row.balance || 0);
    return acc;
  }, { income: 0, expense: 0, balance: 0 });

  return {
    monthsUsed,
    avgMonthlyIncomeLast3: totals.income / monthsUsed,
    avgMonthlyExpenseLast3: totals.expense / monthsUsed,
    avgMonthlyBalanceLast3: totals.balance / monthsUsed,
  };
}

function buildCopilotSummaryFromReport(report, scope = {}) {
  const summary = report?.summary || {};
  const movements = report?.movements || {};
  const invoices = report?.invoices || {};
  const invoiceRows = Array.isArray(invoices.invoices) ? invoices.invoices : [];
  const overdueInvoices = invoiceRows.filter((row) => normalizeInvoiceStatus(row.status) === "vencida");
  const paidInvoices = invoiceRows.filter((row) => normalizeInvoiceStatus(row.status) === "pagada");
  const recentMovementCount30d = (Array.isArray(movements.movements) ? movements.movements : []).filter((row) => {
    if (!row?.date) return false;
    const date = new Date(row.date);
    if (Number.isNaN(date.getTime())) return false;
    return date >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }).length;
  const overdueAmount = overdueInvoices.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const paidInvoiceAmount = paidInvoices.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const invoiceTotal = Number(summary.invoiceTotal || 0);
  const pendingAmount = Number(summary.invoicePendingAmount || 0);
  const collectionRate = Number(summary.invoiceCount || 0) > 0 ? Number(invoices.paidCount || 0) / Number(summary.invoiceCount || 1) : 0;
  const pendingRatio = invoiceTotal > 0 ? pendingAmount / invoiceTotal : 0;
  const overdueRatio = invoiceTotal > 0 ? overdueAmount / invoiceTotal : 0;
  const averages = getRecentMonthlyAverages(movements.byMonth || []);

  const cashflowComponent = Number(summary.expenseTotal || 0) === 0
    ? (Number(summary.incomeTotal || 0) > 0 ? 35 : 15)
    : Number(summary.netBalance || 0) >= 0.2 * Number(summary.expenseTotal || 0)
      ? 35
      : Number(summary.netBalance || 0) >= 0
        ? 25
        : Number(summary.netBalance || 0) >= -0.1 * Number(summary.expenseTotal || 0)
          ? 10
          : 0;

  const collectionsComponent = Number(summary.invoiceCount || 0) === 0
    ? 15
    : collectionRate >= 0.8 ? 25 : collectionRate >= 0.6 ? 20 : collectionRate >= 0.4 ? 12 : collectionRate > 0 ? 6 : 0;

  const overdueComponent = invoiceTotal === 0
    ? 15
    : overdueRatio === 0 ? 25 : overdueRatio <= 0.1 ? 18 : overdueRatio <= 0.25 ? 10 : 0;

  const activityComponent = recentMovementCount30d >= 10 ? 15 : recentMovementCount30d >= 5 ? 10 : recentMovementCount30d >= 1 ? 5 : 0;

  const scoreValue = clamp(Math.round(cashflowComponent + collectionsComponent + overdueComponent + activityComponent), 0, 100);
  const scoreLabel = scoreValue >= 80 ? "saludable" : scoreValue >= 60 ? "estable" : scoreValue >= 40 ? "atencion" : "riesgo";

  const estimatedIncome = averages.avgMonthlyIncomeLast3;
  const estimatedExpense = averages.avgMonthlyExpenseLast3;
  const estimatedCollections = Math.min(pendingAmount, Math.max(0, overdueAmount * 0.4 + Math.max(0, pendingAmount - overdueAmount) * 0.7));
  const estimatedBalance = Number(summary.netBalance || 0) + estimatedIncome + estimatedCollections - estimatedExpense;
  const confidence = averages.monthsUsed >= 3 ? "high" : averages.monthsUsed === 2 ? "medium" : "low";

  const alerts = [];
  if (estimatedBalance < 0) {
    alerts.push({
      code: "negative-cashflow",
      severity: Number(summary.expenseTotal || 0) > 0 && estimatedBalance < -0.1 * Number(summary.expenseTotal || 0) ? "high" : "medium",
      title: "El flujo proyectado es negativo",
      detail: `La caja estimada a 30 días sería ${formatReportMoney(estimatedBalance)}.`,
      metric: "projectedCash",
      currentValue: estimatedBalance,
      threshold: 0,
    });
  }
  if (Number(summary.invoiceOverdueCount || 0) > 0) {
    alerts.push({
      code: "overdue-invoices",
      severity: overdueRatio > 0.25 ? "high" : overdueRatio > 0.1 ? "medium" : "low",
      title: "Hay facturas vencidas",
      detail: `${summary.invoiceOverdueCount} factura(s) vencida(s) por ${formatReportMoney(overdueAmount)}.`,
      metric: "invoiceOverdueAmount",
      currentValue: overdueAmount,
      threshold: 0,
    });
  }
  if (pendingRatio > 0.35) {
    alerts.push({
      code: "high-pending-portfolio",
      severity: pendingRatio > 0.5 ? "high" : "medium",
      title: "La cartera pendiente es alta",
      detail: `Tienes ${formatReportMoney(pendingAmount)} todavía por cobrar.`,
      metric: "invoicePendingAmount",
      currentValue: pendingAmount,
      threshold: invoiceTotal * 0.35,
    });
  }
  if (recentMovementCount30d === 0) {
    alerts.push({
      code: "low-activity",
      severity: "medium",
      title: "No hay actividad reciente",
      detail: "No se registraron movimientos en los últimos 30 días.",
      metric: "recentMovementCount30d",
      currentValue: 0,
      threshold: 1,
    });
  }

  const highlights = [];
  if (scoreLabel === "saludable") {
    highlights.push("La operación mantiene una salud financiera positiva.");
  } else if (scoreLabel === "estable") {
    highlights.push("La operación está estable, pero conviene vigilar cartera y gastos.");
  } else {
    highlights.push("La operación necesita acción inmediata para proteger la liquidez.");
  }
  if (Number(summary.invoiceOverdueCount || 0) > 0) {
    highlights.push("Las facturas vencidas son el principal foco de atención.");
  } else if (pendingAmount > 0) {
    highlights.push("Cobrar la cartera pendiente mejoraría el cierre proyectado.");
  }

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      from: scope.from || null,
      to: scope.to || null,
      currency: "COP",
      tenantId: scope.organizationId || null,
    },
    kpis: {
      movementCount: Number(summary.movementCount || 0),
      invoiceCount: Number(summary.invoiceCount || 0),
      incomeTotal: Number(summary.incomeTotal || 0),
      expenseTotal: Number(summary.expenseTotal || 0),
      movementBalance: Number(summary.movementBalance || 0),
      invoiceTotal,
      invoicePendingAmount: pendingAmount,
      invoicePendingCount: Number(summary.invoicePendingCount || 0),
      invoiceOverdueCount: Number(summary.invoiceOverdueCount || 0),
      invoiceOverdueAmount: overdueAmount,
      paidInvoiceCount: Number(invoices.paidCount || 0),
      paidInvoiceAmount,
      collectionRate,
      pendingRatio,
      overdueRatio,
      recentMovementCount30d,
      avgMonthlyIncomeLast3: averages.avgMonthlyIncomeLast3,
      avgMonthlyExpenseLast3: averages.avgMonthlyExpenseLast3,
      avgMonthlyBalanceLast3: averages.avgMonthlyBalanceLast3,
    },
    score: {
      value: scoreValue,
      label: scoreLabel,
      components: {
        cashflow: cashflowComponent,
        collections: collectionsComponent,
        overdue: overdueComponent,
        activity: activityComponent,
      },
    },
    alerts,
    forecast: {
      basis: "last-3-months-average",
      monthsUsed: averages.monthsUsed,
      confidence,
      next30Days: {
        estimatedIncome,
        estimatedExpense,
        estimatedBalance,
        estimatedCollections,
      },
    },
    highlights,
    warnings: Array.isArray(report?.warnings) ? report.warnings : [],
  };
}

async function buildPortfolioOverviewForUser(userId, query = {}) {
  const organizations = await listOrganizationsForUser(userId);
  const organizationReports = [];

  for (const organization of organizations) {
    const report = await buildOverviewReport({ ...query, organizationId: organization.id });
    if (report.error) {
      return { error: report.error };
    }

    const copilot = buildCopilotSummaryFromReport(report, {
      from: query.from,
      to: query.to,
      organizationId: organization.id,
    });

    organizationReports.push({ organization, report, copilot });
  }

  const summary = organizationReports.reduce((acc, item) => {
    acc.incomeTotal += Number(item.report.summary?.incomeTotal || 0);
    acc.expenseTotal += Number(item.report.summary?.expenseTotal || 0);
    acc.movementBalance += Number(item.report.summary?.movementBalance || 0);
    acc.invoiceTotal += Number(item.report.summary?.invoiceTotal || 0);
    acc.invoicePendingAmount += Number(item.report.summary?.invoicePendingAmount || 0);
    acc.invoicePendingCount += Number(item.report.summary?.invoicePendingCount || 0);
    acc.invoiceOverdueAmount += Number(item.copilot.kpis?.invoiceOverdueAmount || 0);
    acc.invoiceOverdueCount += Number(item.report.summary?.invoiceOverdueCount || 0);
    acc.movementCount += Number(item.report.summary?.movementCount || 0);
    acc.invoiceCount += Number(item.report.summary?.invoiceCount || 0);
    return acc;
  }, {
    incomeTotal: 0,
    expenseTotal: 0,
    movementBalance: 0,
    invoiceTotal: 0,
    invoicePendingAmount: 0,
    invoicePendingCount: 0,
    invoiceOverdueAmount: 0,
    invoiceOverdueCount: 0,
    movementCount: 0,
    invoiceCount: 0,
  });

  const ranking = organizationReports
    .map((item) => ({
      organizationId: item.organization.id,
      organizationName: item.organization.name,
      score: item.copilot.score.value,
      label: item.copilot.score.label,
      trafficLight: item.copilot.score.value >= 80 ? "green" : item.copilot.score.value >= 60 ? "yellow" : item.copilot.score.value >= 40 ? "orange" : "red",
      balance: Number(item.report.summary?.movementBalance || 0),
      invoicePendingAmount: Number(item.report.summary?.invoicePendingAmount || 0),
      invoiceOverdueAmount: Number(item.copilot.kpis?.invoiceOverdueAmount || 0),
    }))
    .sort((a, b) => b.score - a.score || b.balance - a.balance);

  ranking.forEach((row, index) => {
    row.position = index + 1;
  });

  const portfolioScore = ranking.length
    ? Math.round(ranking.reduce((sum, item) => sum + Number(item.score || 0), 0) / ranking.length)
    : 0;
  const portfolioLabel = portfolioScore >= 80 ? "saludable" : portfolioScore >= 60 ? "estable" : portfolioScore >= 40 ? "atencion" : "riesgo";

  const healthyCompanies = ranking.filter((item) => item.trafficLight === "green").length;
  const warningCompanies = ranking.filter((item) => item.trafficLight === "yellow" || item.trafficLight === "orange").length;
  const riskCompanies = ranking.filter((item) => item.trafficLight === "red").length;

  const collectionRate = summary.invoiceCount > 0
    ? (summary.invoiceCount - summary.invoicePendingCount) / summary.invoiceCount
    : 0;

  const organizationRows = organizationReports.map((item) => ({
    organizationId: item.organization.id,
    organizationName: item.organization.name,
    kpis: item.copilot.kpis,
    score: {
      value: item.copilot.score.value,
      label: item.copilot.score.label,
      trafficLight: item.copilot.score.value >= 80 ? "green" : item.copilot.score.value >= 60 ? "yellow" : item.copilot.score.value >= 40 ? "orange" : "red",
    },
    forecast: item.copilot.forecast,
    alerts: item.copilot.alerts,
  }));

  const highlights = [];
  const topRisk = ranking.find((item) => item.trafficLight === "red");
  if (topRisk) {
    highlights.push(`${topRisk.organizationName} concentra la mayor presión financiera del portafolio.`);
  }
  if (summary.invoiceOverdueAmount > 0) {
    highlights.push(`La cartera vencida consolidada asciende a ${formatReportMoney(summary.invoiceOverdueAmount)}.`);
  } else {
    highlights.push("No hay cartera vencida en el portafolio consolidado.");
  }

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      from: query.from || null,
      to: query.to || null,
      currency: "COP",
      organizationIds: organizations.map((item) => item.id),
      organizationCount: organizations.length,
      mode: "portfolio",
    },
    summary: {
      ...summary,
      collectionRate,
      portfolioScore,
      portfolioLabel,
      healthyCompanies,
      warningCompanies,
      riskCompanies,
    },
    ranking,
    organizations: organizationRows,
    highlights,
    warnings: organizationReports.flatMap((item) => item.report.warnings || []),
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
  const copilot = buildCopilotSummaryFromReport(report, report?.filters || {});

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  doc.pipe(res);

  addPdfHeader(doc, report);

  doc.roundedRect(doc.page.margins.left, doc.y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 72, 16).fillAndStroke("#0f172a", "#0f172a");
  doc.fillColor("#ffffff").fontSize(10).font("Helvetica").text("Resumen ejecutivo del copiloto", doc.page.margins.left + 16, doc.y - 62);
  doc.fontSize(30).font("Helvetica-Bold").text(String(copilot.score?.value || 0), doc.page.margins.left + 16, doc.y - 48);
  doc.fontSize(12).font("Helvetica-Bold").text(String(copilot.score?.label || "sin datos").toUpperCase(), doc.page.margins.left + 70, doc.y - 40);
  doc.fontSize(10).font("Helvetica").fillColor("#cbd5e1").text((copilot.highlights || []).slice(0, 2).join(" ") || "Sin hallazgos ejecutivos para este período.", doc.page.margins.left + 180, doc.y - 50, { width: 300 });
  doc.y += 18;

  const summary = report.summary || {};
  const metrics = [
    ["Ingresos", formatReportMoney(summary.incomeTotal || 0), "#059669"],
    ["Gastos", formatReportMoney(summary.expenseTotal || 0), "#e11d48"],
    ["Balance", formatReportMoney(summary.netBalance || 0), "#0f172a"],
    ["Movimientos", String(summary.movementCount || 0), "#0f172a"],
    ["Vencidas", String(copilot.kpis?.invoiceOverdueCount || 0), "#e11d48"],
    ["Caja 30 días", formatReportMoney(copilot.forecast?.next30Days?.estimatedBalance || 0), "#d97706"],
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

  drawSectionTitle(doc, "Alertas prioritarias");
  const alerts = Array.isArray(copilot.alerts) ? copilot.alerts.slice(0, 4) : [];
  if (!alerts.length) {
    doc.fillColor("#0f172a").fontSize(10).font("Helvetica").text("No se detectaron alertas críticas para este período.");
  } else {
    alerts.forEach((alert) => {
      doc.roundedRect(doc.x, doc.y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 32, 10).fillAndStroke("#f8fafc", "#e2e8f0");
      doc.fillColor("#0f172a").fontSize(10).font("Helvetica-Bold").text(alert.title || "Alerta", doc.x + 10, doc.y + 8);
      doc.fillColor("#64748b").fontSize(9).font("Helvetica").text(alert.detail || "", doc.x + 170, doc.y + 8, { width: 320 });
      doc.moveDown(1.9);
    });
  }

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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const filterResult = buildMovementReportFilters({ ...req.query, organizationId });
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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const report = await buildOverviewReport({ ...req.query, organizationId });
    if (report.error) {
      return res.status(400).json({ error: report.error });
    }

    return res.json(report);
  } catch (err) {
    console.error("Error GET /api/reports/overview", err);
    return res.status(500).json({ error: "Error al obtener resumen general de reportes" });
  }
});

app.get("/api/copilot/summary", ensureApiAuth, async (req, res) => {
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;

  try {
    const report = await buildOverviewReport({ ...req.query, organizationId });
    if (report.error) {
      return res.status(400).json({ error: report.error });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.json(buildCopilotSummaryFromReport(report, {
      from: req.query?.from,
      to: req.query?.to,
      organizationId,
    }));
  } catch (err) {
    console.error("Error GET /api/copilot/summary", err);
    return res.status(500).json({ error: "Error al obtener el resumen del copiloto" });
  }
});

app.get("/api/portfolio/overview", ensureApiAuth, async (req, res) => {
  try {
    const portfolio = await buildPortfolioOverviewForUser(req.session.user.id, req.query || {});
    if (portfolio.error) {
      return res.status(400).json({ error: portfolio.error });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.json(portfolio);
  } catch (err) {
    console.error("Error GET /api/portfolio/overview", err);
    return res.status(500).json({ error: "Error al obtener el comparativo multiempresa" });
  }
});

app.get("/api/reports/overview/csv", ensureAuth, async (req, res) => {
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const report = await buildOverviewReport({ ...req.query, organizationId });
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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const report = await buildOverviewReport({ ...req.query, organizationId });
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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "ID de movimiento inválido" });
    }
    const result = await pool.query(
      `SELECT ${MOVEMENT_SELECT_FIELDS} FROM movements WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const { date, type, category, description, amount, status } = req.body;
    const normalizedType = normalizeMovementType(type);
    if (!isValidAmount(Number(amount)) || !isMovementType(normalizedType)) {
      return res.status(400).json({ error: "Tipo y monto son obligatorios" });
    }

    const result = await pool.query(
      `INSERT INTO movements (organization_id, date, type, category, description, amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, date, type, category, description, amount, status`,
      [organizationId, date || null, normalizedType, category || null, description || null, normalizeMovementAmount(normalizedType, amount), status || "Registrado"]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/movements", err);
    return res.status(500).json({ error: "Error al crear movimiento" });
  }
});

app.put("/api/movements/:id", ensureAuth, ensureAccountingWriteApi, async (req, res) => {
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
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
       WHERE id = $7 AND organization_id = $8
        RETURNING id, date, type, category, description, amount, status, created_at, updated_at`,
      [date || null, normalizedType, category || null, description || null, normalizeMovementAmount(normalizedType, amount), status || "Registrado", id, organizationId]
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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "ID de movimiento inválido" });
    }
    const result = await pool.query("DELETE FROM movements WHERE id = $1 AND organization_id = $2", [id, organizationId]);

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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const result = await pool.query(
      `SELECT ${INVOICE_SELECT_FIELDS} FROM invoices WHERE organization_id = $1 ORDER BY id DESC`,
      [organizationId]
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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "ID de factura inválido" });
    }
    const result = await pool.query(
      `SELECT ${INVOICE_SELECT_FIELDS} FROM invoices WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const { number, party, date, dueDate, amount, status, items } = req.body;
    if (!isNonEmptyString(number) || !isNonEmptyString(party) || !isValidAmount(Number(amount))) {
      return res.status(400).json({ error: "Número, contraparte y monto son obligatorios" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await saveInvoiceWithItems(client, {
        organizationId,
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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
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
        organizationId,
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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  const id = parseIdParam(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "ID de factura inválido" });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT ${INVOICE_SELECT_FIELDS} FROM invoices WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [id, organizationId]
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
        organizationId,
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
  const organizationId = requireOrganizationId(req, res);
  if (organizationId === null) return;
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "ID de factura inválido" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const lookup = await client.query("SELECT payment_movement_id FROM invoices WHERE id = $1 AND organization_id = $2", [id, organizationId]);
      if (lookup.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Factura no encontrada" });
      }

      if (lookup.rows[0].payment_movement_id) {
        await client.query("DELETE FROM movements WHERE id = $1 AND organization_id = $2", [lookup.rows[0].payment_movement_id, organizationId]);
      }

      const result = await client.query("DELETE FROM invoices WHERE id = $1 AND organization_id = $2", [id, organizationId]);
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
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_by_user_id INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS organization_memberships (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        is_default BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        UNIQUE (organization_id, user_id)
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
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now()`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_organization_id INTEGER`);

    await pool.query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Registrado'`);
    await pool.query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'`);
    await pool.query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS invoice_id INTEGER`);
    await pool.query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS organization_id INTEGER`);
    await pool.query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()`);
    await pool.query(`UPDATE movements SET amount = ABS(amount)`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS organization_id INTEGER`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS duedate TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_movement_id INTEGER`);
    await pool.query(`
      DO $$
      DECLARE
        status_type TEXT;
      BEGIN
        SELECT data_type
          INTO status_type
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'invoices'
           AND column_name = 'status';

        IF status_type = 'USER-DEFINED' THEN
          EXECUTE $sql$
            UPDATE invoices
               SET status = (
                 CASE
                   WHEN lower(trim(COALESCE(status::text, ''))) IN ('pagada', 'paid') THEN 'Pagada'
                   WHEN lower(trim(COALESCE(status::text, ''))) IN ('vencida', 'vencido', 'overdue') THEN 'Vencida'
                   ELSE 'Pendiente'
                 END
               )::invoice_status
          $sql$;
        ELSE
          UPDATE invoices
             SET status = CASE
               WHEN lower(trim(COALESCE(status::text, ''))) IN ('pagada', 'paid') THEN 'Pagada'
               WHEN lower(trim(COALESCE(status::text, ''))) IN ('vencida', 'vencido', 'overdue') THEN 'Vencida'
               ELSE 'Pendiente'
             END;
        END IF;
      END
      $$;
    `);
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

    let defaultOrganizationId = null;
    const defaultOrganizationResult = await pool.query(
      `SELECT id FROM organizations ORDER BY id ASC LIMIT 1`
    );
    if (defaultOrganizationResult.rows.length > 0) {
      defaultOrganizationId = defaultOrganizationResult.rows[0].id;
    } else {
      const createdOrganization = await pool.query(
        `INSERT INTO organizations (name, status)
         VALUES ('Operación principal', 'active')
         RETURNING id`
      );
      defaultOrganizationId = createdOrganization.rows[0].id;
    }

    await pool.query(
      `UPDATE users
          SET default_organization_id = COALESCE(default_organization_id, $1)
        WHERE default_organization_id IS NULL`,
      [defaultOrganizationId]
    );

    await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, status, is_default)
       SELECT $1, u.id,
               CASE
                WHEN lower(coalesce(u.role::text, '')) = 'admin' THEN 'owner'
                WHEN lower(coalesce(u.role::text, '')) = 'contador' THEN 'accountant'
                ELSE 'manager'
              END,
              CASE WHEN u.active THEN 'active' ELSE 'inactive' END,
              true
         FROM users u
        WHERE NOT EXISTS (
          SELECT 1
            FROM organization_memberships om
           WHERE om.organization_id = $1 AND om.user_id = u.id
        )`,
      [defaultOrganizationId]
    );

    await pool.query(
      `UPDATE movements SET organization_id = $1 WHERE organization_id IS NULL`,
      [defaultOrganizationId]
    );
    await pool.query(
      `UPDATE invoices SET organization_id = $1 WHERE organization_id IS NULL`,
      [defaultOrganizationId]
    );
  } catch (err) {
    console.error("Error inicializando base de datos:", err);
    throw err;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initDbWithRetry() {
  const attempts = parseInt(process.env.DB_INIT_RETRIES || "8", 10);
  const delayMs = parseInt(process.env.DB_INIT_DELAY_MS || "3000", 10);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await initDb();
      return;
    } catch (error) {
      console.error(`Intento ${attempt}/${attempts} fallido al inicializar base de datos:`, error.message || error);
      if (attempt === attempts) {
        throw error;
      }
      await wait(delayMs);
    }
  }
}

// =======================
// Start server
// =======================
async function startServer() {
  try {
    await initDbWithRetry();
    app.listen(PORT, () => {
      console.log(`Servidor escuchando en puerto ${PORT}`);
    });
  } catch (err) {
    console.error("No se pudo iniciar la aplicación:", err);
    process.exit(1);
  }
}

startServer();
