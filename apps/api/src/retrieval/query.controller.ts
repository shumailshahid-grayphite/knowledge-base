import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { QueryRequest, type AuthUser, type QueryResponse } from '@kb/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { QueryService } from './query.service.js';

@Controller('spaces/:spaceId')
@UseGuards(AuthGuard)
export class QueryController {
  constructor(private readonly query: QueryService) {}

  @Post('query')
  ask(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new ParseUUIDPipe()) spaceId: string,
    @Body(new ZodValidationPipe(QueryRequest)) body: QueryRequest,
  ): Promise<QueryResponse> {
    return this.query.ask(user, spaceId, body);
  }

  @Get('query-logs')
  logs(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new ParseUUIDPipe()) spaceId: string,
  ) {
    return this.query.recentLogs(user, spaceId);
  }
}
