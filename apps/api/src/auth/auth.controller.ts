import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { LoginRequest, type AuthUser, type LoginResponse } from '@kb/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';

const LoginBody = LoginRequest.extend({
  organizationId: z.string().uuid().optional(),
});

const DevLoginBody = z.object({
  email: z.string().email(),
  organizationId: z.string().uuid().optional(),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(
    @Body(new ZodValidationPipe(LoginBody)) body: z.infer<typeof LoginBody>,
  ): Promise<LoginResponse> {
    return this.auth.login(body.email, body.password, body.organizationId);
  }

  @Post('dev-login')
  devLogin(
    @Body(new ZodValidationPipe(DevLoginBody)) body: z.infer<typeof DevLoginBody>,
  ): Promise<LoginResponse> {
    return this.auth.devLogin(body.email, body.organizationId);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
