const http = require("http");

// Test login endpoint
const postData = JSON.stringify({
  email: "admin@example.com",
  password: "admin123",
});

const options = {
  hostname: "localhost",
  port: 3000,
  path: "/login",
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "Content-Length": Buffer.byteLength(
      `email=${encodeURIComponent("admin@example.com")}&password=${encodeURIComponent("admin123")}`
    ),
  },
};

const body = `email=${encodeURIComponent("admin@example.com")}&password=${encodeURIComponent(
  "admin123"
)}`;

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Location: ${res.headers.location}`);
  if (res.statusCode === 302) {
    console.log("✓ Login exitoso - redirige a /dashboard");
  } else {
    console.log("✗ Login falló");
  }
});

req.on("error", (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(body);
req.end();
