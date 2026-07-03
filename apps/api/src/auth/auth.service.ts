import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { sql } from 'kysely';
import type { AuthUser, LoginResponse, MembershipRole } from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';
import { AppConfigService } from '../config/app-config.service.js';

interface JwtPayload {
  sub: string; // user id
  org: string; // organization id
  role: MembershipRole;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  /** Password login. `organizationId` optional; defaults to the user's first org. */
  async login(email: string, password: string, organizationId?: string): Promise<LoginResponse> {
    const user = await this.database.db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'password_hash'])
      .where(sql<boolean>`lower(email) = lower(${email})`)
      .executeTakeFirst();

    if (!user || !user.password_hash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await compare(password, user.password_hash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueForUser(user.id, user.email, user.name, organizationId);
  }

  /** Dev-only: mint a token without a password (for seeded/SSO-pending users). */
  async devLogin(email: string, organizationId?: string): Promise<LoginResponse> {
    if (!this.config.env.AUTH_DEV_MODE) {
      throw new ForbiddenException('Dev login is disabled');
    }
    const user = await this.database.db
      .selectFrom('users')
      .select(['id', 'email', 'name'])
      .where(sql<boolean>`lower(email) = lower(${email})`)
      .executeTakeFirst();
    if (!user) {
      throw new UnauthorizedException('Unknown user');
    }
    this.logger.warn({ email }, 'AUTH_DEV_MODE login used');
    return this.issueForUser(user.id, user.email, user.name, organizationId);
  }

  private async issueForUser(
    userId: string,
    email: string,
    name: string | null,
    organizationId?: string,
  ): Promise<LoginResponse> {
    let membershipQuery = this.database.db
      .selectFrom('memberships')
      .select(['organization_id', 'role'])
      .where('user_id', '=', userId);
    if (organizationId) {
      membershipQuery = membershipQuery.where('organization_id', '=', organizationId);
    }
    const membership = await membershipQuery.orderBy('created_at', 'asc').executeTakeFirst();
    if (!membership) {
      throw new UnauthorizedException('User has no organization membership');
    }

    const payload: JwtPayload = {
      sub: userId,
      org: membership.organization_id,
      role: membership.role,
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.env.JWT_SECRET,
      expiresIn: this.config.env.JWT_EXPIRES_IN,
    });

    const authUser: AuthUser = {
      id: userId,
      email,
      name,
      organizationId: membership.organization_id,
      role: membership.role,
    };
    return { token, user: authUser };
  }

  /** Verify a bearer token and re-check membership (revocation-aware). */
  async verify(token: string): Promise<AuthUser> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.env.JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const row = await this.database.db
      .selectFrom('memberships')
      .innerJoin('users', 'users.id', 'memberships.user_id')
      .select([
        'users.id as id',
        'users.email as email',
        'users.name as name',
        'memberships.organization_id as organizationId',
        'memberships.role as role',
      ])
      .where('memberships.user_id', '=', payload.sub)
      .where('memberships.organization_id', '=', payload.org)
      .executeTakeFirst();

    if (!row) {
      throw new UnauthorizedException('Membership no longer valid');
    }
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      organizationId: row.organizationId,
      role: row.role,
    };
  }
}
