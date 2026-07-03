import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SpacesModule } from '../spaces/spaces.module.js';
import { ConnectorsService } from './connectors.service.js';
import { ConnectorsController } from './connectors.controller.js';
import { ConnectorSecretsService } from './connector-secrets.service.js';
import { SyncQueueService } from './sync-queue.service.js';

@Module({
  imports: [AuthModule, SpacesModule],
  providers: [ConnectorsService, ConnectorSecretsService, SyncQueueService],
  controllers: [ConnectorsController],
})
export class ConnectorsModule {}
