import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreateDatasetRequest,
  SimulateThresholdsRequest,
  UpsertCaseRequest,
  type AuthUser,
} from '@kb/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { RolesGuard } from '../common/roles.guard.js';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { EvaluationService } from './evaluation.service.js';

/** Admin-only RAG Evaluation API. Org-scoped (RLS) + owner/admin (RolesGuard). */
@Controller('evaluation')
@UseGuards(AuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class EvaluationController {
  constructor(private readonly evaluation: EvaluationService) {}

  @Post('datasets')
  createDataset(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateDatasetRequest)) body: CreateDatasetRequest,
  ) {
    return this.evaluation.createDataset(user, body);
  }

  @Get('datasets')
  listDatasets(@CurrentUser() user: AuthUser) {
    return this.evaluation.listDatasets(user);
  }

  @Get('documents')
  searchDocuments(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.evaluation.searchDocuments(user, q ?? '');
  }

  @Get('datasets/:id')
  dataset(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.evaluation.getDatasetCases(user, id);
  }

  @Post('datasets/:id/cases')
  createCase(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpsertCaseRequest)) body: UpsertCaseRequest,
  ) {
    return this.evaluation.createCase(user, id, body);
  }

  @Patch('cases/:caseId')
  updateCase(
    @CurrentUser() user: AuthUser,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Body(new ZodValidationPipe(UpsertCaseRequest)) body: UpsertCaseRequest,
  ) {
    return this.evaluation.updateCase(user, caseId, body);
  }

  @Delete('cases/:caseId')
  deleteCase(@CurrentUser() user: AuthUser, @Param('caseId', new ParseUUIDPipe()) caseId: string) {
    return this.evaluation.deleteCase(user, caseId);
  }

  @Post('datasets/:id/runs')
  startRun(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.evaluation.startRun(user, id);
  }

  @Get('datasets/:id/runs')
  listRuns(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.evaluation.listRuns(user, id);
  }

  @Get('runs/:runId')
  run(@CurrentUser() user: AuthUser, @Param('runId', new ParseUUIDPipe()) runId: string) {
    return this.evaluation.getRun(user, runId);
  }

  @Post('runs/:runId/simulate')
  simulate(
    @CurrentUser() user: AuthUser,
    @Param('runId', new ParseUUIDPipe()) runId: string,
    @Body(new ZodValidationPipe(SimulateThresholdsRequest)) body: SimulateThresholdsRequest,
  ) {
    return this.evaluation.simulateThresholds(user, runId, body.adequacyScores);
  }
}
