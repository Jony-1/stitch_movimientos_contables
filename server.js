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

// Servir archivos estáticos (tu frontend actual)
app.use(express.static(__dirname)); // sirve index.html, assets/, js/, partials/, etc.

// ---------- API MOVEMENTS ----------

// GET /api/movements - lista todos los movimientos
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

// POST /api/movements - crea un movimiento
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

// PUT /api/movements/:id - actualiza un movimiento
app.put("/api/movements/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { date, type, category, description, amount, status } = req.body;

    const result = await pool.query(
      `UPDATE movements
       SET date = $1,
           type = $2,
           category = $3,
           description = $4,
           amount = $5,
           status = $6
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

// DELETE /api/movements/:id - elimina un movimiento
app.delete("/api/movements/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const result = await pool.query("DELETE FROM movements WHERE id = $1", [
      id
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Movimiento no encontrado" });
    }

    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE /api/movements/:id", err);
    res.status(500).json({ error: "Error al eliminar movimiento" });
  }
});

// ---------- API INVOICES ----------

// GET /api/invoices
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

// POST /api/invoices
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

// PUT /api/invoices/:id
app.put("/api/invoices/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { number, party, date, amount, status } = req.body;

    const result = await pool.query(
      `UPDATE invoices
       SET number = $1,
           party = $2,
           date = $3,
           amount = $4,
           status = $5
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

// DELETE /api/invoices/:id
app.delete("/api/invoices/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const result = await pool.query("DELETE FROM invoices WHERE id = $1", [
      id
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Factura no encontrada" });
    }

    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE /api/invoices/:id", err);
    res.status(500).json({ error: "Error al eliminar factura" });
  }
});

// Fallback: cualquier ruta que no empiece por /api devuelve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Arrancar servidor
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
