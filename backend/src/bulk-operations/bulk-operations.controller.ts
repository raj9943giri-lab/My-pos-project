import { Body, Controller, Post, UseFilters, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/guards';
import { CurrentUser } from '../common/current-user.decorator';
import { AllExceptionsFilter } from '../common/http-exception.filter';
import { BulkOperationsService } from './bulk-operations.service';
import { BulkActiveDto, BulkCategoryDto, BulkStockDto } from './dto';

/** PART 3 — bulk routes. Auth applies; finer role checks inside the service
 *  (stock = STAFF ok, category/active = OWNER or MANAGER). */
@UseFilters(AllExceptionsFilter)
@Controller('bulk-operations')
export class BulkOperationsController {
  constructor(private bulk: BulkOperationsService) {}

  /** POST /bulk-operations/stock — { items: [{ id, delta?|stock? }], note? } */
  @UseGuards(AuthGuard)
  @Post('stock')
  stock(@CurrentUser() user: { id: string }, @Body() dto: BulkStockDto) {
    return this.bulk.stock(user.id, dto);
  }

  /** POST /bulk-operations/category — { ids: [...], categoryId? | category? } */
  @UseGuards(AuthGuard)
  @Post('category')
  assignCategory(@CurrentUser() user: { id: string }, @Body() dto: BulkCategoryDto) {
    return this.bulk.assignCategory(user.id, dto);
  }

  /** POST /bulk-operations/active — { ids: [...], active: false|true } */
  @UseGuards(AuthGuard)
  @Post('active')
  setActive(@CurrentUser() user: { id: string }, @Body() dto: BulkActiveDto) {
    return this.bulk.setActive(user.id, dto);
  }
}
