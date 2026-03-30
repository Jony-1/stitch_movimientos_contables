// db.js
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
const sslMode = String(process.env.DATABASE_SSL || "").trim().toLowerCase();

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

  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString,
  ssl: resolveSslConfig(),
});

module.exports = pool;
