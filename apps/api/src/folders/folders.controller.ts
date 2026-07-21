import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateFolderRequest,
  MoveFolderRequest,
  type AuthUser,
  type FolderResponse,
} from '@kb/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FoldersService } from './folders.service.js';

@Controller('spaces/:spaceId/folders')
@UseGuards(AuthGuard)
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new ParseUUIDPipe()) spaceId: string,
    @Body(new ZodValidationPipe(CreateFolderRequest)) body: CreateFolderRequest,
  ): Promise<FolderResponse> {
    return this.folders.create(user, spaceId, body);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new ParseUUIDPipe()) spaceId: string,
  ): Promise<FolderResponse[]> {
    return this.folders.list(user, spaceId);
  }

  @Patch(':folderId/move')
  move(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new ParseUUIDPipe()) spaceId: string,
    @Param('folderId', new ParseUUIDPipe()) folderId: string,
    @Body(new ZodValidationPipe(MoveFolderRequest)) body: MoveFolderRequest,
  ): Promise<FolderResponse> {
    return this.folders.move(user, spaceId, folderId, body.parentId);
  }

  @Delete(':folderId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new ParseUUIDPipe()) spaceId: string,
    @Param('folderId', new ParseUUIDPipe()) folderId: string,
  ): Promise<void> {
    await this.folders.delete(user, spaceId, folderId);
  }
}
