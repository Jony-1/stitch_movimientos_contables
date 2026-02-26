// js/state/movementsStore.js
// Capa de estado en memoria (cache del frontend).
// No toca DOM y no hace fetch. Solo gestiona la lista actual.

let _movements = [];

/**
 * Reemplaza completamente el estado (por ejemplo, después de listMovements()).
 * @param {Array} rows
 */
export function setMovements(rows) {
  _movements = Array.isArray(rows) ? [...rows] : [];
}

/**
 * Devuelve una copia del estado actual.
 */
export function getAllMovements() {
  return [..._movements];
}

/**
 * Obtiene un movimiento por ID.
 * @param {number|string} id
 */
export function getMovementById(id) {
  const numericId = Number(id);
  return _movements.find(m => Number(m.id) === numericId) || null;
}

/**
 * Agrega un movimiento al estado (por ejemplo, después de createMovement()).
 * @param {Object} row
 */
export function addMovementToStore(row) {
  if (!row) return;
  _movements = [row, ..._movements];
}

/**
 * Reemplaza un movimiento existente en el estado (por ejemplo, después de updateMovement()).
 * @param {Object} updatedRow
 */
export function updateMovementInStore(updatedRow) {
  if (!updatedRow || typeof updatedRow.id === "undefined") return;

  const numericId = Number(updatedRow.id);
  _movements = _movements.map(m =>
    Number(m.id) === numericId ? { ...updatedRow } : m
  );
}

/**
 * Elimina un movimiento del estado (por ejemplo, después de deleteMovement()).
 * @param {number|string} id
 */
export function removeMovementFromStore(id) {
  const numericId = Number(id);
  _movements = _movements.filter(m => Number(m.id) !== numericId);
}