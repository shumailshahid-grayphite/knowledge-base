import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  QueryRequest,
  RenameChatRequest,
  type AuthUser,
  type ExtractAttachmentResponse,
  type QueryResponse,
} from '@kb/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { UploadedFileLike } from '../common/types.js';
import { QueryService } from './query.service.js';
import { AttachmentExtractorService } from './attachment-extractor.service.js';

const MAX_ATTACHMENT_BYTES = (Number(process.env.MAX_UPLOAD_MB ?? 50) || 50) * 1024 * 1024;

@Controller('spaces/:spaceId')
@UseGuards(AuthGuard)
export class QueryController {
  constructor(
    private readonly query: QueryService,
    private readonly attachments: AttachmentExtractorService,
  ) {}

  /** Extract text from an attached draft (ephemeral — never ingested/stored). */
  @Post('attachments/extract')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  extract(
    @Param('spaceId', new ParseUUIDPipe()) _spaceId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ): Promise<ExtractAttachmentResponse> {
    return this.attachments.extract(file);
  }

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

  /** List chat sessions (for the sidebar). */
  @Get('chats')
  chats(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new ParseUUIDPipe()) spaceId: string,
  ) {
    return this.query.listChats(user, spaceId);
  }

  /** Load one chat's full message history. */
  @Get('chats/:sessionId')
  chat(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new ParseUUIDPipe()) spaceId: string,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ) {
    return this.query.getChat(user, spaceId, sessionId);
  }

  /** Rename a chat. */
  @Patch('chats/:sessionId')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new ParseUUIDPipe()) spaceId: string,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body(new ZodValidationPipe(RenameChatRequest)) body: RenameChatRequest,
  ) {
    return this.query.renameChat(user, spaceId, sessionId, body.title);
  }

  /** Delete a chat and its messages. */
  @Delete('chats/:sessionId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new ParseUUIDPipe()) spaceId: string,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ) {
    return this.query.deleteChat(user, spaceId, sessionId);
  }
}
