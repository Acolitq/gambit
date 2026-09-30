// Small JSON API helper. Sends and receives JSON, includes the session cookie,
// and throws on non-2xx so callers can show the server's message. Thrown errors
// carry `status` (HTTP status, 0 if the request never got a response) and
// `code` (the server's machine-readable code, 'network', or null).
export class ApiError extends Error {
  constructor(message, { status = 0, code = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError("Can't reach the server.", { code: 'network' });
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    throw new ApiError(data.error || `Error ${res.status}`, { status: res.status, code: data.code || null });
  }
  return data;
}
