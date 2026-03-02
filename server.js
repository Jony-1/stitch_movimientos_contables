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
app.use(express.urlencoded({ extended: true })); // <-- para POST del login form

// ===== View engine (EJS) =====
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ===== Static files =====
// IMPORTANTE:
// - Tú tienes /assets (css)
// - Tú tienes /js (tu app.js modular) FUERA de assets
// - Opcional: /public si lo usas
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use("/js", express.static(path.join(__dirname, "js")));
app.use("/public", express.static(path.join(__dirname, "public")));

// =======================
// ROUTES (Vistas)
// =======================

app.get("/", (req, res) => {
  res.render("login", { title: "Login", active: "login" });
});

// Login dummy (por ahora): luego lo conectamos con users/auth real
app.post("/login", (req, res) => {
  // const { email, password } = req.body;
  // TODO: validar en DB y crear sesión/cookie
  return res.redirect("/dashboard");
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

app.get("/reportes", (req, res) => {
  res.render("reportes", { title: "Reportes", active: "reportes" });
});

app.get("/configuraciones", (req, res) => {
  res.render("configuraciones", { title: "Configuración", active: "config" });
});

app.get("/usuarios", (req, res) => {
  res.render("usuarios", { title: "Usuarios", active: "usuarios" });
});

// =======================
// API MOVEMENTS
// =======================
app.get("/api/movements", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, date, type, category, description, amount, status FROM movements ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/movements", err);
    res.status(500).json({ error: "Error al obtener movimientos" });
  }
});

app.post("/api/movements", async (req, res) => {
  try {
    const { date, type, category, description, amount, status } = req.body;

    const result = await pool.query(
      `INSERT INTO movements (date, type, category, description, amount, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, date, type, category, description, amount, status`,
      [date, type, category, description, amount, status || "Registrado"]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/movements", err);
    res.status(500).json({ error: "Error al crear movimiento" });
  }
});

app.put("/api/movements/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { date, type, category, description, amount, status } = req.body;

    const result = await pool.query(
      `UPDATE movements
       SET date = $1, type = $2, category = $3, description = $4, amount = $5, status = $6
       WHERE id = $7
       RETURNING id, date, type, category, description, amount, status`,
      [date, type, category, description, amount, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Movimiento no encontrado" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/movements/:id", err);
    res.status(500).json({ error: "Error al actualizar movimiento" });
  }
});

app.delete("/api/movements/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const result = await pool.query("DELETE FROM movements WHERE id = $1", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Movimiento no encontrado" });
    }

    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE /api/movements/:id", err);
    res.status(500).json({ error: "Error al eliminar movimiento" });
  }
});

// =======================
// API INVOICES (si ya las tienes)
// =======================
app.get("/api/invoices", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, number, party, date, amount, status FROM invoices ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/invoices", err);
    res.status(500).json({ error: "Error al obtener facturas" });
  }
});

app.post("/api/invoices", async (req, res) => {
  try {
    const { number, party, date, amount, status } = req.body;

    const result = await pool.query(
      `INSERT INTO invoices (number, party, date, amount, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, number, party, date, amount, status`,
      [number, party, date, amount, status]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/invoices", err);
    res.status(500).json({ error: "Error al crear factura" });
  }
});

app.put("/api/invoices/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { number, party, date, amount, status } = req.body;

    const result = await pool.query(
      `UPDATE invoices
       SET number = $1, party = $2, date = $3, amount = $4, status = $5
       WHERE id = $6
       RETURNING id, number, party, date, amount, status`,
      [number, party, date, amount, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Factura no encontrada" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/invoices/:id", err);
    res.status(500).json({ error: "Error al actualizar factura" });
  }
});

app.delete("/api/invoices/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const result = await pool.query("DELETE FROM invoices WHERE id = $1", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Factura no encontrada" });
    }

    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE /api/invoices/:id", err);
    res.status(500).json({ error: "Error al eliminar factura" });
  }
});

// =======================
// Fallback (opcional)
// =======================
app.get("*", (req, res) => {
  const looksLikeFile = path.extname(req.path) !== "";
  if (looksLikeFile) return res.status(404).send("Not found");
  return res.redirect("/");
});

// Arrancar servidor
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});