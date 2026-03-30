#!/usr/bin/env node

const http = require("http");
const PORT = Number(process.env.PORT || 3000);

function requestJson(path, { method = "GET", body = null, cookie = "", csrfToken = "" } = {}) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : "";
    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    };

    if (cookie) headers.Cookie = cookie;
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path,
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (_) {}

          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
            text: data,
          });
        });
      }
    );

    req.on("error", (error) => resolve({ statusCode: 0, error }));
    if (payload) req.write(payload);
    req.end();
  });
}

function getCookie(headers) {
  const setCookie = headers["set-cookie"] || [];
  return Array.isArray(setCookie) ? setCookie.map((entry) => entry.split(";")[0]).join("; ") : "";
}

async function login() {
  const response = await requestJson("/api/login", {
    method: "POST",
    body: { email: "admin@example.com", password: "admin123" },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Login failed: ${response.statusCode} ${response.text}`);
  }

  return getCookie(response.headers);
}

async function getCsrf(cookie) {
  const response = await requestJson("/api/csrf", { cookie });
  if (response.statusCode !== 200 || !response.body?.csrfToken) {
    throw new Error(`CSRF fetch failed: ${response.statusCode} ${response.text}`);
  }
  return response.body.csrfToken;
}

async function testInvoicesAPI(cookie) {
  console.log("\n=== Test: Get Invoices ===");
  const response = await requestJson("/api/invoices", { cookie });
  console.log(`Status: ${response.statusCode}`);
  console.log(`Content: ${JSON.stringify(response.body, null, 2)}`);
  if (response.statusCode === 200 && Array.isArray(response.body)) {
    console.log("✓ GET /api/invoices works - returns array");
  } else {
    console.log(`✗ GET /api/invoices returned ${response.statusCode}`);
  }
}

async function testCreateInvoice(cookie, csrfToken) {
  console.log("\n=== Test: Create Invoice ===");
  const payload = {
    number: "INV-2026-001",
    party: "Test Supplier",
    date: "2026-03-27T00:00:00.000Z",
    dueDate: "2026-04-27T00:00:00.000Z",
    status: "Pendiente",
    items: [
      { description: "Papa pastusa", quantity: 12, unitPrice: 45000 },
      { description: "Transporte", quantity: 1, unitPrice: 50000 },
    ],
    amount: 590000,
  };

  const response = await requestJson("/api/invoices", {
    method: "POST",
    body: payload,
    cookie,
    csrfToken,
  });

  console.log(`Status: ${response.statusCode}`);
  console.log(`Created Invoice: ${JSON.stringify(response.body, null, 2)}`);
  if (response.statusCode === 201 && response.body?.items?.length === 2) {
    console.log("✓ POST /api/invoices works - invoice with items created");
  } else {
    console.log(`✗ POST /api/invoices returned ${response.statusCode}`);
  }

  return response.body;
}

async function testPayInvoice(cookie, csrfToken, invoice) {
  if (!invoice?.id) return;

  console.log("\n=== Test: Pay Invoice ===");
  const response = await requestJson(`/api/invoices/${invoice.id}/pay`, {
    method: "POST",
    body: { note: `Pago factura ${invoice.number}` },
    cookie,
    csrfToken,
  });

  console.log(`Status: ${response.statusCode}`);
  console.log(`Paid Invoice: ${JSON.stringify(response.body, null, 2)}`);
  if (response.statusCode === 200 && String(response.body?.status || "").toLowerCase() === "pagada") {
    console.log("✓ POST /api/invoices/:id/pay works - payment registered");
  } else {
    console.log(`✗ POST /api/invoices/:id/pay returned ${response.statusCode}`);
  }
}

async function runTests() {
  console.log("Testing Invoices API Endpoints");
  console.log("==============================");
  const cookie = await login();
  const csrfToken = await getCsrf(cookie);
  await testInvoicesAPI(cookie);
  const createdInvoice = await testCreateInvoice(cookie, csrfToken);
  await testPayInvoice(cookie, csrfToken, createdInvoice);
  console.log("\n=== All Tests Completed ===\n");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
