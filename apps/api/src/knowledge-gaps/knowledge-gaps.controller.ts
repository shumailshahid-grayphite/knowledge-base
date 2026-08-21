import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { GapStatus, UpdateGapRequest, type AuthUser } from '@kb/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { RolesGuard } from '../common/roles.guard.js';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { KnowledgeGapsService } from './knowledge-gaps.service.js';

/**
 * Admin-facing Knowledge Gaps API. Every route is org-scoped (RLS) AND restricted
 * to owner/admin via the reusable RolesGuard. Employee recording happens inside the
 * chat flow, not here.
 */
@Controller('knowledge-gaps')
@UseGuards(AuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class KnowledgeGapsController {
  constructor(private readonly gaps: KnowledgeGapsService) {}

  @Get('metrics')
  metrics(@CurrentUser() user: AuthUser) {
    return this.gaps.metrics(user);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    const parsed = GapStatus.safeParse(status);
    return this.gaps.list(user, parsed.success ? parsed.data : undefined);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.gaps.detail(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateGapRequest)) body: UpdateGapRequest,
  ) {
    return this.gaps.updateStatus(user, id, body.status);
  }
}
