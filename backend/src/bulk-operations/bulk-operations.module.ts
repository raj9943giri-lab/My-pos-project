import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { ShopScopeModule } from '../shop-scope/shop-scope.module';
import { InventoryModule } from '../inventory/inventory.module';
import { BulkOperationsController } from './bulk-operations.controller';
import { BulkOperationsService } from './bulk-operations.service';

/** PART 3 — many-products-at-once writes (stock / category / active). */
@Module({
  imports: [DbModule, ShopScopeModule, InventoryModule],
  controllers: [BulkOperationsController],
  providers: [BulkOperationsService],
})
export class BulkOperationsModule {}
