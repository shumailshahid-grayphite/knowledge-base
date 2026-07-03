import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '@kb/shared';
import type { RequestWithUser } from './types.js';

/** Extracts the authenticated user (populated by AuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!req.user) {
      throw new UnauthorizedException('No authenticated user on request');
    }
    return req.user;
  },
);
