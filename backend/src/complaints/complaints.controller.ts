import {
  Body, Controller, Get, HttpException, ParseIntPipe, Param, Post, Query, Request,
  UseFilters, UseGuards,
} from '@nestjs/common';
import { AuthGuard, AdminGuard, RolesGuard, Roles } from '../common/guards';
import { CurrentUser, CurrentAdmin } from '../common/current-user.decorator';
import { AllExceptionsFilter } from '../common/http-exception.filter';
import { RateLimiter } from '../common/throttle';
import { UserRole } from '../common/roles';
import { ComplaintsService } from './complaints.service';
import {
  ComplaintActionDto, ComplaintNoteDto, CreateComplaintDto, ListComplaintsQueryDto,
} from './dto';

/**
 * PART 7 — शिकायत routes. तीन दर्जने:
 *   admin  : GET/POST /admin/complaints… (AdminGuard + RolesGuard — तीनों admin
 *            भूमिकाएँ; SUPPORT की limit सर्विस में काम-स्तर पर लगती है)
 *   public : POST /public/orders/:token/complaint (rate-limited, no auth)
 *   merchant: POST /shops/:shopId/complaints (member JWT)
 */
const fileLimiter = new RateLimiter(8, 10 * 60 * 1000);

function gated(req: any, msg: string) {
  const gate = fileLimiter.hit('cmp:' + (req.ip || 'x'));
  if (!gate.ok) {
    throw new HttpException(
      { message: msg + ' — थोड़ी देर में फिर कोशिश करें', status: 429, retryAfter: gate.retryAfterSec },
      429,
    );
  }
}

@UseFilters(AllExceptionsFilter)
@Controller('admin/complaints')
export class AdminComplaintsController {
  constructor(private complaints: ComplaintsService) {}

  /** GET /admin/complaints?status=&priority=&shopId=&assigned=&q=&page=&limit= */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT)
  @Get()
  list(@Query() q: ListComplaintsQueryDto, @CurrentAdmin() admin: { id: string }) {
    return this.complaints.list(q || {}, admin);
  }

  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT)
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.complaints.detail(id);
  }

  /** POST …/:id/status — { action: START|RESOLVE|CLOSE|REOPEN, note?, assignTo? } */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT)
  @Post(':id/status')
  act(
    @CurrentAdmin() admin: { id: string; role: UserRole },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ComplaintActionDto,
  ) {
    return this.complaints.act(admin, id, dto);
  }

  /** POST …/:id/note — { body, isInternal? } — internal टिप्पणी default. */
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT)
  @Post(':id/note')
  note(
    @CurrentAdmin() admin: { id: string; role: UserRole; email: string },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ComplaintNoteDto,
  ) {
    return this.complaints.addNote(admin, id, dto.body, dto.isInternal);
  }
}

/** ग्राहक — ऑर्डर token से शिकायत (rate-limited; बिना login). */
@UseFilters(AllExceptionsFilter)
@Controller('public/orders')
export class PublicComplaintController {
  constructor(private complaints: ComplaintsService) {}

  @Post(':token/complaint')
  create(@Request() req: any, @Param('token') token: string, @Body() dto: CreateComplaintDto) {
    gated(req, 'शिकायतें बहुत तेज़ी से दर्ज हो रही हैं');
    return this.complaints.createForOrder(token, dto);
  }
}

/** दुकानदार — अपनी दुकान की शिकायत platform से. */
@UseFilters(AllExceptionsFilter)
@Controller('shops/:shopId/complaints')
export class MerchantComplaintController {
  constructor(private complaints: ComplaintsService) {}

  @UseGuards(AuthGuard)
  @Post()
  create(
    @CurrentUser() user: { id: string },
    @Param('shopId') shopId: string,
    @Body() dto: CreateComplaintDto,
  ) {
    return this.complaints.createForMerchant(user.id, shopId, dto);
  }
}
