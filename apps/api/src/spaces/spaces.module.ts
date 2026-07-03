import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SpacesService } from './spaces.service.js';
import { SpacesController } from './spaces.controller.js';

@Module({
  imports: [AuthModule],
  providers: [SpacesService],
  controllers: [SpacesController],
  exports: [SpacesService],
})
export class SpacesModule {}
