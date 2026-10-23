import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseFilters, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/guards';
import { CurrentUser } from '../common/current-user.decorator';
import { AllExceptionsFilter } from '../common/http-exception.filter';
import { ProductsService } from './products.service';
import {
  AdjustStockDto, BulkPriceDto, CreateProductDto, ListProductsQueryDto, UpdateProductDto,
} from './dto';

/**
 * PART 3 — product catalogue + inventory routes.
 * Every route is authenticated and scoped to the merchant's own shop.
 */
@UseFilters(AllExceptionsFilter)
@Controller('products')
export class ProductsController {
  constructor(private products: ProductsService) {}

  /** GET /products?q=&categoryId=&stock=low|out&includeInactive= */
  @UseGuards(AuthGuard)
  @Get()
  list(@CurrentUser() user: { id: string }, @Query() query: ListProductsQueryDto) {
    return this.products.list(user.id, query);
  }

  /** POST /products/bulk-price — preview (preview=true) or atomic apply. */
  @UseGuards(AuthGuard)
  @Post('bulk-price')
  bulkPrice(@CurrentUser() user: { id: string }, @Body() dto: BulkPriceDto) {
    return this.products.bulkPrice(user.id, dto);
  }

  /** POST /products */
  @UseGuards(AuthGuard)
  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateProductDto) {
    return this.products.create(user.id, dto);
  }

  /** GET /products/:id */
  @UseGuards(AuthGuard)
  @Get(':id')
  getById(@CurrentUser() user: { id: string }, @Param('id', ParseIntPipe) id: number) {
    return this.products.getById(user.id, id);
  }

  /** PATCH /products/:id */
  @UseGuards(AuthGuard)
  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(user.id, id, dto);
  }

  /** DELETE /products/:id — soft delete. */
  @UseGuards(AuthGuard)
  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id', ParseIntPipe) id: number) {
    return this.products.remove(user.id, id);
  }

  /** PATCH /products/:id/stock — { delta } | { stock } | { lowAt }. */
  @UseGuards(AuthGuard)
  @Patch(':id/stock')
  adjustStock(
    @CurrentUser() user: { id: string },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdjustStockDto,
  ) {
    return this.products.adjustStock(user.id, id, dto);
  }
}
