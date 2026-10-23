import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PublicStoreController } from './public-store.controller';
import { PublicStoreService } from './public-store.service';

/**
 * PART 4 — customer storefront API.
 * सारे routes public (no auth) हैं और controller में per-IP rate-limited हैं;
 * checkout products की row-locks + inventory movement log उसी tx में लिखे जाते हैं.
 * PART 5 — OrdersService (shared स्टॉक-वापसी) और NotificationsService
 * (order बनने/रद्द होने का outbox event, उसी tx में) जुड़े.
 */
@Module({
  imports: [DbModule, InventoryModule, OrdersModule, NotificationsModule],
  controllers: [PublicStoreController],
  providers: [PublicStoreService],
})
export class PublicStoreModule {}
