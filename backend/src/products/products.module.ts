import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { ShopScopeModule } from '../shop-scope/shop-scope.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/** PART 3 — product catalogue, inventory and bulk price editing. */
@Module({
  imports: [DbModule, ShopScopeModule, InventoryModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
