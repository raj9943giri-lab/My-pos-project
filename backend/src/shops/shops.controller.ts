import {
  Body, Controller, Get, HttpException, Param, Patch, ParseUUIDPipe, Post, Query, Request,
  UseFilters, UseGuards, UseInterceptors, UploadedFile, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ShopsService } from './shops.service';
import { SlugService } from './slug.service';
import { AuthGuard } from '../common/guards';
import { CurrentUser } from '../common/current-user.decorator';
import { CheckSlugQueryDto, CreateShopDto, SubmitApprovalDto, UpdateShopDto } from './dto';
import { AllExceptionsFilter } from '../common/http-exception.filter';
import { RateLimiter } from '../common/throttle';

/* GET /shops/check-slug rate-limit: 60 req / min per IP; OTP flow alone handles auth. */
const slugLimiter = new RateLimiter(60, 60 * 1000);

@UseFilters(AllExceptionsFilter)
@Controller('shops')
export class ShopsController {
  constructor(private shops: ShopsService, private slug: SlugService) {}

  /** POST /shops — नई दुकान (auth; OWNER membership बनती है; status DRAFT). */
  @UseGuards(AuthGuard)
  @Post()
  async create(@CurrentUser() user: { id: string }, @Body() dto: CreateShopDto) {
    return this.shops.create(user.id, dto);
  }

  /** GET /shops/my (auth) */
  @UseGuards(AuthGuard)
  @Get('my')
  async my(@CurrentUser() user: { id: string }) {
    const shop = await this.shops.my(user.id);
    if (!shop) throw new NotFoundException('अभी आपकी दुकान नहीं बनी');
    return shop;
  }

  /** GET /shops/check-slug?slug=rajesh-kirana (public, rate-limited). */
  @Get('check-slug')
  async checkSlug(@Request() req: any, @Query() q: CheckSlugQueryDto) {
    const gate = slugLimiter.hit('ipslug:' + (req.ip || 'x'));
    if (!gate.ok) {
      throw new HttpException({ message: 'slug check limit — थोड़ी देर में कोशिश करें', status: 429 }, 429);
    }
    return this.slug.check(q.slug);
  }

  /**
   * GET /shops/:slug/public — पब्लिक (सिर्फ़ APPROVED + published).
   * :slug और UUID दोनों रास्ते अलग — UUID यूआईडी की लंबाई 36 होती है पर यह सब रूट हैंडल
   * करता है; साथ में 'public' शब्द से बचते हैं.
   */
  @Get(':slug/public')
  async publicBySlug(@Param('slug') slug: string) {
    if (slug.length === 36 && slug.includes('-')) {
      // कास्ट आईडी-स्वरूप: ID से public लिस्ट कभी नहीं मिलनी चाहिए
      throw new NotFoundException('सार्वजनिक दुकान slug से ही मिलेगी');
    }
    return this.shops.publicBySlug(slug.replace(/[^a-z0-9\u0900-\u097F-]/gi, ''));
  }

  /**
   * PART 6 — GET /shops/:shopId/share-info (auth member; STAFF भी देख सकता है).
   * मर्चेंट शेयर स्क्रीन का सच्चा स्रोत: server-configured public URL + OG + संदेश.
   */
  @UseGuards(AuthGuard)
  @Get(':id/share-info')
  async shareInfo(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.shops.shareInfo(user.id, id);
  }

  /** GET /shops/:id (auth member). */
  @UseGuards(AuthGuard)
  @Get(':id')
  async getById(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.shops.getById(user.id, id);
  }

  /** PATCH /shops/:id (auth OWNER) — approval_status/published यहाँ से नहीं बदलते. */
  @UseGuards(AuthGuard)
  @Patch(':id')
  async update(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShopDto,
    @Request() req: { body?: Record<string, unknown> },
  ) {
    // raw body (validation से पहले) — whitelist ने forbidden keys हटा दी हों तो भी
    // approval_status/published की कोशिश पकड़ी जाए.
    return this.shops.update(user.id, id, dto, req.body);
  }

  /** POST /shops/:id/submit-for-approval (auth OWNER). */
  @UseGuards(AuthGuard)
  @Post(':id/submit-for-approval')
  async submit(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() _dto: SubmitApprovalDto) {
    return this.shops.submitForApproval(user.id, id);
  }

  /** POST /shops/:id/media (auth OWNER; multipart file + kind=LOGO|COVER). */
  @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024 } }))
  @Post(':id/media')
  async upload(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body('kind') kind: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    try {
      return await this.shops.addMedia(user.id, id, file, kind);
    } catch (e: any) {
      if (e instanceof BadRequestException || e instanceof NotFoundException || e instanceof ForbiddenException) throw e;
      const st = Number(e.status || 400);
      throw new HttpException({ message: e.message || 'मीडिया अपलोड फ़ैल', status: st }, st);
    }
  }
}
