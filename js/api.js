export async function api(url, options = {}) {
  const headers = { ...options.headers };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, credentials: "same-origin", headers });

  if (!res.ok) {
    let message;
    try { message = (await res.json()).error; } catch { message = res.statusText; }
    throw new Error(message || res.statusText);
  }

  return res.json();
}
