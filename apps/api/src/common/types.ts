import type { Request } from 'express';
import type { AuthUser } from '@kb/shared';

export interface RequestWithUser extends Request {
  user?: AuthUser;
}

/** Minimal shape of an uploaded file (avoids depending on ambient Multer globals). */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
