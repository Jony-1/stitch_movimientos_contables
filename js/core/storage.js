export const DB_KEY = "stitch_db";

export function dbRead() {
  try {
    return JSON.parse(localStorage.getItem(DB_KEY) || "{}");
  } catch (e) {
    return {};
  }
}

export function dbWrite(obj) {
  localStorage.setItem(DB_KEY, JSON.stringify(obj));
}