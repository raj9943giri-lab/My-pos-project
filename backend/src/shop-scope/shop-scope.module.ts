import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { ShopScopeService } from './shop-scope.service';

/** Shared tenant-scoping helper (shop_id resolution + role checks). */
@Module({
  imports: [DbModule],
  providers: [ShopScopeService],
  exports: [ShopScopeService],
})
export class ShopScopeModule {}
