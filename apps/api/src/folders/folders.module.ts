import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SpacesModule } from '../spaces/spaces.module.js';
import { FoldersService } from './folders.service.js';
import { FoldersController } from './folders.controller.js';

@Module({
  imports: [AuthModule, SpacesModule],
  providers: [FoldersService],
  controllers: [FoldersController],
  exports: [FoldersService],
})
export class FoldersModule {}
