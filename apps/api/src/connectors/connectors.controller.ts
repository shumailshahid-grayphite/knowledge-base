import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '@kb/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ConnectorsService } from './connectors.service.js';

const SyncBody = z.object({
  selector: z.record(z.any()).default({}),
  spaceId: z.string().uuid().optional(),
});

@Controller('connectors')
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get()
  @UseGuards(AuthGuard)
  list(@CurrentUser() user: AuthUser) {
    return this.connectors.list(user);
  }

  @Get(':type/auth-url')
  @UseGuards(AuthGuard)
  authUrl(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Query('spaceId') spaceId?: string,
    @Query('name') name?: string,
  ) {
    return this.connectors.getAuthUrl(user, type, { spaceId, name });
  }

  // Public: hit by the provider's browser redirect. Identity comes from the signed state.
  @Get(':type/callback')
  async callback(
    @Param('type') type: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    const redirect = await this.connectors.handleCallback(type, code, state);
    res.redirect(redirect);
  }

  @Get(':id/browse')
  @UseGuards(AuthGuard)
  browse(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('nodeId') nodeId?: string,
  ) {
    return this.connectors.browse(user, id, nodeId);
  }

  @Post(':id/sync')
  @UseGuards(AuthGuard)
  sync(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(SyncBody)) body: z.infer<typeof SyncBody>,
  ) {
    return this.connectors.sync(user, id, body);
  }

  @Get(':id/sync-history')
  @UseGuards(AuthGuard)
  history(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.connectors.history(user, id);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.connectors.remove(user, id);
  }
}
