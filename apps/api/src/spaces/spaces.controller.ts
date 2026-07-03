import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  CreateSpaceRequest,
  type AuthUser,
  type SpaceResponse,
} from '@kb/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SpacesService } from './spaces.service.js';

@Controller('spaces')
@UseGuards(AuthGuard)
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateSpaceRequest)) body: CreateSpaceRequest,
  ): Promise<SpaceResponse> {
    return this.spaces.create(user, body);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<SpaceResponse[]> {
    return this.spaces.list(user);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SpaceResponse> {
    return this.spaces.get(user, id);
  }
}
