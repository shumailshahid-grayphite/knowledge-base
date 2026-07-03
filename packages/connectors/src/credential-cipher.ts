import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

/**
 * AES-256-GCM encryption for OAuth tokens at rest. Key comes from
 * CONNECTOR_ENCRYPTION_KEY (base64, 32 bytes). A real KMS/Vault can implement the
 * same encrypt/decrypt surface later without touching callers.
 */
export class CredentialCipher {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new Error('CONNECTOR_ENCRYPTION_KEY must decode to 32 bytes (base64 of 32 raw bytes)');
    }
    this.key = key;
  }

  static fromEnv(env: Record<string, string | undefined>): CredentialCipher {
    const raw = env.CONNECTOR_ENCRYPTION_KEY;
    if (!raw) {
      throw new Error('CONNECTOR_ENCRYPTION_KEY is not set (required for connectors)');
    }
    return new CredentialCipher(Buffer.from(raw, 'base64'));
  }

  encrypt(plaintext: string): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: enc.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(secret: EncryptedSecret): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(secret.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return dec.toString('utf8');
  }

  encryptJSON(obj: unknown): EncryptedSecret {
    return this.encrypt(JSON.stringify(obj));
  }

  decryptJSON<T>(secret: EncryptedSecret): T {
    return JSON.parse(this.decrypt(secret)) as T;
  }
}
