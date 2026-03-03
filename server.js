"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // <-- para POST del login form

// sesión en memoria (no recomendable para producción)
app.use(
  session({
    secret: process.env.SESSION_SECRET || "keyboard cat",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 }, // 1h
  })
);

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
  res.render("login", { title: "Login", active: "login", error: null });
});

// middleware para rutas privadas
function ensureAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.redirect("/");
}

// Login real contra tabla users
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).render("login", { title: "Login", active: "login", error: "Email y contraseña obligatorios" });
  }
  try {
    const result = await pool.query(
      "SELECT id, email, password, role, active FROM users WHERE email = $1",
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).render("login", { title: "Login", active: "login", error: "Credenciales inválidas" });
    }
    const user = result.rows[0];
    if (!user.active) {
      return res.status(403).render("login", { title: "Login", active: "login", error: "Usuario inactivo" });
    }
    if (!user.password) {
      // usuario sin contraseña en base => denegamos (registro antiguo)
      return res.status(401).render("login", { title: "Login", active: "login", error: "Credenciales inválidas" });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).render("login", { title: "Login", active: "login", error: "Credenciales inválidas" });
    }
    // guardamos datos basicos en la sesión
    req.session.user = { id: user.id, email: user.email, role: user.role };
    return res.redirect("/dashboard");
  } catch (err) {
    console.error("Error POST /login", err);
    res.status(500).send("Error interno");
  }
});

// ruta de cierre de sesión
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/dashboard", ensureAuth, (req, res) => {
  res.render("dashboard", { title: "Dashboard", active: "dashboard" });
});

app.get("/movimientos", ensureAuth, (req, res) => {
  res.render("movimientos", { title: "Movimientos", active: "movimientos" });
});

app.get("/facturas", ensureAuth, (req, res) => {
  res.render("facturas", { title: "Facturas", active: "facturas" });
});

app.get("/reportes", ensureAuth, (req, res) => {
  res.render("reportes", { title: "Reportes", active: "reportes" });
});

app.get("/configuraciones", ensureAuth, (req, res) => {
  res.render("configuraciones", { title: "Configuración", active: "config" });
});

app.get("/usuarios", ensureAuth, (req, res) => {
  res.render("usuarios", { title: "Usuarios", active: "usuarios" });
});

// =======================
// API USERS (login / CRUD)
// =======================

// helpers: only admin may create/update/delete others
function checkAdmin(req, res) {
  if (!req.session.user || req.session.user.role !== "admin") {
    res.status(403).json({ error: "Permiso denegado" });
    return false;
  }
  return true;
}

// información del usuario autenticado
app.get("/api/me", (req, res) => {
  if (req.session && req.session.user) {
    return res.json(req.session.user);
  }
  res.status(401).json({ error: "no autenticado" });
});

app.get("/api/users", ensureAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, email, role, active, created_at FROM users ORDER BY id"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/users", err);
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

app.post("/api/users", ensureAuth, async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { email, password, role, active } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email y contraseña obligatorios" });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password, role, active)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, role, active, created_at`,
      [email, hash, role || "user", active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/users", err);
    res.status(500).json({ error: "Error al crear usuario" });
  }
});

app.put("/api/users/:id", ensureAuth, async (req, res) => {
  const uid = parseInt(req.params.id, 10);
  if (req.session.user.role !== "admin" && req.session.user.id !== uid) {
    return res.status(403).json({ error: "Permiso denegado" });
  }
  const { email, password, role, active } = req.body;
  try {
    const fields = [];
    const values = [];
    let idx = 1;
    if (email) {
      fields.push(`email = $${idx++}`);
      values.push(email);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      fields.push(`password = $${idx++}`);
      values.push(hash);
    }
    if (role) {
      fields.push(`role = $${idx++}`);
      values.push(role);
    }
    if (typeof active !== "undefined") {
      fields.push(`active = $${idx++}`);
      values.push(active);
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: "No hay cambios" });
    }
    values.push(uid);
    const query = `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx} RETURNING id, email, role, active, created_at`;
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/users/:id", err);
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
});

app.delete("/api/users/:id", ensureAuth, async (req, res) => {
  const uid = parseInt(req.params.id, 10);
  if (req.session.user.role !== "admin" && req.session.user.id !== uid) {
    return res.status(403).json({ error: "Permiso denegado" });
  }
  try {
    const result = await pool.query("DELETE FROM users WHERE id = $1", [uid]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE /api/users/:id", err);
    res.status(500).json({ error: "Error al eliminar usuario" });
  }
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

// inicialización de base de datos (usuarios y admin por defecto)
async function initDb() {
  try {
    // aseguramos tabla y columnas necesarias
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'user',
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);

    // columnas opcionales que pueden faltar en esquemas anteriores
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`);

    const adminEmail = "admin@example.com";
    const adminPw = "admin123"; // contraseña sencilla
    const hashed = await bcrypt.hash(adminPw, 10);
    try {
      await pool.query(
        `INSERT INTO users (email, password, role, name)
         SELECT $1, $2, 'Admin', 'Administrador'
         WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = $1)`,
        [adminEmail, hashed]
      );
      console.log(`admin user seeded: ${adminEmail} / ${adminPw}`);
    } catch (innerErr) {
      // ignore enum errors or others during seeding
      console.warn("No se pudo insertar usuario admin automáticamente:", innerErr.message);
    }
  } catch (err) {
    console.error("Error inicializando base de datos:", err);
  }
}

initDb();

// Arrancar servidor
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});