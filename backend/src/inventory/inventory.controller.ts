import { Controller, Get, Query, UseFilters, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/guards';
import { CurrentUser } from '../common/current-user.decorator';
import { AllExceptionsFilter } from '../common/http-exception.filter';
import { InventoryService } from './inventory.service';
import { ListMovementsQueryDto } from './dto';

/** PART 3 — inventory reads (summary card + movement audit). Writes go through
 *  /products/:id/stock and /bulk-operations/stock; both log their moves here. */
@UseFilters(AllExceptionsFilter)
@UseGuards(AuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private inventory: InventoryService) {}

  /** GET /inventory/summary — totals for the stock screen header card. */
  @Get('summary')
  summary(@CurrentUser() user: { id: string }) {
    return this.inventory.summary(user.id);
  }

  /** GET /inventory/movements?productId=&limit= */
  @Get('movements')
  movements(@CurrentUser() user: { id: string }, @Query() query: ListMovementsQueryDto) {
    return this.inventory.movements(user.id, query);
  }
}
