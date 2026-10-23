import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseFilters, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/guards';
import { CurrentUser } from '../common/current-user.decorator';
import { AllExceptionsFilter } from '../common/http-exception.filter';
import { ProductCategoriesService } from './product-categories.service';
import { CreateProductCategoryDto, UpdateProductCategoryDto } from './dto';

/**
 * PART 3 — product category routes (shop scoped).
 */
@UseFilters(AllExceptionsFilter)
@Controller('product-categories')
export class ProductCategoriesController {
  constructor(private cats: ProductCategoriesService) {}

  /** GET /product-categories */
  @UseGuards(AuthGuard)
  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.cats.list(user.id);
  }

  /** POST /product-categories */
  @UseGuards(AuthGuard)
  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateProductCategoryDto) {
    return this.cats.create(user.id, dto);
  }

  /** PATCH /product-categories/:id */
  @UseGuards(AuthGuard)
  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductCategoryDto,
  ) {
    return this.cats.update(user.id, id, dto);
  }

  /** DELETE /product-categories/:id — blocked (409) while products still use it. */
  @UseGuards(AuthGuard)
  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id', ParseIntPipe) id: number) {
    return this.cats.remove(user.id, id);
  }
}
