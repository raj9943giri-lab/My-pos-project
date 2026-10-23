import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { ShopScopeModule } from '../shop-scope/shop-scope.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/** PART 5 — merchant order management (lifecycle + fulfilment + history). */
@Module({
  imports: [DbModule, ShopScopeModule, InventoryModule, NotificationsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
