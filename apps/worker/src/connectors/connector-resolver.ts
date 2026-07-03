import { getConnector } from '@kb/connectors';
import type { ConnectorType, SourceConnector } from '@kb/shared';

/** Resolver token — swappable in tests to inject a mock connector. */
export const CONNECTOR_RESOLVER = Symbol('CONNECTOR_RESOLVER');

export type ConnectorResolver = (type: ConnectorType) => SourceConnector;

/** Default resolver: build the real vendor connector from env credentials. */
export const defaultConnectorResolver: ConnectorResolver = (type) => getConnector(type, process.env);
