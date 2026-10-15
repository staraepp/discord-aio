'use client';

/** Browser API client: JSON + CSRF header; surfaces server validation issues. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: init.body !== undefined || (init.method && init.method !== 'GET') ? { 'Content-Type': 'application/json', 'X-AIO-CSRF': '1' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : init.method && init.method !== 'GET' ? '{}' : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; issues?: { path: string; message: string }[] };
    if (res.status === 401 && typeof window !== 'undefined') window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError(d.error ?? `Request failed (${res.status})`, res.status, d.issues ?? []);
  }
  return data as T;
}
