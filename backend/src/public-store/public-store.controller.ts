import {
  Body, Controller, Get, Headers, HttpException, Param, Post, Query, Request,
  UseFilters,
} from '@nestjs/common';
import { PublicStoreService } from './public-store.service';
import { CartValidateDto, CheckoutDto, PublicProductQueryDto } from './dto';
import { OrderCancelDto } from './dto';
import { AllExceptionsFilter } from '../common/http-exception.filter';
import { RateLimiter } from '../common/throttle';

/**
 * PART 4 — public customer endpoints (कोई auth नहीं, पर हर route rate-limited
 * है; order status के लिए बनता है पर predict हो नहीं सकने वाला access token).
 *   reads       120 / min / ip
 *   validate     30 / min / ip
 *   checkout     12 / min / ip   (heavy: tx + row locks)
 *   order token  60 / min / ip
 *   cust cancel  10 / min / ip   (PART 5 — न टूटा token बार-बार चलाना महँगा: tx)
 */
const readLimiter = new RateLimiter(120, 60 * 1000);
const validateLimiter = new RateLimiter(30, 60 * 1000);
const checkoutLimiter = new RateLimiter(12, 60 * 1000);
const orderLimiter = new RateLimiter(60, 60 * 1000);
const cancelLimiter = new RateLimiter(10, 60 * 1000);

function gated(req: any, limiter: RateLimiter, msg: string) {
  const gate = limiter.hit('pub:' + (req.ip || 'x'));
  if (!gate.ok) {
    throw new HttpException(
      { message: msg + ' — थोड़ी देर में फिर कोशिश करें', status: 429, retryAfter: gate.retryAfterSec },
      429,
    );
  }
}

const cleanSlug = (slug: string) => String(slug || '').replace(/[^a-z0-9\u0900-\u097F-]/gi, '');

@UseFilters(AllExceptionsFilter)
@Controller('public')
export class PublicStoreController {
  constructor(private store: PublicStoreService) {}

  /** GET /public/shops/:slug — published दुकान की सार्वजनिक जानकारी + OG. */
  @Get('shops/:slug')
  async shop(@Request() req: any, @Param('slug') slug: string) {
    gated(req, readLimiter, 'बहुत ज़्यादा रिक्वेस्ट');
    return this.store.shopSummary(cleanSlug(slug));
  }

  /**
   * PART 6 — GET /public/shops/:slug/metadata — safe OG/Twitter metadata JSON.
   * published दुकान ही (बाकी 404); rate-limit सारी public reads जैसा ही.
   */
  @Get('shops/:slug/metadata')
  async metadata(@Request() req: any, @Param('slug') slug: string) {
    gated(req, readLimiter, 'बहुत ज़्यादा रिक्वेस्ट');
    return this.store.publicMetadata(cleanSlug(slug));
  }

  /** GET /public/shops/:slug/categories — available प्रोडक्ट वाली कैटेगरी. */
  @Get('shops/:slug/categories')
  async categories(@Request() req: any, @Param('slug') slug: string) {
    gated(req, readLimiter, 'बहुत ज़्यादा रिक्वेस्ट');
    return this.store.categories(cleanSlug(slug));
  }

  /** GET /public/shops/:slug/products — खोज + फ़िल्टर + सॉर्ट + pagination. */
  @Get('shops/:slug/products')
  async products(
    @Request() req: any,
    @Param('slug') slug: string,
    @Query() q: PublicProductQueryDto,
  ) {
    gated(req, readLimiter, 'बहुत ज़्यादा रिक्वेस्ट');
    return this.store.listProducts(cleanSlug(slug), q);
  }

  /** GET /public/shops/:slug/products/:pid — product detail + variants. */
  @Get('shops/:slug/products/:pid')
  async product(
    @Request() req: any,
    @Param('slug') slug: string,
    @Param('pid') pid: string,
  ) {
    gated(req, readLimiter, 'बहुत ज़्यादा रिक्वेस्ट');
    return this.store.productBySlug(cleanSlug(slug), pid);
  }

  /** POST /public/shops/:slug/checkout/validate — कार्ट/कीमत/स्टॉक की सर्वर जाँच. */
  @Post('shops/:slug/checkout/validate')
  async validate(
    @Request() req: any,
    @Param('slug') slug: string,
    @Body() dto: CartValidateDto,
  ) {
    gated(req, validateLimiter, 'कार्ट-जाँच की सीमा');
    return this.store.validateCart(cleanSlug(slug), dto);
  }

  /**
   * POST /public/shops/:slug/checkout — असली order.
   * Idempotency-Key header ज़रूरी नहीं, पर client हर कोशिश में एक ही key भेजे —
   * network retry/double tap से डुप्लिकेट order नहीं बनेगा.
   */
  @Post('shops/:slug/checkout')
  async checkout(
    @Request() req: any,
    @Param('slug') slug: string,
    @Headers('idempotency-key') idemKey: string | undefined,
    @Body() dto: CheckoutDto,
  ) {
    gated(req, checkoutLimiter, 'ऑर्डर की सीमा');
    return this.store.createOrder(cleanSlug(slug), dto, idemKey);
  }

  /** GET /public/orders/:token — token वाले का order status (enumeration-proof). */
  @Get('orders/:token')
  async order(@Request() req: any, @Param('token') token: string) {
    gated(req, orderLimiter, 'ऑर्डर-स्थिति की सीमा');
    return this.store.orderPublic(token);
  }

  /**
   * POST /public/orders/:token/cancel — ग्राहक अपना नया (NEW) ऑर्डर रद्द करे.
   * { reason? } वैकल्पिक; स्टॉक वापसी + history + outbox उसी tx में (एक बार).
   */
  @Post('orders/:token/cancel')
  async cancelOrder(
    @Request() req: any,
    @Param('token') token: string,
    @Body() dto: OrderCancelDto,
  ) {
    gated(req, cancelLimiter, 'रद्द करने की सीमा');
    return this.store.cancelByToken(token, dto && dto.reason);
  }
}
