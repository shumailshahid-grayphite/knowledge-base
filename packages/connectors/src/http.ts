import { Readable } from 'node:stream';

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function fetchForm<T>(url: string, form: Record<string, string>): Promise<T> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
}

/** Fetch a URL and return the body as a Node Readable stream. */
export async function fetchStream(url: string, init?: RequestInit): Promise<Readable> {
  const res = await fetch(url, init);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} for ${url}: ${!res.body ? 'no body' : await res.text()}`);
  }
  // Web ReadableStream -> Node Readable.
  return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
}
