// server.js
"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.render("login", { title: "Login" });
});

app.get("/dashboard", (req, res) => {
  res.render("dashboard", { title: "Dashboard", active: "dashboard" });
});

app.get("/movimientos", (req, res) => {
  res.render("movimientos", { title: "Movimientos", active: "movimientos" });
});

app.get("/facturas", (req, res) => {
  res.render("facturas", { title: "Facturas", active: "facturas" });
});

app.get("/usuarios", (req, res) => {
  res.render("usuarios", { title: "Usuarios", active: "usuarios" });
});

app.get("/reportes", (req, res) => {
  res.render("reportes", { title: "Reportes", active: "reportes" });
});

app.get("/configuraciones", (req, res) => {
  res.render("configuraciones", { title: "Configuración", active: "config" });
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));


app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/js", express.static(path.join(__dirname, "js")));
// HELPERS
// ==============================
function toInt(value, fallback = null) {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

// ==============================
// API: MOVEMENTS
// ==============================

// GET /api/movements
app.get("/api/movements", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, date, type, category, description, amount, status
       FROM movements
       ORDER BY id DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/movements", err);
    res.status(500).json({ error: "Error al obtener movimientos" });
  }
});

// POST /api/movements
app.post("/api/movements", async (req, res) => {
  try {
    const { date, type, category, description, amount, status } = req.body;

    const result = await pool.query(
      `INSERT INTO movements (date, type, category, description, amount, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, date, type, category, description, amount, status`,
      [date, type, category, description || null, amount, status || "Registrado"]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/movements", err);
    res.status(500).json({ error: "Error al crear movimiento" });
  }
});

// PUT /api/movements/:id
app.put("/api/movements/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const { date, type, category, description, amount, status } = req.body;

    const result = await pool.query(
      `UPDATE movements
       SET date = $1,
           type = $2,
           category = $3,
           description = $4,
           amount = $5,
           status = $6,
           updated_at = now()
       WHERE id = $7
       RETURNING id, date, type, category, description, amount, status`,
      [date, type, category, description || null, amount, status, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Movimiento no encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/movements/:id", err);
    res.status(500).json({ error: "Error al actualizar movimiento" });
  }
});

// DELETE /api/movements/:id
app.delete("/api/movements/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);

    const result = await pool.query("DELETE FROM movements WHERE id = $1", [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Movimiento no encontrado" });

    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE /api/movements/:id", err);
    res.status(500).json({ error: "Error al eliminar movimiento" });
  }
});

// ==============================
// API: INVOICES
// ==============================

// GET /api/invoices
app.get("/api/invoices", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, number, party, date, due_date, amount, status
       FROM invoices
       ORDER BY id DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/invoices", err);
    res.status(500).json({ error: "Error al obtener facturas" });
  }
});

// GET /api/invoices/:id  (incluye items)
app.get("/api/invoices/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);

    const inv = await pool.query(
      `SELECT id, number, party, date, due_date, amount, status, notes
       FROM invoices
       WHERE id = $1`,
      [id]
    );

    if (inv.rows.length === 0) return res.status(404).json({ error: "Factura no encontrada" });

    const items = await pool.query(
      `SELECT id, invoice_id, description, quantity, unit_price, line_total
       FROM invoice_items
       WHERE invoice_id = $1
       ORDER BY id ASC`,
      [id]
    );

    res.json({ ...inv.rows[0], items: items.rows });
  } catch (err) {
    console.error("Error GET /api/invoices/:id", err);
    res.status(500).json({ error: "Error al obtener factura" });
  }
});

// POST /api/invoices
app.post("/api/invoices", async (req, res) => {
  try {
    const { number, party, date, due_date, amount, status, notes } = req.body;

    const result = await pool.query(
      `INSERT INTO invoices (number, party, date, due_date, amount, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, number, party, date, due_date, amount, status, notes`,
      [number, party, date, due_date || null, amount, status || "Pendiente", notes || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/invoices", err);
    res.status(500).json({ error: "Error al crear factura" });
  }
});

// PUT /api/invoices/:id
app.put("/api/invoices/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const { number, party, date, due_date, amount, status, notes } = req.body;

    const result = await pool.query(
      `UPDATE invoices
       SET number = $1,
           party = $2,
           date = $3,
           due_date = $4,
           amount = $5,
           status = $6,
           notes = $7,
           updated_at = now()
       WHERE id = $8
       RETURNING id, number, party, date, due_date, amount, status, notes`,
      [number, party, date, due_date || null, amount, status, notes || null, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Factura no encontrada" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/invoices/:id", err);
    res.status(500).json({ error: "Error al actualizar factura" });
  }
});

// DELETE /api/invoices/:id
app.delete("/api/invoices/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);

    const result = await pool.query("DELETE FROM invoices WHERE id = $1", [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Factura no encontrada" });

    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE /api/invoices/:id", err);
    res.status(500).json({ error: "Error al eliminar factura" });
  }
});

// ==============================
// API: INVOICE ITEMS (detalle)
// ==============================

// GET /api/invoices/:id/items
app.get("/api/invoices/:id/items", async (req, res) => {
  try {
    const invoiceId = toInt(req.params.id);

    const result = await pool.query(
      `SELECT id, invoice_id, description, quantity, unit_price, line_total
       FROM invoice_items
       WHERE invoice_id = $1
       ORDER BY id ASC`,
      [invoiceId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/invoices/:id/items", err);
    res.status(500).json({ error: "Error al obtener items" });
  }
});

// POST /api/invoices/:id/items
app.post("/api/invoices/:id/items", async (req, res) => {
  try {
    const invoiceId = toInt(req.params.id);
    const { description, quantity, unit_price } = req.body;

    const result = await pool.query(
      `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price)
       VALUES ($1, $2, $3, $4)
       RETURNING id, invoice_id, description, quantity, unit_price, line_total`,
      [invoiceId, description, quantity ?? 1, unit_price ?? 0]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/invoices/:id/items", err);
    res.status(500).json({ error: "Error al crear item" });
  }
});

// PUT /api/invoice-items/:itemId
app.put("/api/invoice-items/:itemId", async (req, res) => {
  try {
    const itemId = toInt(req.params.itemId);
    const { description, quantity, unit_price } = req.body;

    const result = await pool.query(
      `UPDATE invoice_items
       SET description = $1,
           quantity = $2,
           unit_price = $3
       WHERE id = $4
       RETURNING id, invoice_id, description, quantity, unit_price, line_total`,
      [description, quantity, unit_price, itemId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Item no encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/invoice-items/:itemId", err);
    res.status(500).json({ error: "Error al actualizar item" });
  }
});

// DELETE /api/invoice-items/:itemId
app.delete("/api/invoice-items/:itemId", async (req, res) => {
  try {
    const itemId = toInt(req.params.itemId);

    const result = await pool.query("DELETE FROM invoice_items WHERE id = $1", [itemId]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Item no encontrado" });

    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE /api/invoice-items/:itemId", err);
    res.status(500).json({ error: "Error al eliminar item" });
  }
});

// ==============================
// API: USERS
// ==============================

// GET /api/users
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, active, created_at
       FROM users
       ORDER BY id DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/users", err);
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

// POST /api/users
app.post("/api/users", async (req, res) => {
  try {
    const { name, email, role, active } = req.body;

    const result = await pool.query(
      `INSERT INTO users (name, email, role, active)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, active, created_at`,
      [name, email, role || "Productor", active ?? true]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/users", err);
    res.status(500).json({ error: "Error al crear usuario (¿correo repetido?)" });
  }
});

// PUT /api/users/:id
app.put("/api/users/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const { name, email, role, active } = req.body;

    const result = await pool.query(
      `UPDATE users
       SET name = $1,
           email = $2,
           role = $3,
           active = $4,
           updated_at = now()
       WHERE id = $5
       RETURNING id, name, email, role, active, created_at`,
      [name, email, role, active, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/users/:id", err);
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
});

// DELETE /api/users/:id
app.delete("/api/users/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);

    const result = await pool.query("DELETE FROM users WHERE id = $1", [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE /api/users/:id", err);
    res.status(500).json({ error: "Error al eliminar usuario" });
  }
});

// ==============================
// API: CATEGORIES (opcional pero útil)
// ==============================

// GET /api/categories
app.get("/api/categories", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, kind, active, created_at
       FROM categories
       ORDER BY kind ASC, name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/categories", err);
    res.status(500).json({ error: "Error al obtener categorías" });
  }
});

// POST /api/categories
app.post("/api/categories", async (req, res) => {
  try {
    const { name, kind, active } = req.body;

    const result = await pool.query(
      `INSERT INTO categories (name, kind, active)
       VALUES ($1, $2, $3)
       RETURNING id, name, kind, active, created_at`,
      [name, kind, active ?? true]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/categories", err);
    res.status(500).json({ error: "Error al crear categoría" });
  }
});

// PUT /api/categories/:id
app.put("/api/categories/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const { name, kind, active } = req.body;

    const result = await pool.query(
      `UPDATE categories
       SET name = $1,
           kind = $2,
           active = $3
       WHERE id = $4
       RETURNING id, name, kind, active, created_at`,
      [name, kind, active, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Categoría no encontrada" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/categories/:id", err);
    res.status(500).json({ error: "Error al actualizar categoría" });
  }
});

// DELETE /api/categories/:id
app.delete("/api/categories/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);

    const result = await pool.query("DELETE FROM categories WHERE id = $1", [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Categoría no encontrada" });

    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE /api/categories/:id", err);
    res.status(500).json({ error: "Error al eliminar categoría" });
  }
});

// ==============================
// SPA fallback (DESPUÉS de /api)
// ==============================
app.get("*", (req, res) => {
  const looksLikeFile = path.extname(req.path) !== "";
  if (looksLikeFile) return res.status(404).send("Not found");
  res.sendFile(path.join(__dirname, "index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});