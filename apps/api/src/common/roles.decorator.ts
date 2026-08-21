import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '@kb/db';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route to the given membership roles. Enforced by RolesGuard (which
 * must run after AuthGuard so req.user is populated). This is the single, reusable
 * authorization seam — add role checks here, never ad hoc inside controllers.
 *
 *   @UseGuards(AuthGuard, RolesGuard)
 *   @Roles('owner', 'admin')
 */
export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);
