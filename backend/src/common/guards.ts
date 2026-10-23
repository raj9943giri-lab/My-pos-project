import { CanActivate, ExecutionContext, HttpException, Injectable, SetMetadata } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { env } from '../config/env';
import { DbService } from '../db/db.service';
import { isAdminRole, UserRole } from './roles';

export interface AuthUser { id: string; phone: string }

/** PART 7 — admin JWT अब भूमिका साथ लाता है (rl); DB फिर भी सच्चाई का स्रोत है
 * (RolesGuard हर अनुरोध पर admin_users से role/is_active दोबारा पढ़ता है —
 * बंद/डिग्रेड किया एडमिन पुराने टोकन से कुछ नहीं कर पाएगा). */
export interface AdminUser { id: string; email: string; role: UserRole | string }

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) throw new HttpException({ message: 'हर निजी रिक्वेस्ट ऑथेंटिकेटेड होना चाहिए (token nahi mila)' }, 401);
    try {
      const p = jwt.verify(token, env.JWT_SECRET) as { sub: string; ph: string };
      req.user = { id: p.sub, phone: p.ph };
      return true;
    } catch {
      throw new HttpException({ message: 'सेशन समाप्त — दोबारा लॉगिन करें' }, 401);
    }
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { admin?: AdminUser }>();
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) throw new HttpException({ message: 'Admin token required' }, 401);
    try {
      const p = jwt.verify(token, env.ADMIN_JWT_SECRET) as { sub: string; ad: string; rl?: string };
      req.admin = { id: p.sub, email: p.ad, role: p.rl || UserRole.ADMIN };
      return true;
    } catch {
      throw new HttpException({ message: 'Admin session समाप्त' }, 401);
    }
  }
}

/** @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN) — खाली छूटे तो कोई admin भूमिका चलेगी. */
export const ROLES_KEY = 'admin_roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * PART 7 — role-based access control. AdminGuard के *बाद* चलता है और हर
 * अनुरोध पर DB से ताज़ा भूमिका पढ़ता है:
 *   - टोकन की role सिर्फ़ संकेत है; admin_users.role = सच.
 *   - is_active=false (अक्षम) या role बदला तो पुराना टोकन तुरंत सीमित हो जाता है.
 * @Roles() न हो तो कोई भी मान्य admin भूमिका (SUPER/ADMIN/SUPPORT) गुज़रती है.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector, private db: DbService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { admin?: AdminUser }>();
    const admin = req.admin;
    if (!admin) throw new HttpException({ message: 'Admin token required' }, 401);

    const row = await this.db.query<{ role: string; is_active: boolean }>(
      'SELECT role, is_active FROM admin_users WHERE id = $1',
      [admin.id],
    );
    const current = row[0];
    if (!current) throw new HttpException({ message: 'Admin अकाउंट नहीं मिला' }, 401);
    if (!current.is_active) throw new HttpException({ message: 'यह admin अकाउंट अक्षम किया गया है' }, 403);

    const live = isAdminRole(current.role) ? current.role : UserRole.ADMIN;
    admin.role = live;

    const needed = this.reflector.getAllAndOverride(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]) as UserRole[] | undefined;
    if (!needed || !needed.length) return true;   // कोई admin भूमिका काफ़ी
    if (!needed.includes(live as UserRole)) {
      throw new HttpException(
        { message: 'इस काम की अनुमति आपकी भूमिका ('
          + String(live).replace('_', ' ')
          + ') को नहीं है', status: 403, requiredRoles: needed },
        403,
      );
    }
    return true;
  }
}
