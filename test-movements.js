#!/usr/bin/env node

const http = require("http");

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin123";
const PORT = Number(process.env.PORT || 3000);

function requestJSON({ method, path, cookie, csrfToken, payload }) {
  return new Promise((resolve) => {
    const body = payload ? JSON.stringify(payload) : "";
    const options = {
      hostname: "localhost",
      port: PORT,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    if (cookie) options.headers.Cookie = cookie;
    if (csrfToken) options.headers["X-CSRF-Token"] = csrfToken;

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = data ? JSON.parse(data) : null;
        } catch (_) {}
        resolve({ statusCode: res.statusCode, data: parsed, raw: data, headers: res.headers });
      });
    });

    req.on("error", (error) => resolve({ error }));
    if (body) req.write(body);
    req.end();
  });
}

function getCookieHeader(setCookie = []) {
  return setCookie.map((item) => item.split(";")[0]).join("; ");
}

async function login() {
  const response = await requestJSON({
    method: "POST",
    path: "/api/login",
    payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });

  if (response.statusCode !== 200) {
    throw new Error(response.data?.error || "No se pudo iniciar sesión");
  }

  const cookie = getCookieHeader(response.headers["set-cookie"] || []);
  const csrf = await requestJSON({ method: "GET", path: "/api/csrf", cookie });
  return { cookie, csrfToken: csrf.data?.csrfToken || "" };
}

async function runTests() {
  console.log("Testing Movements API Endpoints");
  console.log("==============================");

  const { cookie, csrfToken } = await login();

  console.log("\n=== Test: Get Movements ===");
  const listRes = await requestJSON({ method: "GET", path: "/api/movements", cookie });
  if (listRes.statusCode === 200 && Array.isArray(listRes.data)) {
    console.log(`✓ GET /api/movements works - ${listRes.data.length} row(s)`);
  } else {
    console.log(`✗ GET /api/movements returned ${listRes.statusCode}`);
  }

  console.log("\n=== Test: Create Movement ===");
  const createRes = await requestJSON({
    method: "POST",
    path: "/api/movements",
    cookie,
    csrfToken,
    payload: {
      type: "ingreso",
      date: new Date().toISOString(),
      amount: 50000,
      description: "Test income",
      category: "Sales",
    },
  });

  if (createRes.statusCode === 201 && createRes.data?.id) {
    console.log("✓ POST /api/movements works - movement created");
    console.log(`Created movement ID: ${createRes.data.id}`);

    const deleteRes = await requestJSON({
      method: "DELETE",
      path: `/api/movements/${createRes.data.id}`,
      cookie,
      csrfToken,
    });

    if (deleteRes.statusCode === 204) {
      console.log("✓ DELETE /api/movements works - cleanup done");
    } else {
      console.log(`✗ DELETE /api/movements returned ${deleteRes.statusCode}`);
    }
  } else {
    console.log(`✗ POST /api/movements returned ${createRes.statusCode}`);
  }

  console.log("\n=== All Tests Completed ===\n");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
