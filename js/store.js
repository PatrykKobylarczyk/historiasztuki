// Bezpieczny dostęp do localStorage (prywatne okna / zablokowane dane nie psują aplikacji).
const PREFIX = "hk:";
const mem = {};

export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? (key in mem ? mem[key] : fallback) : JSON.parse(v);
    } catch {
      return key in mem ? mem[key] : fallback;
    }
  },
  set(key, value) {
    mem[key] = value;
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* brak miejsca lub blokada */ }
  },
};
