// db.js
const { Pool } = require("pg");
const { URL } = require("url");

const connectionString = process.env.DATABASE_URL;
const sslMode = String(process.env.DATABASE_SSL || "").trim().toLowerCase();

function getDatabaseHostname() {
  try {
    return new URL(String(connectionString || "")).hostname || "";
  } catch (_) {
    return "";
  }
}

function shouldDefaultToSsl() {
  const hostname = getDatabaseHostname().toLowerCase();
  if (!hostname) return false;
  if (["localhost", "127.0.0.1", "postgres", "db"].includes(hostname)) return false;
  if (hostname.endsWith(".internal")) return false;
  return true;
}

function resolveSslConfig() {
  if (["false", "0", "no", "off", "disable", "disabled"].includes(sslMode)) {
    return false;
  }

  if (["true", "1", "yes", "on", "require", "enabled"].includes(sslMode)) {
    return { rejectUnauthorized: false };
  }

  if (String(connectionString || "").includes("sslmode=disable")) {
    return false;
  }

  if (!shouldDefaultToSsl()) {
    return false;
  }

  return { rejectUnauthorized: false };
}

function createPool(ssl) {
  return new Pool({
    connectionString,
    ssl,
  });
}

function shouldRetryWithoutSsl(error, ssl) {
  return ssl !== false && /does not support ssl connections/i.test(String(error?.message || ""));
}

let currentSsl = resolveSslConfig();
let pool = createPool(currentSsl);

async function rebuildPoolWithoutSsl() {
  currentSsl = false;
  try {
    await pool.end();
  } catch (_) {}
  pool = createPool(false);
}

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (error) {
    if (!shouldRetryWithoutSsl(error, currentSsl)) {
      throw error;
    }

    await rebuildPoolWithoutSsl();
    return pool.query(text, params);
  }
}

async function connect() {
  try {
    return await pool.connect();
  } catch (error) {
    if (!shouldRetryWithoutSsl(error, currentSsl)) {
      throw error;
    }

    await rebuildPoolWithoutSsl();
    return pool.connect();
  }
}

module.exports = { query, connect, end: () => pool.end() };
