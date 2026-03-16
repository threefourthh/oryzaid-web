// js/core/api.js
const DEFAULT_API = "https://oryzaid-api.onrender.com";

let API_BASE =
  (typeof window !== "undefined" && window.MAIZEEYE_API_BASE) || DEFAULT_API;

/**
 * Allows app.js to set API base, but still respects window.MAIZEEYE_API_BASE if present.
 */
export function setApiBaseFromWindowOrDefault(fallback = DEFAULT_API) {
  API_BASE =
    (typeof window !== "undefined" && window.MAIZEEYE_API_BASE) || fallback;
  return API_BASE;
}

export function getApiBase() {
  return API_BASE;
}

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
  }

  return data;
}

export const apiGet = (path) => request(path);
export const apiPost = (path, body) => request(path, { method: "POST", body });