import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { firstValueFrom, from, type Observable } from 'rxjs';
import type { RequestWithUser } from './types.js';
import { DatabaseService } from '../database/database.service.js';

/**
 * Binds the authenticated tenant to the request's DB connection so Postgres RLS
 * (app.current_org) enforces isolation for every query in the handler. Runs
 * after AuthGuard (which sets req.user); unauthenticated routes (auth/health)
 * pass through and use the raw pool.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly database: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const orgId = req.user?.organizationId;
    if (!orgId) return next.handle();
    return from(this.database.runWithTenant(orgId, () => firstValueFrom(next.handle())));
  }
}
