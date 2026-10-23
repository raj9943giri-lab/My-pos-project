import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { ShopScopeModule } from '../shop-scope/shop-scope.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/** PART 3 — inventory summary + audit trail. Exports the service so the
 * products and bulk-operations modules can log movements in their own txs. */
@Module({
  imports: [DbModule, ShopScopeModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
