import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser, AdminUser } from './guards';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

/** PART 7 — admin routes: { id, email, role } (RolesGuard DB से role ताज़ा करता है). */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminUser => ctx.switchToHttp().getRequest().admin,
);
