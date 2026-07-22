import { Module } from '@nestjs/common';
import { ConnectorSecretsService } from './connector-secrets.service.js';
import { IngestProducerService } from './ingest-producer.service.js';
import { ConnectorIngestionService } from './connector-ingestion.service.js';
import { FolderMirrorService } from './folder-mirror.service.js';
import { SyncWorker } from './sync.worker.js';
import { CONNECTOR_RESOLVER, defaultConnectorResolver } from './connector-resolver.js';

@Module({
  providers: [
    ConnectorSecretsService,
    IngestProducerService,
    ConnectorIngestionService,
    FolderMirrorService,
    SyncWorker,
    { provide: CONNECTOR_RESOLVER, useValue: defaultConnectorResolver },
  ],
})
export class ConnectorsModule {}
