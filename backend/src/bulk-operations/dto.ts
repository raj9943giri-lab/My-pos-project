import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString,
  MaxLength, Min, MinLength, Max, ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { MAX_BULK_ITEMS } from './bulk';

const Num = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  });

const Str = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s === '' ? undefined : s;
  });

export class BulkStockItemDto {
  @Num() @IsInt() @Min(1)
  id!: number;

  /** Relative change (+10 / -2). */
  @IsOptional() @Num() @IsInt() @Min(-1000000) @Max(1000000)
  delta?: number;

  /** Absolute stock (wins over delta). */
  @IsOptional() @Num() @IsInt() @Min(0) @Max(1000000)
  stock?: number;
}

/** POST /bulk-operations/stock — one call, many products. */
export class BulkStockDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_BULK_ITEMS)
  @ValidateNested({ each: true }) @Type(() => BulkStockItemDto)
  items!: BulkStockItemDto[];

  @IsOptional() @Str() @MaxLength(140)
  note?: string;
}

/** POST /bulk-operations/category — move products to one category. */
export class BulkCategoryDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_BULK_ITEMS)
  ids!: number[];

  /** Target category by id (preferred) … */
  @IsOptional() @Num() @IsInt() @Min(1)
  categoryId?: number;

  /** … or by name (created on the fly — same rule as the product form). */
  @IsOptional() @Str() @MinLength(1) @MaxLength(60)
  category?: string;
}

/** POST /bulk-operations/active — bulk soft-delete / restore. */
export class BulkActiveDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_BULK_ITEMS)
  ids!: number[];

  @IsOptional() @IsBoolean()
  active?: boolean;
}
