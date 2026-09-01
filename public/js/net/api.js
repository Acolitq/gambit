// Small JSON API helper. Sends and receives JSON, includes the session cookie,
// and throws Error(message) on non-2xx so callers can show the server's message.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
