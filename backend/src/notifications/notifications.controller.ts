import { Body, Controller, Get, Param, Post, Query, UseFilters, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/guards';
import { CurrentUser } from '../common/current-user.decorator';
import { AllExceptionsFilter } from '../common/http-exception.filter';
import { NotificationsService } from './notifications.service';
import { DeviceTokenDto } from './dto';

/**
 * PART 5 — authenticated notification routes.
 * सिर्फ़ उस merchant की अपनी सूची दिखती है (shop_members से जुड़ती है) — दूसरी
 * दुकान के नोटिफिकेशन कभी नहीं. Device token भी सिर्फ़ अपना ही register होता है.
 */
@UseFilters(AllExceptionsFilter)
@Controller('notifications')
export class NotificationsController {
  constructor(private notifs: NotificationsService) {}

  /** POST /notifications/device-tokens — { token, platform? } (अपना FCM token). */
  @UseGuards(AuthGuard)
  @Post('device-tokens')
  registerToken(@CurrentUser() user: { id: string }, @Body() dto: DeviceTokenDto) {
    return this.notifs.registerDevice(user.id, dto, dto);
  }

  /** GET /notifications?limit= — उस user के shops का in-app इतिहास. */
  @UseGuards(AuthGuard)
  @Get()
  list(@CurrentUser() user: { id: string }, @Query('limit') limit?: string) {
    const lim = limit === undefined || limit === null || limit === '' ? undefined : Number(limit);
    return this.notifs.listForUser(user.id, lim);
  }

  /** POST /notifications/:id/read — authorized mark-as-read. */
  @UseGuards(AuthGuard)
  @Post(':id/read')
  markRead(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.notifs.markRead(user.id, id);
  }
}
