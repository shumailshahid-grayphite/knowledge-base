import { createHmac, timingSafeEqual } from 'node:crypto';

export interface OAuthStatePayload {
  orgId: string;
  userId: string;
  type: string;
  spaceId?: string;
  name?: string;
  /** issued-at epoch seconds */
  iat: number;
}

const TTL_SECONDS = 600;

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(secret: string, data: string): string {
  return b64url(createHmac('sha256', secret).update(data).digest());
}

/** Stateless, HMAC-signed OAuth state — no DB/Redis needed for the round-trip. */
export function signState(secret: string, payload: Omit<OAuthStatePayload, 'iat'>, nowSeconds: number): string {
  const full: OAuthStatePayload = { ...payload, iat: nowSeconds };
  const data = b64url(Buffer.from(JSON.stringify(full), 'utf8'));
  return `${data}.${sign(secret, data)}`;
}

export function verifyState(secret: string, token: string, nowSeconds: number): OAuthStatePayload {
  const [data, sig] = token.split('.');
  if (!data || !sig) throw new Error('Malformed OAuth state');
  const expected = sign(secret, data);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid OAuth state signature');
  }
  const payload = JSON.parse(Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as OAuthStatePayload;
  if (nowSeconds - payload.iat > TTL_SECONDS) {
    throw new Error('OAuth state expired');
  }
  return payload;
}
