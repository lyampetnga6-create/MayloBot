/** Petit client HTTP : JSON + en-tête anti-CSRF exigé par le serveur. */
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* corps vide */ }
  if (!res.ok) {
    const e = new Error(data?.error || `Erreur ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  put: (url, body) => request('PUT', url, body),
  post: (url, body = {}) => request('POST', url, body),
  del: (url, body) => request('DELETE', url, body),
};
