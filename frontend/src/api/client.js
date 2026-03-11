const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const API_KEY = import.meta.env.VITE_API_KEY || '';

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export async function api(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    ...options.headers,
  };

  const res = await fetch(url, { headers, ...options });

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
      body
    );
  }

  return res.json();
}
