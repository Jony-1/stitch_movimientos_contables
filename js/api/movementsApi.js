// js/api/movementsApi.js
"use strict";



async function jsonOrThrow(r) {
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}
  if (!r.ok) {
    const msg = (data && (data.error || data.message)) || text || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function getMovements() {
  const r = await fetch("/api/movements");
  return await jsonOrThrow(r);
}

export async function createMovement(payload) {
  const r = await fetch("/api/movements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await jsonOrThrow(r);
}

export async function updateMovement(id, payload) {
  const r = await fetch(`/api/movements/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await jsonOrThrow(r);
}

export async function deleteMovement(id) {
  const r = await fetch(`/api/movements/${id}`, { method: "DELETE" });
  if (r.status === 204) return true;
  await jsonOrThrow(r);
  return true;
}

// Aliases por si en tu page usaste otros nombres
export { getMovements as listMovements };
export { deleteMovement as deleteMovementApi };
export { createMovement as createMovementApi };
export { updateMovement as updateMovementApi };