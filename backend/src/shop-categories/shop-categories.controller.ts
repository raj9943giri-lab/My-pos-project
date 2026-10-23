import { Controller, Get, UseFilters } from '@nestjs/common';
import { ShopCategoriesService } from './shop-categories.service';
import { AllExceptionsFilter } from '../common/http-exception.filter';

/** GET /shop-categories — public list (admin-managed rows). */
@UseFilters(AllExceptionsFilter)
@Controller('shop-categories')
export class ShopCategoriesController {
  constructor(private svc: ShopCategoriesService) {}

  @Get()
  list() {
    return this.svc.listActive();
  }
}
