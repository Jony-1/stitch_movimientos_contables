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
  console.log("Testing Edit Operations");
  console.log("======================");

  const { cookie, csrfToken } = await login();

  const createRes = await requestJSON({
    method: "POST",
    path: "/api/movements",
    cookie,
    csrfToken,
    payload: {
      type: "gasto",
      date: new Date().toISOString(),
      amount: 1000,
      description: "Movimiento temporal",
      category: "Pruebas",
    },
  });

  if (createRes.statusCode !== 201 || !createRes.data?.id) {
    console.log(`✗ No se pudo crear el movimiento de prueba (${createRes.statusCode})`);
    return;
  }

  const movementId = createRes.data.id;
  console.log(`Movement created: ${movementId}`);

  const editRes = await requestJSON({
    method: "PUT",
    path: `/api/movements/${movementId}`,
    cookie,
    csrfToken,
    payload: {
      type: "gasto",
      date: new Date().toISOString(),
      amount: 1500,
      description: "Movimiento actualizado",
      category: "Pruebas",
    },
  });

  if (editRes.statusCode === 200) {
    console.log(`✓ PUT /api/movements/${movementId} works`);
  } else {
    console.log(`✗ PUT /api/movements/${movementId} returned ${editRes.statusCode}`);
  }

  const getRes = await requestJSON({ method: "GET", path: `/api/movements/${movementId}`, cookie });
  if (getRes.statusCode === 200 && getRes.data?.description === "Movimiento actualizado") {
    console.log(`✓ GET /api/movements/${movementId} reflects the update`);
  } else {
    console.log(`✗ GET /api/movements/${movementId} did not return the expected data`);
  }

  const deleteRes = await requestJSON({
    method: "DELETE",
    path: `/api/movements/${movementId}`,
    cookie,
    csrfToken,
  });

  if (deleteRes.statusCode === 204) {
    console.log(`✓ DELETE /api/movements/${movementId} works`);
  } else {
    console.log(`✗ DELETE /api/movements/${movementId} returned ${deleteRes.statusCode}`);
  }

  console.log("\n=== All Tests Completed ===\n");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
