// db.js
const { Pool } = require("pg");
const { URL } = require("url");

const connectionString = process.env.DATABASE_URL;
const sslMode = String(process.env.DATABASE_SSL || "").trim().toLowerCase();

function buildConnectionString(ssl) {
  if (!connectionString || ssl !== false) {
    return connectionString;
  }

  try {
    const parsed = new URL(connectionString);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("ssl");
    parsed.searchParams.delete("sslcert");
    parsed.searchParams.delete("sslkey");
    parsed.searchParams.delete("sslrootcert");
    return parsed.toString();
  } catch (_) {
    return connectionString
      .replace(/([?&])sslmode=[^&]*&?/i, "$1")
      .replace(/([?&])ssl=[^&]*&?/i, "$1")
      .replace(/([?&])sslcert=[^&]*&?/i, "$1")
      .replace(/([?&])sslkey=[^&]*&?/i, "$1")
      .replace(/([?&])sslrootcert=[^&]*&?/i, "$1")
      .replace(/[?&]$/, "");
  }
}

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
    connectionString: buildConnectionString(ssl),
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

async function withSslFallback(executor) {
  try {
    return await executor(pool);
  } catch (error) {
    if (!shouldRetryWithoutSsl(error, currentSsl)) {
      throw error;
    }

    await rebuildPoolWithoutSsl();
    return executor(pool);
  }
}

async function query(text, params) {
  return withSslFallback((activePool) => activePool.query(text, params));
}

async function connect() {
  return withSslFallback((activePool) => activePool.connect());
}

module.exports = { query, connect, end: () => pool.end() };
