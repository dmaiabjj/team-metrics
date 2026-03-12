const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const API_KEY = import.meta.env.VITE_API_KEY || '';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Build a URL with properly encoded query parameters.
 * Avoids manual template-literal URL construction and ensures
 * special characters are encoded correctly.
 *
 * @param {string} path - API path (e.g. "/teams/my-team/kpis")
 * @param {Record<string, string|number|null|undefined>} params - Query params
 * @returns {string} Full URL string
 */
export function buildUrl(path, params = {}) {
  const url = `${BASE_URL}${path}`;
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * Core API fetch wrapper.
 *
 * @param {string} path - Full URL or path (if path, prepends BASE_URL)
 * @param {RequestInit & { signal?: AbortSignal }} options - Fetch options
 * @returns {Promise<any>} Parsed JSON response
 */
export async function api(path, options = {}) {
  // If path already starts with BASE_URL or is a full URL, use as-is
  const url = path.startsWith('http') || path.startsWith(BASE_URL) ? path : `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    ...options.headers,
  };

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    let body;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new ApiError(
      body?.detail || body?.message || `API error ${res.status}`,
      res.status,
      body,
    );
  }

  return res.json();
}
