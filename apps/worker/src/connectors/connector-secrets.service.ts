import { Injectable } from '@nestjs/common';
import { CredentialCipher } from '@kb/connectors';
import type { ConnectorCredentials } from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';

/** Worker-side read/refresh of encrypted connector credentials. */
@Injectable()
export class ConnectorSecretsService {
  private _cipher?: CredentialCipher;

  constructor(private readonly database: DatabaseService) {}

  private get cipher(): CredentialCipher {
    if (!this._cipher) this._cipher = CredentialCipher.fromEnv(process.env);
    return this._cipher;
  }

  async get(connectorId: string): Promise<ConnectorCredentials> {
    const row = await this.database.db
      .selectFrom('connector_secrets')
      .select(['ciphertext', 'iv', 'auth_tag'])
      .where('connector_id', '=', connectorId)
      .executeTakeFirst();
    if (!row) throw new Error(`No stored credentials for connector ${connectorId}`);
    return this.cipher.decryptJSON<ConnectorCredentials>({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
    });
  }

  async store(connectorId: string, organizationId: string, credentials: ConnectorCredentials): Promise<void> {
    const enc = this.cipher.encryptJSON(credentials);
    await this.database.db
      .insertInto('connector_secrets')
      .values({
        connector_id: connectorId,
        organization_id: organizationId,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        auth_tag: enc.authTag,
      })
      .onConflict((oc) =>
        oc.column('connector_id').doUpdateSet({ ciphertext: enc.ciphertext, iv: enc.iv, auth_tag: enc.authTag }),
      )
      .execute();
  }
}
