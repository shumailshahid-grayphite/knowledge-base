import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SpacesModule } from '../spaces/spaces.module.js';
import { DocumentsService } from './documents.service.js';
import { DocumentsController } from './documents.controller.js';

@Module({
  imports: [AuthModule, SpacesModule],
  providers: [DocumentsService],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
