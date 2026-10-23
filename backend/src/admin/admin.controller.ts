import {
  Body, Controller, Get, HttpException, Param, Patch, ParseUUIDPipe, Post, Put, Query, Request,
  UseFilters, UseGuards, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { AdminGuard, RolesGuard, Roles } from '../common/guards';
import { CurrentAdmin } from '../common/current-user.decorator';
import { AdminService } from './admin.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminUsersService } from './admin-users.service';
import { PoliciesService } from './policies.service';
import { AllExceptionsFilter } from '../common/http-exception.filter';
import { IsBoolean, IsDefined, IsIn, IsOptional, IsString, MaxLength, MinLength, IsEmail, IsNumber, Min, Max } from 'class-validator';
import { DbService } from '../db/db.service';
import { UserRole } from '../common/roles';

/**
 * PART 7 — Admin Panel routes. हर route हर अनुरोध पर:
 *   AdminGuard  (JWT सत्यापन) → RolesGuard (DB से ताज़ा role/is_active)
 * Role-matrix (common/roles.ts के can*-helpers के समानांतर):
 *   SUPER_ADMIN : सब
 *   ADMIN       : dashboard, shops, complaints, policies, audit
 *   SUPPORT     : dashboard, shops (read), complaints
 * Login route public है (email+password, scrypt-verified, rate-limit नीचे).
 */

/** PATCH /admin/shops/:id/status body — action (या legacy status) + reason. */
export class SetStatusDto {
  @IsOptional() @IsIn(['APPROVE', 'REJECT', 'SUSPEND', 'UNSUSPEND'])
  action?: string;

  @IsOptional() @IsIn(['APPROVED', 'REJECTED', 'SUSPENDED', 'UNSUSPENDED'])
  status?: string;

  @IsOptional() @IsString() @MaxLength(300)
  reason?: string;
}

/** PATCH /admin/shops/:id/publish body — APPROVED दुकान को public on/off. */
export class SetPublishedDto {
  @IsBoolean({ message: 'published true/false होना चाहिए' })
  published!: boolean;
}

/** POST /admin/auth/login body. */
export class AdminLoginDto {
  @IsEmail({}, { message: 'ईमेल सही नहीं' }) email!: string;
  @IsString() @MinLength(1, { message: 'पासवर्ड चाहिए' }) password!: string;
}

/** POST /admin/admins body (SUPER_ADMIN only). */
export class CreateAdminDto {
  @IsEmail({}, { message: 'ईमेल सही नहीं' }) email!: string;
  @IsString() @MaxLength(60) name!: string;
  @IsIn(['SUPER_ADMIN', 'ADMIN', 'SUPPORT'], { message: 'भूमिका चुनें' })
  role!: string;
  @IsString() @MinLength(8, { message: 'पासवर्ड कम से कम 8 अक्षर' }) password!: string;
}

/** PATCH /admin/admins/:id body. */
export class PatchAdminDto {
  @IsOptional() @IsIn(['SUPER_ADMIN', 'ADMIN', 'SUPPORT'])
  role?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsString() @MinLength(8, { message: 'पासवर्ड कम से कम 8 अक्षर' })
  password?: string;
}

/** PATCH /admin/shop-categories/:id body — admin-managed categories. */
export class PatchCategoryDto {
  @IsOptional() @IsBoolean()
  is_active?: boolean;

  @IsOptional() @IsString() @MaxLength(60)
  license_label?: string;
}

/** PATCH /admin/policies/:key body — { "value": <per-key आकार> }.
 *  @IsDefined ज़रूरी — whitelist:true वाली global pipe बिना decorator वाली
 *  property हटा देती है और `value` अनदेखा हो जाता था (हमेशा 400). */
export class PolicyPatchDto {
  @IsDefined({ message: 'body { "value": … } के रूप में भेजें' })
  value!: unknown;
}

/** PUT /admin/commissions body — default commission 0…30%. */
export class CommissionDto {
  @IsNumber({}, { message: 'कमीशन संख्या में हो' })
  @Min(0) @Max(30)
  defaultPct!: number;
}

/** Login rate-limit (प्रति IP+ईमेल) — ब्रूट-फ़ोर्स धीमा रखने के लिए. */
const RATE_MAX = 10;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const loginHits = new Map<string, { n: number; resetAt: number }>();

function loginGate(ip: string, email: string) {
  const key = ip + '|' + String(email || '').toLowerCase();
  const now = Date.now();
  const b = loginHits.get(key);
  if (!b || now > b.resetAt) {
    loginHits.set(key, { n: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  b.n += 1;
  if (b.n > RATE_MAX) {
    throw new HttpException(
      { message: 'बहुत ज़्यादा कोशिश — 5 मिनट बाद दोबारा', status: 429, retryAfter: Math.ceil((b.resetAt - now) / 1000) },
      429,
    );
  }
}

@UseFilters(AllExceptionsFilter)
@Controller('admin')
export class AdminController {  constructor(
    private admin: AdminService,
    private auth: AdminAuthService,
    private admins: AdminUsersService,
    private policies: PoliciesService,
    private db: DbService,
  ) {}

  /* ------------------------------ auth ------------------------------------ */
  /** POST /admin/auth/login — public (rate-limited; JWT 12h). */
  @Post('auth/login')
  @UseFilters(AllExceptionsFilter)
  login(@Request() req: { ip?: string }, @Body() dto: AdminLoginDto) {
    loginGate(req.ip || 'x', dto.email);
    return this.auth.login(dto.email, dto.password);
  }

  /** GET /admin/me — चालू सत्र + ताज़ा भूमिका. */
  @UseGuards(AdminGuard, RolesGuard)
  @Get('me')
  me(@CurrentAdmin() admin: { id: string; email: string; role: UserRole }) {
    return this.auth.me(admin);
  }

  /* ---------------------------- dashboard --------------------------------- */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT)
  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  /* ------------------------------ orders ---------------------------------- */
  /** GET /admin/orders — प्लेटफ़ॉर्म-व्यापी ऑर्डर (read-only; तीनों भूमिकाएँ). */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT)
  @Get('orders')
  listOrders(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('shopId') shopId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listOrders({ status, q, shopId, page: Number(page), limit: Number(limit) });
  }

  /* ---------------------------- commissions ------------------------------- */
  /** GET /admin/commissions — default % + प्रति-दुकान अनुमान (SUPER/ADMIN). */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('commissions')
  commissions() {
    return this.admin.commissionSummary();
  }

  /** PUT /admin/commissions — default commission (platform_policies में सेव). */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Put('commissions')
  saveCommission(@Body() dto: CommissionDto, @CurrentAdmin() admin: { id: string }) {
    return this.policies.update(admin, 'commission_default_pct', { value: dto.defaultPct });
  }

  /* ------------------------------ shops ----------------------------------- */
  /** GET /admin/shops — list (outputs?queue=1 पर PENDING+DRAFT), SUPPORT read. */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT)
  @Get('shops')
  listShops(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('queue') queue?: string,
  ) {
    return this.admin.listShops({
      status, q, page: Number(page), limit: Number(limit), queue: queue === '1',
    });
  }

  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT)
  @Get('shops/queue')
  listQueue() {
    return this.admin.listShops({ queue: true, limit: 100 });
  }

  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT)
  @Get('shops/:id')
  getShop(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getShop(id);
  }

  /** PATCH /admin/shops/:id/status — सिर्फ़ SUPER_ADMIN/ADMIN (SUPPORT 403). */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Patch('shops/:id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStatusDto,
    @CurrentAdmin() admin: { id: string; email: string },
  ) {
    return this.admin.setStatus(id, dto, dto.reason, admin);
  }

  /** PATCH /admin/shops/:id/publish — APPROVED को public on/off (SUPER/ADMIN). */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Patch('shops/:id/publish')
  setPublished(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPublishedDto,
    @CurrentAdmin() admin: { id: string; email: string },
  ) {
    return this.admin.setPublished(id, dto.published, admin);
  }

  /** PATCH /admin/shop-categories/:id — categories admin से manage (SUPER/ADMIN). */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Patch('shop-categories/:id')
  async patchCategory(
    @Param('id') id: string,
    @Body() dto: PatchCategoryDto,
    @CurrentAdmin() admin: { id: string },
  ) {
    const sets: string[] = [];
    const vals: any[] = [];
    if (dto.is_active !== undefined) { sets.push('is_active = $' + (vals.length + 1)); vals.push(dto.is_active); }
    if (dto.license_label !== undefined) { sets.push('license_label = $' + (vals.length + 1)); vals.push(dto.license_label); }
    if (!sets.length) throw new BadRequestException('बदलने का कोई फ़ील्ड नहीं दिया');
    vals.push(id);
    const row = await this.db.one(
      'UPDATE shop_categories SET ' + sets.join(', ') + ' WHERE id = $' + vals.length + ' RETURNING *', vals);
    if (!row) throw new NotFoundException('कैटेगरी नहीं मिली');
    await this.admin.writeAudit(admin.id, 'CATEGORY_PATCH', 'shop_categories', id,
      { is_active: dto.is_active, license_label: dto.license_label });
    return row;
  }

  /* ------------------------------ policies -------------------------------- */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT)
  @Get('policies')
  listPolicies() {
    return this.policies.list();
  }

  /** PATCH /admin/policies/:key — सिर्फ़ SUPER_ADMIN/ADMIN. */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Patch('policies/:key')
  patchPolicy(
    @Param('key') key: string,
    @Body() dto: PolicyPatchDto,
    @CurrentAdmin() admin: { id: string },
  ) {
    return this.policies.update(admin, key, dto);
  }

  /* ------------------------------- admins --------------------------------- */
  /** GET /admin/admins — सिर्फ़ SUPER_ADMIN. */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('admins')
  listAdmins() {
    return this.admins.list();
  }

  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Post('admins')
  createAdmin(@Body() dto: CreateAdminDto, @CurrentAdmin() admin: { id: string }) {
    return this.admins.create(admin, dto);
  }

  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Patch('admins/:id')
  patchAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchAdminDto,
    @CurrentAdmin() admin: { id: string },
  ) {
    return this.admins.patch(admin, id, dto);
  }

  /* ------------------------------ audit ----------------------------------- */
  /** GET /admin/audit — recent actions (SUPER/ADMIN). */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('audit')
  audit(@Query('limit') limit?: string, @Query('action') action?: string) {
    return this.admin.listAudit(Number(limit) || 50, action);
  }
}

