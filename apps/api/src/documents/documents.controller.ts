import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ListDocumentsQuery,
  type AuthUser,
  type DocumentResponse,
} from '@kb/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { UploadedFileLike } from '../common/types.js';
import { DocumentsService } from './documents.service.js';

const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB ?? 50) || 50) * 1024 * 1024;

@Controller()
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('spaces/:spaceId/documents')
  // FileInterceptor defaults to in-memory storage, so file.buffer is populated.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new ParseUUIDPipe()) spaceId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    // Optional multipart text field; when present the doc is filed into that folder.
    @Body('folderId') folderId: string | undefined,
  ): Promise<DocumentResponse> {
    return this.documents.upload(user, spaceId, file, folderId);
  }

  @Get('spaces/:spaceId/documents')
  list(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new ParseUUIDPipe()) spaceId: string,
    @Query(new ZodValidationPipe(ListDocumentsQuery)) query: ListDocumentsQuery,
  ): Promise<DocumentResponse[]> {
    return this.documents.list(user, spaceId, query);
  }

  @Get('documents/:id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DocumentResponse> {
    return this.documents.getById(user, id);
  }

  @Post('documents/:id/reprocess')
  reprocess(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DocumentResponse> {
    return this.documents.reprocess(user, id);
  }
}
