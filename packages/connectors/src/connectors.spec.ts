import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialCipher } from './credential-cipher.js';
import { signState, verifyState } from './oauth-state.js';

describe('CredentialCipher', () => {
  const cipher = new CredentialCipher(randomBytes(32));

  it('round-trips JSON tokens', () => {
    const secret = { accessToken: 'abc', refreshToken: 'xyz', expiresAt: '2030-01-01' };
    const enc = cipher.encryptJSON(secret);
    expect(enc.ciphertext).not.toContain('abc');
    expect(cipher.decryptJSON(enc)).toEqual(secret);
  });

  it('rejects a tampered auth tag', () => {
    const enc = cipher.encrypt('hello');
    const bad = { ...enc, authTag: Buffer.from(randomBytes(16)).toString('base64') };
    expect(() => cipher.decrypt(bad)).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(() => new CredentialCipher(randomBytes(16))).toThrow();
  });
});

describe('oauth-state', () => {
  const secret = 'state-secret';

  it('signs and verifies a payload', () => {
    const now = 1_700_000_000;
    const token = signState(secret, { orgId: 'o', userId: 'u', type: 'gdrive', spaceId: 's' }, now);
    const payload = verifyState(secret, token, now + 10);
    expect(payload.orgId).toBe('o');
    expect(payload.type).toBe('gdrive');
  });

  it('rejects a bad signature', () => {
    const now = 1_700_000_000;
    const token = signState(secret, { orgId: 'o', userId: 'u', type: 'gdrive' }, now);
    expect(() => verifyState('wrong-secret', token, now)).toThrow();
  });

  it('rejects an expired state', () => {
    const now = 1_700_000_000;
    const token = signState(secret, { orgId: 'o', userId: 'u', type: 'gdrive' }, now);
    expect(() => verifyState(secret, token, now + 10_000)).toThrow(/expired/);
  });
});
