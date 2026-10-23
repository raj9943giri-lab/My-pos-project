import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { ShopScopeModule } from '../shop-scope/shop-scope.module';
import { ProductCategoriesController } from './product-categories.controller';
import { ProductCategoriesService } from './product-categories.service';

/** PART 3 — shop scoped product categories. */
@Module({
  imports: [DbModule, ShopScopeModule],
  controllers: [ProductCategoriesController],
  providers: [ProductCategoriesService],
})
export class ProductCategoriesModule {}
