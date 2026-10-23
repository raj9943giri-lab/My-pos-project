import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseFilters, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/guards';
import { CurrentUser } from '../common/current-user.decorator';
import { AllExceptionsFilter } from '../common/http-exception.filter';
import { OrdersService } from './orders.service';
import { ListOrdersQueryDto, ReasonDto, StatusActionDto } from './dto';

/**
 * PART 5 — merchant order routes. हर route Bearer JWT चाहे और request के
 * shopId की सदस्यता service में जाँची जाती है (not-in-shop → 403).
 *
 *   GET  /shops/:shopId/orders                     list + फ़िल्टर
 *   GET  /shops/:shopId/orders/:orderId            details + items + history
 *   POST /shops/:shopId/orders/:orderId/accept     NEW → ACCEPTED
 *   POST /shops/:shopId/orders/:orderId/reject     NEW → REJECTED (+reason)
 *   POST /shops/:shopId/orders/:orderId/status     { action, reason? } — सारे कदम
 *   POST /shops/:shopId/orders/:orderId/cancel     NEW…PREPARED → CANCELLED (+reason)
 *   GET  /shops/:shopId/orders/:orderId/history    सिर्फ़ इतिहास
 */
@UseFilters(AllExceptionsFilter)
@Controller('shops/:shopId/orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @UseGuards(AuthGuard)
  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.orders.list(user.id, shopId, query);
  }

  @UseGuards(AuthGuard)
  @Get(':orderId')
  detail(
    @CurrentUser() user: { id: string },
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.orders.detail(user.id, shopId, orderId);
  }

  @UseGuards(AuthGuard)
  @Get(':orderId/history')
  history(
    @CurrentUser() user: { id: string },
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.orders.history(user.id, shopId, orderId);
  }

  /** POST …/accept — वही act(ACCEPT); BODY वैकल्पिक (reason@ फ़ील्ड सगे). */
  @UseGuards(AuthGuard)
  @Post(':orderId/accept')
  accept(
    @CurrentUser() user: { id: string },
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('orderId') orderId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.orders.act(user.id, shopId, orderId, { action: 'ACCEPT', reason: dto && dto.reason });
  }

  /** POST …/reject — reason साथ (वैकल्पिक पर डालना अच्छा). */
  @UseGuards(AuthGuard)
  @Post(':orderId/reject')
  reject(
    @CurrentUser() user: { id: string },
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('orderId') orderId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.orders.act(user.id, shopId, orderId, { action: 'REJECT', reason: dto && dto.reason });
  }

  /** POST …/cancel — स्टॉक वापसी उसी tx में (एक बार ही). */
  @UseGuards(AuthGuard)
  @Post(':orderId/cancel')
  cancel(
    @CurrentUser() user: { id: string },
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('orderId') orderId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.orders.act(user.id, shopId, orderId, { action: 'CANCEL', reason: dto && dto.reason });
  }

  /** POST …/status — { action: ACCEPT|REJECT|START_PREPARING|MARK_READY|OUT_FOR_DELIVERY|COMPLETE|CANCEL|MARK_PAID, reason? }. */
  @UseGuards(AuthGuard)
  @Post(':orderId/status')
  status(
    @CurrentUser() user: { id: string },
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('orderId') orderId: string,
    @Body() dto: StatusActionDto,
  ) {
    return this.orders.act(user.id, shopId, orderId, dto);
  }
}
