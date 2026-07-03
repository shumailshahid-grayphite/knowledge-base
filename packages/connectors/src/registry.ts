import type { ConnectorType, SourceConnector } from '@kb/shared';
import { GoogleDriveConnector } from './google-drive.connector.js';
import { SharePointConnector } from './sharepoint.connector.js';

type Env = Record<string, string | undefined>;

/**
 * Build a connector for a type, configured from env client credentials.
 * The single place vendor connectors are instantiated — API and worker both use it.
 */
export function getConnector(type: ConnectorType, env: Env): SourceConnector {
  switch (type) {
    case 'gdrive':
      return new GoogleDriveConnector(req(env, 'GOOGLE_CLIENT_ID'), req(env, 'GOOGLE_CLIENT_SECRET'));
    case 'sharepoint':
      return new SharePointConnector(
        req(env, 'MS_CLIENT_ID'),
        req(env, 'MS_CLIENT_SECRET'),
        env.MS_TENANT ?? 'common',
      );
    default:
      throw new Error(`Connector type not supported yet: ${type}`);
  }
}

/** Connector types that currently have an implementation. */
export const IMPLEMENTED_CONNECTORS: ConnectorType[] = ['gdrive', 'sharepoint'];

function req(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing env ${key} (required for this connector)`);
  return v;
}
