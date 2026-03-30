function resolveApiBase() {
  const envBase = window.PUBLIC_API_BASE_URL;
  if (envBase) return envBase;

  const { protocol, hostname, port, origin } = window.location;
  if (port === "3001" || port === "4321") {
    return `${protocol}//${hostname}:3000`;
  }

  return origin;
}

const API_BASE = resolveApiBase();
let csrfTokenPromise = null;

async function readJson(response) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {}

  if (!response.ok) {
    const message = (data && (data.error || data.message)) || text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

async function apiFetch(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  const csrfRetry = options._csrfRetry === true;

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfToken = await getCsrfToken();
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });

  if (!csrfRetry && ["POST", "PUT", "PATCH", "DELETE"].includes(method) && response.status === 403) {
    const text = await response.clone().text();
    if (text.includes("Token CSRF inválido")) {
      resetCsrfTokenCache();
      const freshToken = await getCsrfToken();
      if (freshToken) {
        headers.set("X-CSRF-Token", freshToken);
        return fetch(`${API_BASE}${path}`, {
          ...options,
          _csrfRetry: true,
          credentials: "include",
          headers,
        });
      }
    }
  }

  return response;
}

async function getCsrfToken() {
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch(`${API_BASE}/api/csrf`, { credentials: "include" })
      .then(async (response) => {
        const data = await readJson(response);
        return data?.csrfToken || "";
      })
      .catch(() => "");
  }

  return csrfTokenPromise;
}

function resetCsrfTokenCache() {
  csrfTokenPromise = null;
}

async function apiJson(path, options = {}) {
  return readJson(await apiFetch(path, options));
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export { API_BASE, apiFetch, apiJson, formatDate, formatMoney, readJson, resetCsrfTokenCache };
