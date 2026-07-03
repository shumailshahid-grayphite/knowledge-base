import { z } from 'zod';

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const AuthUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  organizationId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});
export type AuthUser = z.infer<typeof AuthUser>;

export const LoginResponse = z.object({
  token: z.string(),
  user: AuthUser,
});
export type LoginResponse = z.infer<typeof LoginResponse>;
