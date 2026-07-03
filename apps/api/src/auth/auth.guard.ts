import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { RequestWithUser } from '../common/types.js';
import { AuthService } from './auth.service.js';

/**
 * Authenticates the request and attaches `req.user` (id + organizationId + role).
 * Every tenant-scoped controller uses this; downstream services scope all queries
 * by `req.user.organizationId`, so tenant isolation is enforced at the API layer.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    req.user = await this.auth.verify(header.slice('Bearer '.length));
    return true;
  }
}
