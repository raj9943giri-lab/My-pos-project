import {
  IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Numeric coercion for query/body values.
 *   '' / null / undefined -> undefined  (so `@IsOptional()` skips the field)
 *   '45'                  -> 45          (tolerates HTML form strings)
 *   anything else         -> untouched   (so `@IsNumber()` can report it)
 */
const Num = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  });

/** Trimmed string; blank -> undefined ("field not provided"). */
const Str = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s === '' ? undefined : s;
  });

/** Trimmed string; blank -> null ("clear this field" in a PATCH). */
const StrOrNull = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const s = String(value).trim();
    return s === '' ? null : s;
  });

/**
 * Numeric coercion that keeps an explicit null, so a PATCH can CLEAR a
 * numeric column (`mrp: null` → column set to NULL). `undefined` still means
 * "field not provided".
 */
const NumOrNull = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  });

/** GET /products?… */
export class ListProductsQueryDto {
  @IsOptional() @IsString() @MaxLength(120)
  q?: string;

  @IsOptional() @Num() @IsInt() @Min(1)
  categoryId?: number;

  @IsOptional() @Str() @MaxLength(60)
  category?: string;

  /** all | low | out */
  @IsOptional() @IsIn(['all', 'low', 'out'])
  stock?: string;

  /** 'true' | 'false' | '1' | '0' */
  @IsOptional() @IsIn(['true', 'false', '1', '0'])
  includeInactive?: string;
}

/** POST /products */
export class CreateProductDto {
  @Str() @IsString({ message: 'प्रोडक्ट का नाम ज़रूरी है' }) @MinLength(2) @MaxLength(120)
  name!: string;

  @Str() @IsString({ message: 'यूनिट ज़रूरी है (जैसे 1 किलो)' }) @MinLength(1) @MaxLength(40)
  unit!: string;

  @Num() @IsNumber({}, { message: 'मूल्य संख्या होनी चाहिए' }) @Min(0.01) @Max(99999999)
  price!: number;

  @IsOptional() @Num() @IsNumber() @Min(0) @Max(99999999)
  mrp?: number;

  @IsOptional() @Num() @IsInt() @Min(0) @Max(1000000)
  stock?: number;

  @IsOptional() @Num() @IsInt() @Min(0) @Max(1000000)
  lowAt?: number;

  @IsOptional() @Str() @MaxLength(60)
  brand?: string;

  @IsOptional() @Str() @MaxLength(120)
  fresh?: string;

  @IsOptional() @Str() @MaxLength(60)
  life?: string;

  /** Category by id (preferred). */
  @IsOptional() @Num() @IsInt() @Min(1)
  categoryId?: number;

  /** Category by name — created on the fly if unknown (PART 1 parity). */
  @IsOptional() @Str() @MaxLength(60)
  category?: string;
}

/** PATCH /products/:id */
export class UpdateProductDto {
  @IsOptional() @Str() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @IsOptional() @Str() @IsString() @MinLength(1) @MaxLength(40)
  unit?: string;

  @IsOptional() @Num() @IsNumber() @Min(0.01) @Max(99999999)
  price?: number;

  @IsOptional() @NumOrNull() @IsNumber() @Min(0) @Max(99999999)
  mrp?: number | null;

  @IsOptional() @Num() @IsInt() @Min(0) @Max(1000000)
  stock?: number;

  @IsOptional() @Num() @IsInt() @Min(0) @Max(1000000)
  lowAt?: number;

  @IsOptional() @StrOrNull() @IsString() @MaxLength(60)
  brand?: string | null;

  @IsOptional() @StrOrNull() @IsString() @MaxLength(120)
  fresh?: string | null;

  @IsOptional() @StrOrNull() @IsString() @MaxLength(60)
  life?: string | null;

  @IsOptional() @Num() @IsInt() @Min(1)
  categoryId?: number;

  @IsOptional() @Str() @MaxLength(60)
  category?: string;

  /** Soft-delete toggle (reactivate a deleted product). */
  @IsOptional() @IsBoolean()
  active?: boolean;
}

/** PATCH /products/:id/stock */
export class AdjustStockDto {
  /** Relative change (+5 / -2). */
  @IsOptional() @Num() @IsInt() @Min(-1000000) @Max(1000000)
  delta?: number;

  /** Absolute stock value (wins over `delta`). */
  @IsOptional() @Num() @IsInt() @Min(0) @Max(1000000)
  stock?: number;

  /** New low-stock alert threshold. */
  @IsOptional() @Num() @IsInt() @Min(0) @Max(1000000)
  lowAt?: number;
}

/** POST /products/bulk-price */
export class BulkPriceDto {
  /** +10 = मूल्य 10% बढ़ेगा, -10 = 10% छूट. */
  @Num() @IsNumber({}, { message: 'प्रतिशत संख्या होनी चाहिए' }) @Min(-100) @Max(1000)
  percent!: number;

  /** Restrict to one category (id preferred). */
  @IsOptional() @Num() @IsInt() @Min(1)
  categoryId?: number;

  @IsOptional() @Str() @MaxLength(60)
  category?: string;

  /** true = सिर्फ़ preview, कुछ लिखा नहीं जाएगा. */
  @IsOptional() @IsBoolean()
  preview?: boolean;

  /** Lowest allowed selling price (default 1). */
  @IsOptional() @Num() @IsNumber() @Min(0) @Max(99999999)
  minPrice?: number;
}
