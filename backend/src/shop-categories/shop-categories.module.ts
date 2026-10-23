import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { ShopCategoriesController } from './shop-categories.controller';
import { ShopCategoriesService } from './shop-categories.service';

@Module({
  imports: [DbModule],
  controllers: [ShopCategoriesController],
  providers: [ShopCategoriesService],
})
export class ShopCategoriesModule {}
